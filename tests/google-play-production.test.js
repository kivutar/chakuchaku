import assert from "node:assert/strict";
import test from "node:test";
import { executeAction, planProductionRelease } from "../scripts/google-play-production.js";

const notes = [{ language: "en-US", text: "New contextual Japanese stories and vocabulary." }];
const tracks = [
  { track: "production", releases: [] },
  { track: "internal", releases: [{ name: "ChakuChaku 1.0.17", versionCodes: ["1022"], status: "completed" }] }
];

function mockPublisher({ trackData = tracks, validationError } = {}) {
  const calls = [];
  const request = async (path, method = "GET", body) => {
    calls.push({ path, method, body });
    if (path === "/edits") return { id: "edit-1" };
    if (path.endsWith("/details")) return { defaultLanguage: "en-US", contactEmail: "support@example.com" };
    if (path.endsWith("/listings")) return { listings: [{ language: "en-US", title: "ChakuChaku", shortDescription: "Learn Japanese", fullDescription: "Japanese in context." }] };
    if (path.endsWith("/tracks")) return { tracks: trackData };
    if (path.endsWith("/bundles")) return { bundles: [{ versionCode: 1022 }] };
    if (path.endsWith("/countryAvailability/production")) return { countries: [{ countryCode: "FR" }] };
    if (["icon", "featureGraphic", "phoneScreenshots"].some(type => path.endsWith(`/${type}`))) return { images: [{ id: "image" }] };
    if (path.endsWith(":validate") && validationError) throw new Error(validationError);
    return {};
  };
  return { calls, request };
}

test("production promotion selects only an uploaded testing version with reviewed notes", () => {
  assert.deepEqual(planProductionRelease(tracks, "1022", notes), {
    track: "production",
    releases: [{ name: "ChakuChaku 1.0.17", versionCodes: ["1022"], status: "completed", releaseNotes: notes }]
  });
  assert.throws(() => planProductionRelease(tracks, "1023", notes), /not an active internal\/Alpha release/u);
  for (const code of ["", "0", "-1", "1; echo unexpected"]) {
    assert.throws(() => planProductionRelease(tracks, code, notes), /positive existing version code/u);
  }
  assert.throws(() => planProductionRelease(tracks, "1022", []), /Release notes/u);
  assert.throws(() => planProductionRelease(tracks, "1022", [{ language: "en-US", text: "x".repeat(501) }]), /500 characters/u);
  assert.throws(() => planProductionRelease(tracks, "1022", [...notes, ...notes]), /unique/u);
});

test("production promotion preserves unfinished releases and prevents downgrades", () => {
  for (const status of ["draft", "inProgress", "halted"]) {
    const current = [{ track: "production", releases: [{ versionCodes: ["1021"], status }] }, tracks[1]];
    assert.throws(() => planProductionRelease(current, "1022", notes), /unfinished release/u);
  }
  const newer = [{ track: "production", releases: [{ versionCodes: ["1023"], status: "completed" }] }, tracks[1]];
  assert.throws(() => planProductionRelease(newer, "1022", notes), /newer than/u);
  const published = [{ track: "production", releases: [{ versionCodes: ["1022"], status: "completed" }] }];
  assert.deepEqual(planProductionRelease(published, "1022", notes), { alreadyPublished: true, versionCode: "1022" });
});

test("inspection cannot update or commit an app and removes its temporary edit", async () => {
  const { request, calls } = mockPublisher();
  const report = {};
  await executeAction(request, { action: "inspect", report });
  assert.ok(report.before.listings[0].images.phoneScreenshots > 0);
  assert.equal(report.before.contactEmailConfigured, true);
  assert.equal(report.before.contactEmail, undefined);
  assert.ok(!calls.some(({ method, path }) => method === "PUT" || path.includes(":commit")));
  assert.deepEqual(calls.at(-1), { path: "/edits/edit-1", method: "DELETE", body: undefined });
});

test("production validation checks Google requirements without committing changes", async () => {
  const { request, calls } = mockPublisher();
  const report = {};
  await executeAction(request, { action: "validate-production", versionCode: "1022", notes, report });
  assert.equal(report.validated, true);
  assert.equal(report.committed, undefined);
  assert.ok(calls.some(({ path }) => path.endsWith(":validate")));
  assert.ok(!calls.some(({ path }) => path.includes(":commit")));
  assert.equal(calls.at(-1).method, "DELETE");
});

test("publication commits only after validation, and a validation failure cannot publish", async () => {
  const success = mockPublisher();
  const report = {};
  await executeAction(success.request, { action: "publish", versionCode: "1022", notes, report });
  const validate = success.calls.findIndex(({ path }) => path.endsWith(":validate"));
  const commit = success.calls.findIndex(({ path }) => path.includes(":commit?changesNotSentForReview=false"));
  assert.ok(validate >= 0 && commit > validate);
  assert.equal(report.committed, true);
  assert.ok(!success.calls.some(({ method }) => method === "DELETE"));

  const failure = mockPublisher({ validationError: "Store listing is incomplete" });
  await assert.rejects(() => executeAction(failure.request, {
    action: "publish", versionCode: "1022", notes, report: {}
  }), /Store listing is incomplete/u);
  assert.ok(!failure.calls.some(({ path }) => path.includes(":commit")));
  assert.equal(failure.calls.at(-1).method, "DELETE");
});

test("unknown actions and missing version codes cannot create an edit", async () => {
  const { request, calls } = mockPublisher();
  await assert.rejects(() => executeAction(request, { action: "unknown", report: {} }), /Unknown/u);
  await assert.rejects(() => executeAction(request, { action: "publish", report: {} }), /version code/u);
  assert.equal(calls.length, 0);
});
