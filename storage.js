(function initializeStorage(global) {
  "use strict";

  const cache = new Map();
  const webDatabaseName = "chakuchaku";
  const webDatabaseVersion = 1;
  const webStoreName = "learner-data";
  const largeWebStorageKeys = Object.freeze([
    "jlpt-n5.srs.v1",
    "jlpt-n5.learning-stats.v1"
  ]);
  const obsoleteBrowserKeys = Object.freeze([
    "jlpt-n5.review-session.v1"
  ]);
  let browserStorage;
  let persistentDriver;
  let persistentKeys = new Set();
  let mirrorPersistentValues = true;
  let readyPromise = Promise.resolve();
  let pendingWrite = Promise.resolve();
  let writeScheduled = false;
  const pendingMutations = new Map();

  try {
    browserStorage = global.localStorage;
  } catch {
    browserStorage = undefined;
  }

  function readBrowserValue(key) {
    try {
      return browserStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  function mirrorBrowserValue(key, value) {
    try {
      if (value === null) {
        browserStorage?.removeItem(key);
      } else {
        browserStorage?.setItem(key, value);
      }
    } catch {
      // The in-memory value and persistent driver can still keep the app operational.
    }
  }

  function queuePersistentMutation(key, mutation) {
    if (!persistentDriver || !persistentKeys.has(key)) {
      return;
    }

    pendingMutations.set(key, mutation);

    if (writeScheduled) {
      return;
    }

    writeScheduled = true;
    pendingWrite = pendingWrite
      .then(async () => {
        while (pendingMutations.size > 0) {
          const mutations = [...pendingMutations.entries()];

          pendingMutations.clear();
          await Promise.all(mutations.map(([mutationKey, pending]) => {
            return pending.type === "remove"
              ? persistentDriver.removeItem(mutationKey)
              : persistentDriver.setItem(mutationKey, pending.value);
          }));
        }
      })
      .catch((error) => console.error("Could not persist learner data.", error))
      .finally(() => {
        writeScheduled = false;

        if (pendingMutations.size > 0) {
          const [key, mutation] = pendingMutations.entries().next().value;

          pendingMutations.delete(key);
          queuePersistentMutation(key, mutation);
        }
      });
  }

  const storage = Object.freeze({
    getItem(key) {
      const normalizedKey = String(key);

      if (cache.has(normalizedKey)) {
        return cache.get(normalizedKey);
      }

      const value = readBrowserValue(normalizedKey);

      cache.set(normalizedKey, value);
      return value;
    },

    setItem(key, value) {
      const normalizedKey = String(key);
      const normalizedValue = String(value);
      const usesPersistentDriver = persistentDriver && persistentKeys.has(normalizedKey);

      cache.set(normalizedKey, normalizedValue);

      if (!usesPersistentDriver || mirrorPersistentValues) {
        mirrorBrowserValue(normalizedKey, normalizedValue);
      } else {
        mirrorBrowserValue(normalizedKey, null);
      }

      queuePersistentMutation(normalizedKey, {
        type: "set",
        value: normalizedValue
      });
    },

    removeItem(key) {
      const normalizedKey = String(key);

      cache.set(normalizedKey, null);
      mirrorBrowserValue(normalizedKey, null);
      queuePersistentMutation(normalizedKey, { type: "remove" });
    }
  });

  function validateDriver(driver) {
    if (
      !driver ||
      typeof driver.getItem !== "function" ||
      typeof driver.setItem !== "function" ||
      typeof driver.removeItem !== "function"
    ) {
      throw new TypeError("Persistent storage drivers need getItem, setItem, and removeItem.");
    }
  }

  function configurePersistentDriver(
    driver,
    keys,
    {
      mirrorBrowser = true,
      removeBrowserAfterMigration = false,
      preferBrowserWhenPresent = false
    } = {}
  ) {
    validateDriver(driver);
    persistentDriver = driver;
    persistentKeys = new Set(
      [...new Set(keys)].filter((key) => typeof key === "string" && key)
    );
    mirrorPersistentValues = mirrorBrowser;

    readyPromise = (async () => {
      for (const key of persistentKeys) {
        const persistentValue = await driver.getItem(key);
        const browserValue = readBrowserValue(key);

        if (typeof browserValue === "string" && (
          typeof persistentValue !== "string" || preferBrowserWhenPresent
        )) {
          cache.set(key, browserValue);
          await driver.setItem(key, browserValue);

          if (removeBrowserAfterMigration) {
            mirrorBrowserValue(key, null);
          }
        } else if (typeof persistentValue === "string") {
          cache.set(key, persistentValue);

          if (mirrorBrowser) {
            mirrorBrowserValue(key, persistentValue);
          } else {
            mirrorBrowserValue(key, null);
          }
        } else {
          cache.set(key, null);
        }
      }
    })();

    return readyPromise;
  }

  function createRequestPromise(request) {
    return new Promise((resolve, reject) => {
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener("error", () => reject(request.error), { once: true });
    });
  }

  function createTransactionPromise(transaction) {
    return new Promise((resolve, reject) => {
      transaction.addEventListener("complete", resolve, { once: true });
      transaction.addEventListener("abort", () => reject(transaction.error), { once: true });
      transaction.addEventListener("error", () => reject(transaction.error), { once: true });
    });
  }

  function createIndexedDbDriver(indexedDb) {
    const databasePromise = new Promise((resolve, reject) => {
      const request = indexedDb.open(webDatabaseName, webDatabaseVersion);

      request.addEventListener("upgradeneeded", () => {
        if (!request.result.objectStoreNames.contains(webStoreName)) {
          request.result.createObjectStore(webStoreName);
        }
      });
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener("error", () => reject(request.error), { once: true });
      request.addEventListener("blocked", () => {
        reject(new Error("The learner database upgrade was blocked."));
      }, { once: true });
    });

    return Object.freeze({
      async getItem(key) {
        const database = await databasePromise;
        const transaction = database.transaction(webStoreName, "readonly");
        const value = await createRequestPromise(
          transaction.objectStore(webStoreName).get(key)
        );

        return typeof value === "string" ? value : null;
      },

      async setItem(key, value) {
        const database = await databasePromise;
        const transaction = database.transaction(webStoreName, "readwrite");
        const completion = createTransactionPromise(transaction);

        transaction.objectStore(webStoreName).put(String(value), key);
        await completion;
      },

      async removeItem(key) {
        const database = await databasePromise;
        const transaction = database.transaction(webStoreName, "readwrite");
        const completion = createTransactionPromise(transaction);

        transaction.objectStore(webStoreName).delete(key);
        await completion;
      }
    });
  }

  async function ready() {
    await readyPromise;
  }

  async function flush() {
    await readyPromise;
    await pendingWrite;

    while (writeScheduled || pendingMutations.size > 0) {
      await pendingWrite;
    }
  }

  for (const key of obsoleteBrowserKeys) {
    mirrorBrowserValue(key, null);
  }

  const isNative = Boolean(global.Capacitor?.isNativePlatform?.());

  if (!isNative && global.indexedDB) {
    const migration = configurePersistentDriver(
      createIndexedDbDriver(global.indexedDB),
      largeWebStorageKeys,
      {
        mirrorBrowser: false,
        removeBrowserAfterMigration: true,
        preferBrowserWhenPresent: true
      }
    );

    readyPromise = migration.catch((error) => {
      console.error("Could not open the learner database.", error);
      persistentDriver = undefined;
      persistentKeys = new Set();
      mirrorPersistentValues = true;

      for (const key of largeWebStorageKeys) {
        cache.set(key, readBrowserValue(key));
      }
    });

  }

  global.JlptN5Storage = Object.freeze({
    storage,
    configurePersistentDriver,
    createIndexedDbDriver,
    ready,
    flush
  });
})(globalThis);
