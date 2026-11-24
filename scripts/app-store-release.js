import { sign } from "node:crypto";
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const appId = "6803144387";
const bundleId = "com.kivutar.chakuchaku";
const appPath = `/v1/apps/${appId}`;
const relation = (type, id) => ({ data: { type, id } });
const editableStates = new Set(["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED"]);

function client() {
  const { APP_STORE_CONNECT_KEY_BASE64: key, APP_STORE_CONNECT_KEY_ID: kid,
    APP_STORE_CONNECT_ISSUER_ID: iss } = process.env;
  if (!key || !kid || !iss) throw new Error("App Store Connect credentials are not configured.");
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = `${encode({ alg: "ES256", kid, typ: "JWT" })}.${encode({ iss, iat: now, exp: now + 600, aud: "appstoreconnect-v1" })}`;
  const signature = sign("sha256", Buffer.from(payload), {
    key: Buffer.from(key, "base64"), dsaEncoding: "ieee-p1363"
  }).toString("base64url");
  return async (path, method = "GET", body) => {
    const url = new URL(path, "https://api.appstoreconnect.apple.com");
    if (url.origin !== "https://api.appstoreconnect.apple.com") throw new Error("Unexpected API origin.");
    const response = await fetch(url, {
      method, signal: AbortSignal.timeout(45000),
      headers: { Authorization: `Bearer ${payload}.${signature}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const text = await response.text();
    const result = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(`${method} ${url.pathname}: ${response.status}: ${JSON.stringify(result?.errors)}`);
    return result;
  };
}

async function list(request, path) {
  const data = [];
  while (path) {
    const page = await request(path);
    data.push(...page.data);
    path = page.links?.next;
  }
  return data;
}

export function selectBuild(builds, version, buildNumber) {
  const build = builds.find(item => item.attributes.version === buildNumber);
  if (!build) throw new Error(`Build ${buildNumber} is not uploaded for version ${version}.`);
  if (build.attributes.processingState !== "VALID" || build.attributes.expired) {
    throw new Error("The selected build has not finished processing or has expired.");
  }
  return build;
}

export function validateNotes(notes, locales) {
  if (!Array.isArray(notes) || notes.some(note => !note.language || typeof note.text !== "string" || !note.text.trim() || [...note.text].length > 4000)) {
    throw new Error("Release notes must contain nonempty language/text entries of at most 4000 characters.");
  }
  const byLocale = new Map(notes.map(note => [note.language, note.text]));
  const missing = locales.filter(locale => !byLocale.has(locale));
  if (byLocale.size !== notes.length || missing.length) {
    throw new Error(`Release notes must cover every existing localization without duplicate languages. Missing: ${missing.join(", ") || "none"}.`);
  }
  return byLocale;
}

export async function submitVersion(request, version) {
  const submissions = await list(request, `${appPath}/reviewSubmissions?limit=200`);
  let submission;
  for (const candidate of submissions.filter(item => item.attributes.state === "READY_FOR_REVIEW")) {
    const items = await list(request, `/v1/reviewSubmissions/${candidate.id}/items?include=appStoreVersion&limit=200`);
    if (items.some(item => item.relationships?.appStoreVersion?.data?.id === version.id)) {
      if (items.length !== 1) throw new Error("The existing submission includes other items; refusing to submit them implicitly.");
      submission = candidate;
      break;
    }
  }
  if (!submission) {
    submission = (await request("/v1/reviewSubmissions", "POST", { data: {
      type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: { app: relation("apps", appId) }
    } })).data;
    await request("/v1/reviewSubmissionItems", "POST", { data: {
      type: "reviewSubmissionItems", relationships: {
        reviewSubmission: relation("reviewSubmissions", submission.id), appStoreVersion: relation("appStoreVersions", version.id)
      }
    } });
  }
  return (await request(`/v1/reviewSubmissions/${submission.id}`, "PATCH", { data: {
    type: "reviewSubmissions", id: submission.id, attributes: { submitted: true }
  } })).data;
}

export async function executeAction(request, { action, versionName, buildNumber, notes, report }) {
  if (!["inspect", "prepare", "submit"].includes(action)) throw new Error("Unknown App Store action.");
  if (action !== "inspect" && (!/^\d+\.\d+(\.\d+)?$/u.test(versionName || "") || !/^[1-9]\d*$/u.test(buildNumber || ""))) {
    throw new Error("A numeric marketing version and exact build number are required.");
  }
  const app = (await request(appPath)).data;
  if (app.attributes.bundleId !== bundleId) throw new Error("Unexpected application identity.");
  const versions = await list(request, `${appPath}/appStoreVersions?filter[platform]=IOS&limit=200`);
  report.versions = versions.map(({ id, attributes }) => ({ id, ...attributes }));
  report.submissions = (await list(request, `${appPath}/reviewSubmissions?limit=200`)).map(({ id, attributes }) => ({ id, ...attributes }));
  const buildPath = `/v1/builds?filter[app]=${appId}${versionName ? `&filter[preReleaseVersion.version]=${encodeURIComponent(versionName)}` : ""}&sort=-uploadedDate&limit=200`;
  const builds = await list(request, buildPath);
  report.builds = builds.map(({ id, attributes }) => ({ id, ...attributes }));
  let version = versions.find(item => item.attributes.versionString === versionName);
  if (action === "inspect") return;
  const build = selectBuild(builds, versionName, buildNumber);
  const prerelease = (await request(`/v1/builds/${build.id}/preReleaseVersion`)).data;
  if (prerelease.attributes.version !== versionName || prerelease.attributes.platform !== "IOS") throw new Error("Build marketing version or platform does not match.");
  if (build.attributes.usesNonExemptEncryption !== false) throw new Error("Resolve the build's export-compliance declaration before submission.");
  if (!version) {
    if (action !== "prepare") throw new Error("Prepare the App Store version before submitting it.");
    validateNotes(notes, ["en-US", "fr-FR"]);
    version = (await request("/v1/appStoreVersions", "POST", { data: {
      type: "appStoreVersions", attributes: { platform: "IOS", versionString: versionName, releaseType: "AFTER_APPROVAL" },
      relationships: { app: relation("apps", appId) }
    } })).data;
  }
  report.versionId = version.id;
  const versionPath = `/v1/appStoreVersions/${version.id}`;
  if (action === "prepare") {
    if (!editableStates.has(version.attributes.appStoreState)) throw new Error("The version is not editable.");
    const localizations = await list(request, `${versionPath}/appStoreVersionLocalizations?limit=200`);
    report.localizations = localizations.map(item => ({ locale: item.attributes.locale, whatsNew: item.attributes.whatsNew }));
    if (!localizations.length) throw new Error("The new version has no inherited store localizations.");
    const byLocale = validateNotes(notes, localizations.map(item => item.attributes.locale));
    for (const localization of localizations) {
      await request(`/v1/appStoreVersionLocalizations/${localization.id}`, "PATCH", { data: {
        type: "appStoreVersionLocalizations", id: localization.id,
        attributes: { whatsNew: byLocale.get(localization.attributes.locale) }
      } });
    }
    await request(`${versionPath}/relationships/build`, "PATCH", relation("builds", build.id));
    await request(versionPath, "PATCH", { data: {
      type: "appStoreVersions", id: version.id, attributes: { releaseType: "AFTER_APPROVAL" }
    } });
    report.localizations = localizations.map(item => ({ locale: item.attributes.locale, whatsNew: byLocale.get(item.attributes.locale) }));
  } else {
    const attachedBuild = (await request(`${versionPath}/build`)).data;
    if (attachedBuild?.id !== build.id) throw new Error("The attached build is not the requested build.");
    if (version.attributes.releaseType !== "AFTER_APPROVAL") throw new Error("The version is not set to publish after approval.");
    if (!editableStates.has(version.attributes.appStoreState) && version.attributes.appStoreState !== "READY_FOR_REVIEW") {
      report.currentVersion = { id: version.id, ...version.attributes };
      return;
    }
    report.submission = await submitVersion(request, version);
  }
  const current = (await request(versionPath)).data;
  report.currentVersion = { id: current.id, ...current.attributes };
}

async function main() {
  const { ASC_ACTION: action = "inspect", ASC_VERSION: versionName, ASC_BUILD_NUMBER: buildNumber,
    ASC_RELEASE_NOTES_PATH: notesPath, ASC_REPORT_PATH: reportPath } = process.env;
  const report = { action, versionName, buildNumber, appId };
  try {
    const notes = notesPath ? JSON.parse(await readFile(notesPath, "utf8")) : undefined;
    await executeAction(client(), { action, versionName, buildNumber, notes, report });
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    const output = JSON.stringify(report, null, 2);
    if (reportPath) await writeFile(reportPath, `${output}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n\`\`\`json\n${output}\n\`\`\`\n`);
    console.log(output);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
