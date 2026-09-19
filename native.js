(function initializeNativePlatform(global) {
  "use strict";

  const capacitor = global.Capacitor;
  const isNative = Boolean(capacitor?.isNativePlatform?.());
  const platform = capacitor?.getPlatform?.() || "web";

  if (!isNative) {
    global.JlptN5Native = Object.freeze({ isNative: false, platform: "web" });
    return;
  }

  const preferences = global.capacitorPreferences?.Preferences;
  const filesystemModule = global.capacitorFilesystemPluginCapacitor;
  const filesystem = filesystemModule?.Filesystem;
  const nativeStorage = global.JlptN5NativeStorage;

  if (!preferences) {
    throw new Error("The native Preferences plugin did not load.");
  }

  const srsKey = global.JlptN5Srs.storageKey;
  const statsKey = global.JlptN5Stats.storageKey;
  const settingsKey = global.JlptN5Settings.storageKey;
  const learnerDataKeys = new Set([srsKey, statsKey]);

  function getLearnerDataUpdateTime(value) {
    try {
      const updatedAt = JSON.parse(value)?.updatedAt;
      const time = typeof updatedAt === "string" ? Date.parse(updatedAt) : NaN;

      return Number.isNaN(time) ? undefined : time;
    } catch {
      return undefined;
    }
  }

  function preferNewerBrowserValue({ key, browserValue, persistentValue }) {
    if (!learnerDataKeys.has(key)) {
      return false;
    }

    const browserTime = getLearnerDataUpdateTime(browserValue);
    const persistentTime = getLearnerDataUpdateTime(persistentValue);

    return browserTime !== undefined && (
      persistentTime === undefined || browserTime > persistentTime
    );
  }

  const preferenceDriver = {
    async getItem(key) {
      return (await preferences.get({ key })).value;
    },
    async setItem(key, value) {
      await preferences.set({ key, value });
    },
    async removeItem(key) {
      await preferences.remove({ key });
    }
  };
  let learnerDriver = preferenceDriver;
  let storageBackend = "preferences";

  if (filesystem && nativeStorage) {
    const fileDriver = nativeStorage.createRedundantFileDriver({
      filesystem,
      directory: filesystemModule.Directory?.Library || "LIBRARY",
      encoding: filesystemModule.Encoding?.UTF8 || "utf8",
      fileNames: {
        [srsKey]: "srs",
        [statsKey]: "learning-stats"
      }
    });

    learnerDriver = nativeStorage.createMigratingNativeDriver({
      preferences,
      fileDriver,
      largeKeys: [srsKey, statsKey]
    });
    storageBackend = "redundant-files";
  } else {
    console.error("The native Filesystem plugin did not load; using Preferences fallback.");
  }

  document.documentElement.dataset.nativePlatform = platform;
  global.JlptN5Storage.configurePersistentDriver(learnerDriver, [
    srsKey,
    statsKey,
    settingsKey
  ], {
    mirrorBrowser: false,
    removeBrowserAfterMigration: true,
    preferBrowserWhenPresent: preferNewerBrowserValue
  });

  global.JlptN5Native = Object.freeze({
    isNative: true,
    platform,
    storageBackend,
    plugins: Object.freeze({
      app: global.capacitorApp?.App,
      filesystem,
      filesystemDirectory: filesystemModule?.Directory,
      filesystemEncoding: filesystemModule?.Encoding,
      haptics: global.capacitorHaptics?.Haptics,
      keyboard: global.capacitorKeyboard?.Keyboard,
      localNotifications: global.capacitorLocalNotifications?.LocalNotifications,
      splashScreen: global.capacitorSplashScreen?.SplashScreen,
      share: global.capacitorShare?.Share,
      statusBar: global.capacitorStatusBar?.StatusBar
    })
  });
})(globalThis);
