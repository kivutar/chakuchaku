import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const storageCode = await readFile(join(rootDirectory, "storage.js"), "utf8");

class MemoryStorage {
  constructor(entries = []) {
    this.values = new Map(entries);
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, value);
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

function loadStorageApi(localStorage, additions = {}) {
  const context = { localStorage, ...additions };

  context.globalThis = context;
  vm.runInNewContext(storageCode, context);
  return context.JlptN5Storage;
}

test("storage facade preserves existing browser values", () => {
  const browserStorage = new MemoryStorage([["progress", "browser-value"]]);
  const api = loadStorageApi(browserStorage);

  assert.equal(api.storage.getItem("progress"), "browser-value");
  api.storage.setItem("progress", "updated");
  assert.equal(browserStorage.getItem("progress"), "updated");
  api.storage.removeItem("progress");
  assert.equal(browserStorage.getItem("progress"), null);
});
test("persistent drivers hydrate native values and migrate browser values", async () => {
  const browserStorage = new MemoryStorage([
    ["native-wins", "browser"],
    ["browser-migrates", "legacy"]
  ]);
  const nativeStorage = new MemoryStorage([["native-wins", "native"]]);
  const driver = {
    async getItem(key) {
      return nativeStorage.getItem(key);
    },
    async setItem(key, value) {
      nativeStorage.setItem(key, value);
    },
    async removeItem(key) {
      nativeStorage.removeItem(key);
    }
  };
  const api = loadStorageApi(browserStorage);

  await api.configurePersistentDriver(driver, ["native-wins", "browser-migrates"]);

  assert.equal(api.storage.getItem("native-wins"), "native");
  assert.equal(browserStorage.getItem("native-wins"), "native");
  assert.equal(nativeStorage.getItem("browser-migrates"), "legacy");

  api.storage.setItem("native-wins", "after-write");
  api.storage.removeItem("browser-migrates");
  await api.flush();

  assert.equal(nativeStorage.getItem("native-wins"), "after-write");
  assert.equal(nativeStorage.getItem("browser-migrates"), null);
});

test("non-mirrored drivers move large web values out of localStorage", async () => {
  const browserStorage = new MemoryStorage([
    ["srs", "large-srs"],
    ["settings", "small-settings"]
  ]);
  const durableStorage = new MemoryStorage();
  const driver = {
    async getItem(key) {
      return durableStorage.getItem(key);
    },
    async setItem(key, value) {
      durableStorage.setItem(key, value);
    },
    async removeItem(key) {
      durableStorage.removeItem(key);
    }
  };
  const api = loadStorageApi(browserStorage);

  await api.configurePersistentDriver(driver, ["srs"], {
    mirrorBrowser: false,
    removeBrowserAfterMigration: true
  });

  assert.equal(api.storage.getItem("srs"), "large-srs");
  assert.equal(durableStorage.getItem("srs"), "large-srs");
  assert.equal(browserStorage.getItem("srs"), null);
  assert.equal(browserStorage.getItem("settings"), "small-settings");

  api.storage.setItem("srs", "updated-srs");
  api.storage.setItem("settings", "updated-settings");
  await api.flush();

  assert.equal(durableStorage.getItem("srs"), "updated-srs");
  assert.equal(browserStorage.getItem("srs"), null);
  assert.equal(browserStorage.getItem("settings"), "updated-settings");
});

test("web migration prefers a newer local fallback over an existing durable value", async () => {
  const browserStorage = new MemoryStorage([["srs", "newer-browser-value"]]);
  const durableStorage = new MemoryStorage([["srs", "older-durable-value"]]);
  const driver = {
    async getItem(key) {
      return durableStorage.getItem(key);
    },
    async setItem(key, value) {
      durableStorage.setItem(key, value);
    },
    async removeItem(key) {
      durableStorage.removeItem(key);
    }
  };
  const api = loadStorageApi(browserStorage);

  await api.configurePersistentDriver(driver, ["srs"], {
    mirrorBrowser: false,
    removeBrowserAfterMigration: true,
    preferBrowserWhenPresent: true
  });

  assert.equal(api.storage.getItem("srs"), "newer-browser-value");
  assert.equal(durableStorage.getItem("srs"), "newer-browser-value");
  assert.equal(browserStorage.getItem("srs"), null);
});

test("migration selectors preserve the freshest native copy and verify browser migrations", async () => {
  const browserStorage = new MemoryStorage([["srs", "newer-browser-value"]]);
  const durableStorage = new MemoryStorage([["srs", "older-native-value"]]);
  const migrations = [];
  const driver = {
    async getItem(key) {
      return durableStorage.getItem(key);
    },
    async setItem(key, value) {
      durableStorage.setItem(key, value);
    },
    async migrateItem(key, value) {
      migrations.push([key, value]);
      durableStorage.setItem(key, value);
    },
    async removeItem(key) {
      durableStorage.removeItem(key);
    }
  };
  const api = loadStorageApi(browserStorage);

  await api.configurePersistentDriver(driver, ["srs"], {
    mirrorBrowser: false,
    removeBrowserAfterMigration: true,
    preferBrowserWhenPresent({ browserValue, persistentValue }) {
      return browserValue === "newer-browser-value" &&
        persistentValue === "older-native-value";
    }
  });

  assert.deepEqual(migrations, [["srs", "newer-browser-value"]]);
  assert.equal(api.storage.getItem("srs"), "newer-browser-value");
  assert.equal(durableStorage.getItem("srs"), "newer-browser-value");
  assert.equal(browserStorage.getItem("srs"), null);
});

test("persistent writes coalesce repeated updates to the same key", async () => {
  const browserStorage = new MemoryStorage();
  const durableStorage = new MemoryStorage();
  const writes = [];
  const driver = {
    async getItem(key) {
      return durableStorage.getItem(key);
    },
    async setItem(key, value) {
      writes.push([key, value]);
      durableStorage.setItem(key, value);
    },
    async removeItem(key) {
      durableStorage.removeItem(key);
    }
  };
  const api = loadStorageApi(browserStorage);

  await api.configurePersistentDriver(driver, ["stats"], { mirrorBrowser: false });
  api.storage.setItem("stats", "first");
  api.storage.setItem("stats", "second");
  api.storage.setItem("stats", "latest");
  await api.flush();

  assert.deepEqual(writes, [["stats", "latest"]]);
  assert.equal(durableStorage.getItem("stats"), "latest");
});

test("flush reports failed durable writes and clears the error after a successful retry", async () => {
  const browserStorage = new MemoryStorage();
  const durableStorage = new MemoryStorage();
  let failWrites = true;
  const driver = {
    async getItem(key) {
      return durableStorage.getItem(key);
    },
    async setItem(key, value) {
      if (failWrites) {
        throw new Error("Simulated durable write failure.");
      }

      durableStorage.setItem(key, value);
    },
    async removeItem(key) {
      durableStorage.removeItem(key);
    }
  };
  const api = loadStorageApi(browserStorage, { console });

  await api.configurePersistentDriver(driver, ["stats"], { mirrorBrowser: false });
  api.storage.setItem("stats", "not-saved");

  await assert.rejects(api.flush(), (error) => {
    assert.equal(error.code, "save-failed");
    assert.deepEqual([...error.keys], ["stats"]);
    return true;
  });

  failWrites = false;
  api.storage.setItem("stats", "saved");
  await api.flush();
  assert.equal(durableStorage.getItem("stats"), "saved");
});

test("web startup migrates SRS and statistics to IndexedDB exactly once", async () => {
  const indexedDB = new IDBFactory();
  const browserStorage = new MemoryStorage([
    ["jlpt-n5.srs.v1", "srs-before-migration"],
    ["jlpt-n5.learning-stats.v1", "stats-before-migration"],
    ["jlpt-n5.settings.v1", "settings-stay-local"],
    ["jlpt-n5.review-session.v1", "obsolete-session"]
  ]);
  const firstLoad = loadStorageApi(browserStorage, { indexedDB, console });

  await firstLoad.ready();

  assert.equal(firstLoad.storage.getItem("jlpt-n5.srs.v1"), "srs-before-migration");
  assert.equal(
    firstLoad.storage.getItem("jlpt-n5.learning-stats.v1"),
    "stats-before-migration"
  );
  assert.equal(browserStorage.getItem("jlpt-n5.srs.v1"), null);
  assert.equal(browserStorage.getItem("jlpt-n5.learning-stats.v1"), null);
  assert.equal(browserStorage.getItem("jlpt-n5.settings.v1"), "settings-stay-local");
  assert.equal(browserStorage.getItem("jlpt-n5.review-session.v1"), null);

  firstLoad.storage.setItem("jlpt-n5.srs.v1", "srs-after-migration");
  await firstLoad.flush();

  const secondLoad = loadStorageApi(new MemoryStorage(), { indexedDB, console });

  await secondLoad.ready();
  assert.equal(secondLoad.storage.getItem("jlpt-n5.srs.v1"), "srs-after-migration");
  assert.equal(
    secondLoad.storage.getItem("jlpt-n5.learning-stats.v1"),
    "stats-before-migration"
  );
});
