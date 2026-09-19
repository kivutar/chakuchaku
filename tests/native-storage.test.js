import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { TextEncoder } from "node:util";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";

const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const nativeStorageCode = await readFile(
  join(rootDirectory, "native-storage.js"),
  "utf8"
);

function loadNativeStorage() {
  const context = { console, crypto: webcrypto, TextEncoder, Uint8Array };

  context.globalThis = context;
  vm.runInNewContext(nativeStorageCode, context);
  return context.JlptN5NativeStorage;
}

class MemoryFilesystem {
  constructor() {
    this.files = new Map();
    this.writePaths = [];
    this.failWrites = false;
  }

  async readFile({ path }) {
    if (!this.files.has(path)) {
      const error = new Error(`File at ${path} does not exist.`);

      error.code = "OS-PLUG-FILE-0008";
      throw error;
    }

    return { data: this.files.get(path) };
  }

  async writeFile({ path, data }) {
    if (this.failWrites) {
      throw new Error("Simulated write failure.");
    }

    this.files.set(path, data);
    this.writePaths.push(path);
    return { uri: path };
  }

  async deleteFile({ path }) {
    if (!this.files.delete(path)) {
      const error = new Error(`File at ${path} does not exist.`);

      error.code = "OS-PLUG-FILE-0008";
      throw error;
    }
  }
}

class MemoryPreferences {
  constructor(entries = []) {
    this.values = new Map(entries);
  }

  async get({ key }) {
    return { value: this.values.get(key) ?? null };
  }

  async set({ key, value }) {
    this.values.set(key, value);
  }

  async remove({ key }) {
    this.values.delete(key);
  }
}

function createFileDriver(api, filesystem) {
  return api.createRedundantFileDriver({
    filesystem,
    directory: "LIBRARY",
    encoding: "utf8",
    fileNames: { srs: "srs", stats: "learning-stats" }
  });
}

test("redundant native files retain the previous valid value after an interrupted write", async () => {
  const api = loadNativeStorage();
  const filesystem = new MemoryFilesystem();
  const driver = createFileDriver(api, filesystem);

  assert.equal(await driver.getItem("stats"), null);
  await driver.setItem("stats", "first");
  await driver.setItem("stats", "second");
  assert.equal(await driver.getItem("stats"), "second");

  filesystem.files.set(
    "chakuchaku/learner-data/learning-stats-b.json",
    "truncated"
  );

  const afterInterruption = createFileDriver(api, filesystem);

  assert.equal(await afterInterruption.getItem("stats"), "first");
});

test("native file deletion is a durable tombstone", async () => {
  const api = loadNativeStorage();
  const filesystem = new MemoryFilesystem();
  const driver = createFileDriver(api, filesystem);

  await driver.ensureMigrationBackup("srs", "progress");
  await driver.setItem("srs", "progress");
  await driver.removeItem("srs");

  const afterRestart = createFileDriver(api, filesystem);

  assert.equal(await afterRestart.getItem("srs"), null);
  assert.equal(
    filesystem.files.has("chakuchaku/learner-data/srs-migration-backup.json"),
    false
  );
  assert.equal(filesystem.files.size, 1);
  assert.match([...filesystem.files.keys()][0], /srs-[ab]\.json$/u);
});

test("native migration backs up Preferences before moving large learner data", async () => {
  const api = loadNativeStorage();
  const filesystem = new MemoryFilesystem();
  const preferences = new MemoryPreferences([
    ["srs", "legacy-progress"],
    ["settings", "compact-settings"]
  ]);
  const fileDriver = createFileDriver(api, filesystem);
  const driver = api.createMigratingNativeDriver({
    preferences,
    fileDriver,
    largeKeys: ["srs", "stats"],
    logger: { error() {} }
  });

  assert.equal(await driver.getItem("srs"), "legacy-progress");
  assert.equal(preferences.values.has("srs"), false);
  assert.equal(await driver.getItem("settings"), "compact-settings");
  assert.equal(preferences.values.get("settings"), "compact-settings");
  assert.ok(
    filesystem.files.has("chakuchaku/learner-data/srs-migration-backup.json")
  );

  const afterRestart = api.createMigratingNativeDriver({
    preferences,
    fileDriver: createFileDriver(api, filesystem),
    largeKeys: ["srs", "stats"],
    logger: { error() {} }
  });

  assert.equal(await afterRestart.getItem("srs"), "legacy-progress");
});

test("native storage recovers from the verified migration backup", async () => {
  const api = loadNativeStorage();
  const filesystem = new MemoryFilesystem();
  const driver = createFileDriver(api, filesystem);

  await driver.ensureMigrationBackup("stats", "recoverable-progress");
  await driver.setItem("stats", "recoverable-progress");
  filesystem.files.set(
    "chakuchaku/learner-data/learning-stats-a.json",
    "truncated"
  );

  const afterCorruption = createFileDriver(api, filesystem);

  assert.equal(await afterCorruption.getItem("stats"), "recoverable-progress");
});

test("native migration preserves learner documents larger than the browser quota", async () => {
  const api = loadNativeStorage();
  const filesystem = new MemoryFilesystem();
  const largeProgress = `{"history":"${"学".repeat(2_700_000)}"}`;
  const preferences = new MemoryPreferences([["stats", largeProgress]]);
  const driver = api.createMigratingNativeDriver({
    preferences,
    fileDriver: createFileDriver(api, filesystem),
    largeKeys: ["srs", "stats"],
    logger: { error() {} }
  });

  assert.ok(Buffer.byteLength(largeProgress) > 5 * 1024 * 1024);
  assert.equal(await driver.getItem("stats"), largeProgress);
  assert.equal(preferences.values.has("stats"), false);

  const afterRestart = createFileDriver(api, filesystem);

  assert.equal(await afterRestart.getItem("stats"), largeProgress);
});

test("failed native file writes preserve the authoritative value in Preferences", async () => {
  const api = loadNativeStorage();
  const filesystem = new MemoryFilesystem();
  const preferences = new MemoryPreferences([["stats", "real-progress"]]);
  const driver = api.createMigratingNativeDriver({
    preferences,
    fileDriver: createFileDriver(api, filesystem),
    largeKeys: ["srs", "stats"],
    logger: { error() {} }
  });

  filesystem.failWrites = true;

  assert.equal(await driver.getItem("stats"), "real-progress");
  assert.equal(preferences.values.get("stats"), "real-progress");

  await driver.setItem("stats", "newer-progress");
  assert.equal(preferences.values.get("stats"), "newer-progress");
});
