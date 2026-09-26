(function initializeCurriculum(global) {
  "use strict";

  const schemaVersion = 1;
  const levelIdPattern = /^(?:foundation|n[1-5])$/u;
  const newContentPaces = Object.freeze({
    reviews: Object.freeze({ grammar: 0, conjugation: 0, vocabulary: 0, kanji: 0 }),
    gentle: Object.freeze({ grammar: 1, conjugation: 1, vocabulary: 3, kanji: 1 }),
    balanced: Object.freeze({ grammar: 2, conjugation: 1, vocabulary: 7, kanji: 3 }),
    intensive: Object.freeze({ grammar: 4, conjugation: 3, vocabulary: 15, kanji: 6 }),
    unlimited: Object.freeze({
      grammar: Number.POSITIVE_INFINITY,
      conjugation: Number.POSITIVE_INFINITY,
      vocabulary: Number.POSITIVE_INFINITY,
      kanji: Number.POSITIVE_INFINITY
    })
  });

  function localDayKey(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      throw new TypeError("The curriculum selection time is invalid.");
    }

    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function createCurriculum(manifest) {
    if (
      !manifest ||
      manifest.version !== schemaVersion ||
      !Array.isArray(manifest.levels) ||
      manifest.levels.length === 0
    ) {
      throw new TypeError("The curriculum manifest is invalid.");
    }

    const levels = manifest.levels.map((level, index) => {
      if (
        !level ||
        typeof level.id !== "string" ||
        !levelIdPattern.test(level.id) ||
        !Number.isInteger(level.rank) ||
        level.rank !== index
      ) {
        throw new TypeError("Curriculum levels need ordered, contiguous ranks.");
      }

      return Object.freeze({ id: level.id, rank: level.rank });
    });
    const rankByLevel = new Map(levels.map(({ id, rank }) => [id, rank]));

    if (
      rankByLevel.size !== levels.length ||
      !rankByLevel.has(manifest.defaultLevel)
    ) {
      throw new TypeError("Curriculum level ids and the default level must be valid.");
    }

    function getRank(level) {
      const rank = rankByLevel.get(level);

      if (rank === undefined) {
        throw new TypeError(`Unknown curriculum level: ${level}.`);
      }

      return rank;
    }

    function compareLevels(left, right) {
      return getRank(left) - getRank(right);
    }

    function hasLevel(level) {
      return rankByLevel.has(level);
    }

    function isAvailable(introducedAt, through = manifest.defaultLevel) {
      return compareLevels(introducedAt, through) <= 0;
    }

    function filterAvailable(
      entries,
      { through = manifest.defaultLevel, levelField = "introducedAt" } = {}
    ) {
      if (!Array.isArray(entries)) {
        return [];
      }

      getRank(through);
      return entries.filter((entry) => {
        return entry && isAvailable(entry[levelField], through);
      });
    }

    function highestLevel(levelIds) {
      if (!Array.isArray(levelIds) || levelIds.length === 0) {
        return levels[0].id;
      }

      return levelIds.reduce((highest, level) => {
        return compareLevels(level, highest) > 0 ? level : highest;
      }, levels[0].id);
    }

    function getNewItemLimit(pace, kind) {
      const limits = newContentPaces[pace];

      if (!limits || !Object.hasOwn(limits, kind)) {
        throw new TypeError(`Unknown curriculum pace or knowledge kind: ${pace}/${kind}.`);
      }

      return limits[kind];
    }

    function selectStudyEntries(
      entries,
      {
        through = manifest.defaultLevel,
        cards = {},
        encounteredIds = [],
        maxNew = Number.POSITIVE_INFINITY,
        now = new Date(),
        idField = "id",
        levelField = "introducedAt"
      } = {}
    ) {
      if (!Array.isArray(entries)) {
        return Object.freeze({ entries: Object.freeze([]), introducedToday: 0, newSlots: 0 });
      }

      getRank(through);

      if (!(Number.isInteger(maxNew) && maxNew >= 0) && maxNew !== Number.POSITIVE_INFINITY) {
        throw new TypeError("The new-content limit must be a non-negative integer or Infinity.");
      }

      const today = localDayKey(now);
      const safeCards = cards && typeof cards === "object" && !Array.isArray(cards)
        ? cards
        : {};
      const encountered = new Set(Array.isArray(encounteredIds) ? encounteredIds : []);
      const introducedToday = Object.values(safeCards).filter((card) => {
        if (typeof card?.introduced_at !== "string") {
          return false;
        }

        try {
          return localDayKey(card.introduced_at) === today;
        } catch {
          return false;
        }
      }).length;
      let newSlots = maxNew === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : Math.max(0, maxNew - introducedToday);
      const selected = [];

      for (const entry of entries) {
        const itemId = entry?.[idField];
        const itemLevel = entry?.[levelField];

        if (typeof itemId !== "string" || !itemId || !hasLevel(itemLevel)) {
          continue;
        }

        if (safeCards[itemId]) {
          selected.push(entry);
          continue;
        }

        // Encountered material above a lowered target remains available. An
        // incidental encounter inside the active curriculum does not consume
        // or bypass the deliberate daily introduction budget.
        if (!isAvailable(itemLevel, through) && encountered.has(itemId)) {
          selected.push(entry);
          continue;
        }

        if (!isAvailable(itemLevel, through) || newSlots === 0) {
          continue;
        }

        selected.push(entry);

        if (newSlots !== Number.POSITIVE_INFINITY) {
          newSlots -= 1;
        }
      }

      return Object.freeze({
        entries: Object.freeze(selected),
        introducedToday,
        newSlots
      });
    }

    return Object.freeze({
      version: schemaVersion,
      defaultLevel: manifest.defaultLevel,
      levels: Object.freeze(levels),
      hasLevel,
      compareLevels,
      isAvailable,
      filterAvailable,
      highestLevel,
      getNewItemLimit,
      selectStudyEntries
    });
  }

  global.JlptN5Curriculum = Object.freeze({
    schemaVersion,
    newContentPaces,
    createCurriculum
  });
})(globalThis);
