import assert from "node:assert/strict";
import test from "node:test";
import { executeAction, selectBuild, submitVersion, validateNotes } from "../scripts/app-store-release.js";

const appPath = "/v1/apps/6803144387";
const version = { id: "version-id", attributes: { versionString: "1.0.18", appStoreState: "PREPARE_FOR_SUBMISSION", releaseType: "AFTER_APPROVAL" } };
const build = { id: "build-id", attributes: { version: "2201", processingState: "VALID", expired: false, usesNonExemptEncryption: false } };
const options = { action: "submit", versionName: "1.0.18", buildNumber: "2201" };

function fixture(overrides = {}) {
  const mutations = [];
  const responses = {
    [appPath]: { data: { attributes: { bundleId: "com.kivutar.chakuchaku" } } },
    [`${appPath}/appStoreVersions?filter[platform]=IOS&limit=200`]: { data: [version] },
    [`${appPath}/reviewSubmissions?limit=200`]: { data: [] },
    "/v1/builds?filter[app]=6803144387&filter[preReleaseVersion.version]=1.0.18&sort=-uploadedDate&limit=200": { data: [build] },
    "/v1/builds/build-id/preReleaseVersion": { data: { attributes: { version: "1.0.18", platform: "IOS" } } },
    "/v1/appStoreVersions/version-id/build": { data: build },
    ...overrides
  };
  return { mutations, request: async (path, method = "GET", body) => {
    if (method !== "GET") {
      mutations.push({ path, method, body });
      throw new Error("Unexpected mutation.");
    }
    assert.ok(path in responses, path);
    return responses[path];
  } };
}

test("rejects missing, expired and unprocessed builds", () => {
  assert.throws(() => selectBuild([build], "1.0.18", "2101"), /not uploaded/);
  for (const attributes of [{ expired: true }, { processingState: "PROCESSING" }, { processingState: "INVALID" }]) {
    assert.throws(() => selectBuild([{ ...build, attributes: { ...build.attributes, ...attributes } }], "1.0.18", "2201"), /processing|expired/);
  }
});

test("requires release notes in every inherited language", () => {
  assert.throws(() => validateNotes([], []), /nonempty/);
  assert.throws(() => validateNotes([{ language: "en-US", text: "New exercises" }], ["en-US", "fr-FR"]), /every existing localization/);
  assert.throws(() => validateNotes([{ language: "fr-FR", text: "" }], ["fr-FR"]), /nonempty/);
  assert.throws(() => validateNotes([{ language: "en-US", text: "a" }, { language: "en-US", text: "b" }], ["en-US"]), /duplicate/);
});

test("prepares a new version with the store's inherited en-GB locale", async () => {
  const base = fixture({ [`${appPath}/appStoreVersions?filter[platform]=IOS&limit=200`]: { data: [] } });
  const mutations = [];
  const request = async (path, method = "GET", body) => {
    if (method !== "GET") {
      mutations.push({ path, method, body });
      return { data: version };
    }
    if (path === "/v1/appStoreVersions/version-id/appStoreVersionLocalizations?limit=200") {
      return { data: [{ id: "english", attributes: { locale: "en-GB" } }] };
    }
    if (path === "/v1/appStoreVersions/version-id") return { data: version };
    return base.request(path);
  };
  await executeAction(request, { ...options, action: "prepare", notes: [{ language: "en-GB", text: "New exercises" }], report: {} });
  const localization = mutations.find(call => call.path === "/v1/appStoreVersionLocalizations/english");
  assert.equal(localization.body.data.attributes.whatsNew, "New exercises");
  assert.deepEqual(mutations.find(call => call.path.endsWith("/relationships/build")).body.data, { type: "builds", id: "build-id" });
  assert.equal(mutations.at(-1).body.data.attributes.releaseType, "AFTER_APPROVAL");
});

test("inspect is read-only", async () => {
  const { request, mutations } = fixture();
  await executeAction(request, { ...options, action: "inspect", report: {} });
  assert.equal(mutations.length, 0);
});

test("never submits the wrong app, marketing version, platform or attached build", async () => {
  const cases = [
    { [appPath]: { data: { attributes: { bundleId: "another.app" } } } },
    { "/v1/builds/build-id/preReleaseVersion": { data: { attributes: { version: "1.0.17", platform: "IOS" } } } },
    { "/v1/builds/build-id/preReleaseVersion": { data: { attributes: { version: "1.0.18", platform: "MAC_OS" } } } },
    { "/v1/appStoreVersions/version-id/build": { data: { id: "old-build" } } }
  ];
  for (const overrides of cases) {
    const { request, mutations } = fixture(overrides);
    await assert.rejects(executeAction(request, { ...options, report: {} }), /identity|does not match|not the requested build/);
    assert.equal(mutations.length, 0);
  }
});

test("leaves a version already waiting for review untouched", async () => {
  const { request, mutations } = fixture({
    [`${appPath}/appStoreVersions?filter[platform]=IOS&limit=200`]: { data: [{ ...version, attributes: { ...version.attributes, appStoreState: "WAITING_FOR_REVIEW" } }] }
  });
  const report = {};
  await executeAction(request, { ...options, report });
  assert.equal(report.currentVersion.appStoreState, "WAITING_FOR_REVIEW");
  assert.equal(mutations.length, 0);
});

test("refuses to submit unrelated items along with the release", async () => {
  const { request, mutations } = fixture({
    [`${appPath}/reviewSubmissions?limit=200`]: { data: [{ id: "submission", attributes: { state: "READY_FOR_REVIEW" } }] },
    "/v1/reviewSubmissions/submission/items?include=appStoreVersion&limit=200": { data: [
      { relationships: { appStoreVersion: { data: { id: "version-id" } } } },
      { relationships: { appEvent: { data: { id: "unrelated-event" } } } }
    ] }
  });
  await assert.rejects(submitVersion(request, version), /other items/);
  assert.equal(mutations.length, 0);
});

test("creates and submits a review containing only the selected version", async () => {
  const calls = [];
  const request = async (path, method = "GET", body) => {
    calls.push({ path, method, body });
    if (method === "GET") return { data: [] };
    return { data: { id: "submission", attributes: { state: method === "PATCH" ? "WAITING_FOR_REVIEW" : "READY_FOR_REVIEW" } } };
  };
  const result = await submitVersion(request, version);
  assert.equal(result.attributes.state, "WAITING_FOR_REVIEW");
  const item = calls.find(call => call.path === "/v1/reviewSubmissionItems");
  assert.deepEqual(item.body.data.relationships.appStoreVersion.data, { type: "appStoreVersions", id: "version-id" });
  assert.deepEqual(calls.at(-1).body.data.attributes, { submitted: true });
});
