(function initializeNativeStorage(global) {
  "use strict";

  const recordFormat = "chakuchaku-native-storage";
  const recordVersion = 1;
  const missingFileCode = "OS-PLUG-FILE-0008";
  const storageDirectory = "chakuchaku/learner-data";

  function fallbackChecksum(source) {
    let first = 0x811c9dc5;
    let second = 0x1505;

    for (let index = 0; index < source.length; index += 1) {
      const code = source.charCodeAt(index);

      first = Math.imul(first ^ code, 0x01000193);
      second = Math.imul(second, 33) ^ code;
    }

    return `fnv-${[
      source.length.toString(36),
      (first >>> 0).toString(36),
      (second >>> 0).toString(36)
    ].join("-")}`;
  }

  async function checksumRecord(key, generation, deleted, value, algorithm) {
    const source = `${key}\0${generation}\0${deleted ? "1" : "0"}\0${value ?? ""}`;
    const useSha256 = algorithm === "sha256" || (
      algorithm === undefined &&
      global.crypto?.subtle &&
      typeof global.TextEncoder === "function"
    );

    if (useSha256) {
      if (!global.crypto?.subtle || typeof global.TextEncoder !== "function") {
        return null;
      }

      const digest = await global.crypto.subtle.digest(
        "SHA-256",
        new global.TextEncoder().encode(source)
      );
      const hexadecimal = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");

      return `sha256-${hexadecimal}`;
    }

    return fallbackChecksum(source);
  }

  async function createRecord(key, generation, value) {
    const deleted = value === null;
    const normalizedValue = deleted ? null : String(value);

    return {
      format: recordFormat,
      version: recordVersion,
      key,
      generation,
      deleted,
      value: normalizedValue,
      checksum: await checksumRecord(key, generation, deleted, normalizedValue)
    };
  }

  async function isValidRecord(record, key) {
    if (!(
      record &&
      record.format === recordFormat &&
      record.version === recordVersion &&
      record.key === key &&
      Number.isSafeInteger(record.generation) &&
      record.generation >= 0 &&
      typeof record.deleted === "boolean" &&
      (record.deleted ? record.value === null : typeof record.value === "string") &&
      typeof record.checksum === "string"
    )) {
      return false;
    }

    const algorithm = record.checksum.startsWith("sha256-") ? "sha256" : "fallback";
    const checksum = await checksumRecord(
      record.key,
      record.generation,
      record.deleted,
      record.value,
      algorithm
    );

    return record.checksum === checksum;
  }

  function isMissingFileError(error) {
    return error?.code === missingFileCode || /does not exist/u.test(String(error?.message));
  }

  function validateFilesystem(filesystem) {
    if (
      !filesystem ||
      typeof filesystem.readFile !== "function" ||
      typeof filesystem.writeFile !== "function" ||
      typeof filesystem.deleteFile !== "function"
    ) {
      throw new TypeError("Native file storage needs readFile, writeFile, and deleteFile.");
    }
  }

  function validatePreferences(preferences) {
    if (
      !preferences ||
      typeof preferences.get !== "function" ||
      typeof preferences.set !== "function" ||
      typeof preferences.remove !== "function"
    ) {
      throw new TypeError("Native preference storage needs get, set, and remove.");
    }
  }

  function createRedundantFileDriver({
    filesystem,
    directory,
    encoding = "utf8",
    fileNames
  }) {
    validateFilesystem(filesystem);

    const normalizedFileNames = new Map(Object.entries(fileNames || {}));
    const statePromises = new Map();

    function getFileName(key) {
      const fileName = normalizedFileNames.get(key);

      if (!fileName || !/^[a-z0-9-]+$/u.test(fileName)) {
        throw new Error(`No safe native filename is configured for ${key}.`);
      }

      return fileName;
    }

    function getSlotPath(key, slot) {
      return `${storageDirectory}/${getFileName(key)}-${slot}.json`;
    }

    function getBackupPath(key) {
      return `${storageDirectory}/${getFileName(key)}-migration-backup.json`;
    }

    async function readPath(key, path, slot) {
      let result;

      try {
        result = await filesystem.readFile({ path, directory, encoding });
      } catch (error) {
        if (isMissingFileError(error)) {
          return { status: "missing", path, slot };
        }

        throw error;
      }

      if (typeof result?.data !== "string") {
        return { status: "invalid", path, slot };
      }

      try {
        const record = JSON.parse(result.data);

        return await isValidRecord(record, key)
          ? { status: "valid", path, slot, record }
          : { status: "invalid", path, slot };
      } catch {
        return { status: "invalid", path, slot };
      }
    }

    async function deletePath(path) {
      try {
        await filesystem.deleteFile({ path, directory });
      } catch (error) {
        if (!isMissingFileError(error)) {
          throw error;
        }
      }
    }

    async function loadState(key) {
      const results = await Promise.all([
        readPath(key, getSlotPath(key, "a"), "a"),
        readPath(key, getSlotPath(key, "b"), "b")
      ]);
      const valid = results
        .filter(({ status }) => status === "valid")
        .sort((left, right) => right.record.generation - left.record.generation);

      if (valid.length > 0) {
        return valid[0];
      }

      const backup = await readPath(key, getBackupPath(key), "backup");

      if (backup.status === "valid") {
        return backup;
      }

      if (
        backup.status === "invalid" ||
        results.some(({ status }) => status === "invalid")
      ) {
        throw new Error(`Both native storage copies for ${key} are unavailable or invalid.`);
      }

      return null;
    }

    function getState(key) {
      if (!statePromises.has(key)) {
        statePromises.set(key, loadState(key));
      }

      return statePromises.get(key);
    }

    async function writeAndVerify(key, path, slot, record) {
      await filesystem.writeFile({
        path,
        directory,
        encoding,
        recursive: true,
        data: JSON.stringify(record)
      });

      const written = await readPath(key, path, slot);

      if (
        written.status !== "valid" ||
        written.record.generation !== record.generation ||
        written.record.deleted !== record.deleted ||
        written.record.value !== record.value
      ) {
        throw new Error(`Native storage verification failed for ${key}.`);
      }

      return written;
    }

    async function writeValue(key, value) {
      const previous = await getState(key);
      const generation = (previous?.record.generation || 0) + 1;
      const slot = previous?.slot === "a" ? "b" : "a";
      const path = getSlotPath(key, slot);
      const record = await createRecord(key, generation, value);

      await filesystem.writeFile({
        path,
        directory,
        encoding,
        recursive: true,
        data: JSON.stringify(record)
      });

      const written = { status: "valid", path, slot, record };

      statePromises.set(key, Promise.resolve(written));
      return written;
    }

    async function verifyValue(key, value) {
      const latest = await getState(key);

      if (!latest) {
        return false;
      }

      const stored = await readPath(key, latest.path, latest.slot);
      const expectedValue = value === null ? null : String(value);

      return Boolean(
        stored.status === "valid" &&
        stored.record.generation === latest.record.generation &&
        stored.record.deleted === (value === null) &&
        stored.record.value === expectedValue
      );
    }

    return Object.freeze({
      async getItem(key) {
        const latest = await getState(key);

        return !latest || latest.record.deleted ? null : latest.record.value;
      },

      async setItem(key, value) {
        await writeValue(key, String(value));
      },

      async removeItem(key) {
        const tombstone = await writeValue(key, null);

        if (!await verifyValue(key, null)) {
          throw new Error(`Native storage deletion verification failed for ${key}.`);
        }

        await Promise.all([
          deletePath(getBackupPath(key)),
          ...["a", "b"]
            .filter((slot) => slot !== tombstone.slot)
            .map((slot) => deletePath(getSlotPath(key, slot)))
        ]);
      },

      async verifyItem(key, value) {
        return verifyValue(key, value);
      },

      async ensureMigrationBackup(key, value) {
        const path = getBackupPath(key);
        const existing = await readPath(key, path, "backup");

        if (existing.status === "valid") {
          return;
        }

        await writeAndVerify(
          key,
          path,
          "backup",
          await createRecord(key, 0, String(value))
        );
      }
    });
  }

  function createMigratingNativeDriver({
    preferences,
    fileDriver,
    largeKeys,
    logger = global.console
  }) {
    validatePreferences(preferences);

    if (
      !fileDriver ||
      typeof fileDriver.getItem !== "function" ||
      typeof fileDriver.setItem !== "function" ||
      typeof fileDriver.removeItem !== "function" ||
      typeof fileDriver.verifyItem !== "function" ||
      typeof fileDriver.ensureMigrationBackup !== "function"
    ) {
      throw new TypeError("A redundant native file driver is required.");
    }

    const fileKeys = new Set(largeKeys);

    function deletionMarker(key) {
      return `chakuchaku.native-storage.deleted:${key}`;
    }

    async function readPreference(key) {
      const result = await preferences.get({ key });

      return typeof result?.value === "string" ? result.value : null;
    }

    async function finishMigration(key, value) {
      await fileDriver.ensureMigrationBackup(key, value);
      await fileDriver.setItem(key, value);

      if (!await fileDriver.verifyItem(key, value)) {
        throw new Error(`Native storage migration verification failed for ${key}.`);
      }

      await preferences.remove({ key });
      await preferences.remove({ key: deletionMarker(key) });
    }

    return Object.freeze({
      async getItem(key) {
        if (!fileKeys.has(key)) {
          return readPreference(key);
        }

        if (await readPreference(deletionMarker(key)) === "1") {
          try {
            await fileDriver.removeItem(key);
            await preferences.remove({ key: deletionMarker(key) });
          } catch (error) {
            logger?.error?.("Could not finish clearing native learner data.", error);
          }

          await preferences.remove({ key });
          return null;
        }

        const legacyValue = await readPreference(key);

        if (legacyValue !== null) {
          try {
            await finishMigration(key, legacyValue);
          } catch (error) {
            logger?.error?.("Could not migrate native learner data yet.", error);
          }

          return legacyValue;
        }

        return fileDriver.getItem(key);
      },

      async setItem(key, value) {
        const normalizedValue = String(value);

        if (!fileKeys.has(key)) {
          await preferences.set({ key, value: normalizedValue });
          return;
        }

        try {
          await fileDriver.setItem(key, normalizedValue);
          await preferences.remove({ key });
          await preferences.remove({ key: deletionMarker(key) });
        } catch (error) {
          // Preferences is only an emergency fallback. A later launch migrates this
          // authoritative value back to the redundant files before deleting it.
          await preferences.set({ key, value: normalizedValue });
          await preferences.remove({ key: deletionMarker(key) });
          logger?.error?.("Native file storage failed; kept learner data in Preferences.", error);
        }
      },

      async migrateItem(key, value) {
        const normalizedValue = String(value);

        if (!fileKeys.has(key)) {
          await preferences.set({ key, value: normalizedValue });
          return;
        }

        await finishMigration(key, normalizedValue);
      },

      async removeItem(key) {
        if (!fileKeys.has(key)) {
          await preferences.remove({ key });
          return;
        }

        try {
          await fileDriver.removeItem(key);
          await preferences.remove({ key });
          await preferences.remove({ key: deletionMarker(key) });
        } catch (error) {
          await preferences.remove({ key });
          await preferences.set({ key: deletionMarker(key), value: "1" });
          logger?.error?.("Native file storage failed; retained a deletion marker.", error);
        }
      }
    });
  }

  global.JlptN5NativeStorage = Object.freeze({
    recordFormat,
    recordVersion,
    checksumRecord,
    createRedundantFileDriver,
    createMigratingNativeDriver
  });
})(globalThis);
