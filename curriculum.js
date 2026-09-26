(function initializeCurriculum(global) {
  "use strict";

  const schemaVersion = 1;
  const levelIdPattern = /^(?:foundation|n[1-5])$/u;

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

    return Object.freeze({
      version: schemaVersion,
      defaultLevel: manifest.defaultLevel,
      levels: Object.freeze(levels),
      hasLevel,
      compareLevels,
      isAvailable,
      filterAvailable,
      highestLevel
    });
  }

  global.JlptN5Curriculum = Object.freeze({
    schemaVersion,
    createCurriculum
  });
})(globalThis);
