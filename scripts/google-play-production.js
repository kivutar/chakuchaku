import { createHash, createSign } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const packageName = "com.kivutar.chakuchaku";
const actions = new Set(["inspect", "validate-production", "publish"]);

export function planProductionRelease(tracks, versionCode, notes) {
  if (!/^[1-9]\d*$/u.test(versionCode || "")) {
    throw new Error("A positive existing version code is required.");
  }
  const production = tracks.find(({ track }) => track === "production");
  if (production?.releases?.some(release => (
    release.status === "completed" && release.versionCodes?.includes(versionCode)
  ))) return { alreadyPublished: true, versionCode };

  if (production?.releases?.some(({ status }) => ["draft", "inProgress", "halted"].includes(status))) {
    throw new Error("Production has an unfinished release; resolve it before replacing the track.");
  }
  const productionCodes = (production?.releases || []).flatMap(({ versionCodes }) => versionCodes || []);
  if (productionCodes.some(code => BigInt(code) >= BigInt(versionCode))) {
    throw new Error("The requested version must be newer than the production release.");
  }
  const source = tracks.filter(({ track }) => ["internal", "alpha"].includes(track))
    .flatMap(({ releases }) => releases || [])
    .find(release => release.status === "completed" && release.versionCodes?.includes(versionCode));
  if (!source) throw new Error("The requested bundle is not an active internal/Alpha release.");
  if (!Array.isArray(notes) || notes.length === 0 || notes.some(note => (
    !note.language || typeof note.text !== "string" || !note.text.trim() || [...note.text].length > 500
  ))) throw new Error("Release notes must contain language/text entries of at most 500 characters.");
  if (new Set(notes.map(({ language }) => language)).size !== notes.length) {
    throw new Error("Release-note languages must be unique.");
  }
  return {
    track: "production",
    releases: [{ name: source.name, versionCodes: [versionCode], status: "completed", releaseNotes: notes }]
  };
}

async function publisherClient() {
  if (!process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) throw new Error("Google Play publishing credentials are not configured.");
  const credential = JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
  if (credential.type !== "service_account" || credential.token_uri !== "https://oauth2.googleapis.com/token") {
    throw new Error("Unexpected Google service-account format.");
  }
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: credential.client_email, scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: credential.token_uri, iat: now, exp: now + 3600
  })}`;
  const signature = createSign("RSA-SHA256").update(payload).end().sign(credential.private_key, "base64url");
  const response = await fetch(credential.token_uri, {
    method: "POST", signal: AbortSignal.timeout(30000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${payload}.${signature}` })
  });
  const token = await response.json();
  if (!response.ok || !token.access_token) throw new Error("Google service-account authentication failed.");
  return {
    fingerprint: createHash("sha256").update(credential.client_email).digest("hex").slice(0, 12),
    request: async (path, method = "GET", body) => {
      const result = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}${path}`, {
        method, signal: AbortSignal.timeout(45000),
        headers: { Authorization: `Bearer ${token.access_token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const text = await result.text();
      const data = text ? JSON.parse(text) : null;
      if (!result.ok) throw new Error(`${method} ${path}: ${result.status}: ${data?.error?.message || "request failed"}`);
      return data;
    }
  };
}

export async function inspectEdit(request, editId) {
  const get = path => request(`/edits/${editId}/${path}`);
  const [details, listings, tracks, bundles] = await Promise.all([
    get("details"), get("listings"), get("tracks"), get("bundles")
  ]);
  let productionCountries;
  try { productionCountries = await get("countryAvailability/production"); }
  catch (error) { productionCountries = { error: error.message }; }
  const listingReports = await Promise.all((listings.listings || []).map(async listing => {
    const images = {};
    for (const type of ["icon", "featureGraphic", "phoneScreenshots"]) {
      try { images[type] = (await get(`listings/${listing.language}/${type}`)).images?.length || 0; }
      catch (error) { images[type] = { error: error.message }; }
    }
    return { language: listing.language, title: listing.title, shortDescription: listing.shortDescription,
      fullDescriptionLength: listing.fullDescription?.length || 0, images };
  }));
  return { defaultLanguage: details.defaultLanguage, contactEmailConfigured: !!details.contactEmail,
    contactWebsiteConfigured: !!details.contactWebsite, listings: listingReports,
    tracks: tracks.tracks || [], bundleVersionCodes: (bundles.bundles || []).map(({ versionCode }) => String(versionCode)),
    productionCountries };
}

export async function executeAction(request, { action, versionCode, notes, report }) {
  if (!actions.has(action)) throw new Error("Unknown Play action.");
  if (action !== "inspect" && !/^[1-9]\d*$/u.test(versionCode || "")) throw new Error("An existing version code is required.");
  const edit = await request("/edits", "POST", {});
  let committed = false;
  try {
    report.before = await inspectEdit(request, edit.id);
    if (action === "inspect") return;
    const plan = planProductionRelease(report.before.tracks, versionCode, notes);
    report.plan = plan;
    if (plan.alreadyPublished) return;
    if (!report.before.bundleVersionCodes.includes(versionCode)) throw new Error("The requested bundle is not uploaded.");
    await request(`/edits/${edit.id}/tracks/production`, "PUT", plan);
    await request(`/edits/${edit.id}:validate`, "POST");
    report.validated = true;
    if (action === "publish") {
      await request(`/edits/${edit.id}:commit?changesNotSentForReview=false`, "POST");
      committed = true;
      report.committed = true;
    }
  } finally {
    if (!committed) await request(`/edits/${edit.id}`, "DELETE");
  }
}

async function main() {
  const action = process.env.PLAY_ACTION || "inspect";
  const versionCode = process.env.PLAY_VERSION_CODE || "";
  if (!actions.has(action)) throw new Error("Unknown Play action.");
  const report = { packageName, action, versionCode, inspectedAt: new Date().toISOString() };
  try {
    const client = await publisherClient();
    report.publisherFingerprint = client.fingerprint;
    let notes;
    if (action !== "inspect") {
      const notesPath = process.env.PLAY_RELEASE_NOTES_PATH;
      if (!notesPath) throw new Error("A reviewed release-notes file is required for production actions.");
      notes = JSON.parse(await readFile(notesPath, "utf8"));
    }
    await executeAction(client.request, { action, versionCode, notes, report });
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    const formatted = JSON.stringify(report, null, 2);
    console.log(formatted);
    if (process.env.PLAY_REPORT_PATH) await writeFile(process.env.PLAY_REPORT_PATH, `${formatted}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Google Play ${action}\n\n\`\`\`json\n${formatted}\n\`\`\`\n`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
