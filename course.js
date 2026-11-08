(function initializeCourse(global) {
  "use strict";

  const cardBuckets = Object.freeze({
    grammar: "cards",
    vocabulary: "vocabularyCards",
    kanji: "kanjiCards",
    conjugation: "conjugationCards",
    kana: "kanaCards"
  });

  function createPlan({
    curriculum,
    entriesByKind = {},
    srsData = {},
    through = curriculum.defaultLevel,
    pace = "balanced",
    now = new Date()
  }) {
    const groups = [];
    const items = [];

    for (const [kind, bucket] of Object.entries(cardBuckets)) {
      const cards = srsData[bucket] || {};
      // Keep the same authored progression as the individual study sections.
      const entries = [...new Map((entriesByKind[kind] || [])
        .map((entry) => [entry.id, entry])).values()];
      const selection = curriculum.selectStudyEntries(entries, {
        through, cards, maxNew: curriculum.getNewItemLimit(pace, kind), now
      });
      const pending = selection.entries.filter(({ id }) => !cards[id]);

      groups.push({
        kind,
        completed: selection.introducedToday,
        remaining: pending.length,
        total: selection.introducedToday + pending.length
      });
      items.push(...pending.map((entry) => ({
        kind,
        itemId: entry.id,
        section: entry.section || kind
      })));
    }

    const completed = groups.reduce((sum, group) => sum + group.completed, 0);

    return {
      groups,
      items,
      completed,
      remaining: items.length,
      total: completed + items.length,
      paused: pace === "reviews"
    };
  }

  function pickNextItem(plan, { previousSection } = {}) {
    return plan.items.find(({ section }) => section !== previousSection) || plan.items[0];
  }

  function filterExercises(exercises, { curriculum, through = curriculum.defaultLevel }) {
    return exercises.filter((exercise) => {
      return curriculum.isAvailable(exercise.minimumLevel || exercise.introducedAt, through);
    });
  }

  global.JlptN5Course = Object.freeze({ createPlan, pickNextItem, filterExercises });
})(globalThis);
