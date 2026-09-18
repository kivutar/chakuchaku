(function initializeReview(global) {
  "use strict";

  const cardBuckets = Object.freeze({
    grammar: "cards",
    kana: "kanaCards",
    vocabulary: "vocabularyCards",
    kanji: "kanjiCards",
    conjugation: "conjugationCards"
  });

  function createReviewKey(kind, itemId) {
    return `${kind}\u0000${itemId}`;
  }

  function createDueItems(srsData, { dueBefore = new Date() } = {}) {
    const cutoff = new Date(dueBefore).getTime();

    if (!srsData || Number.isNaN(cutoff)) {
      return [];
    }

    const items = [];

    for (const [kind, bucketName] of Object.entries(cardBuckets)) {
      const bucket = srsData[bucketName];

      if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) {
        continue;
      }

      for (const [itemId, card] of Object.entries(bucket)) {
        const dueTime = Date.parse(card?.due);

        if (itemId && !Number.isNaN(dueTime) && dueTime <= cutoff) {
          items.push({ kind, itemId, due: card.due });
        }
      }
    }

    return items.sort((left, right) => {
      return Date.parse(left.due) - Date.parse(right.due) ||
        left.kind.localeCompare(right.kind) ||
        left.itemId.localeCompare(right.itemId);
    });
  }

  function createDailyItems(srsData, { now = new Date() } = {}) {
    const currentTime = new Date(now);

    if (Number.isNaN(currentTime.getTime())) {
      return [];
    }

    const dayEnd = new Date(currentTime);

    dayEnd.setHours(23, 59, 59, 999);

    return createDueItems(srsData, { dueBefore: dayEnd }).filter(({ kind, itemId, due }) => {
      const card = srsData?.[cardBuckets[kind]]?.[itemId];

      return Date.parse(due) <= currentTime.getTime() || card?.scheduled_days > 0;
    });
  }

  function createSession(items, { random = Math.random } = {}) {
    const pending = new Map();
    let previousKey;
    let previousSection;

    function prepareItem(item) {
      if (
        !Object.hasOwn(cardBuckets, item?.kind) ||
        typeof item.itemId !== "string" ||
        !item.itemId ||
        typeof item.section !== "string" ||
        !item.section
      ) {
        return undefined;
      }

      return {
        ...item,
        key: createReviewKey(item.kind, item.itemId)
      };
    }

    for (const item of Array.isArray(items) ? items : []) {
      const preparedItem = prepareItem(item);

      if (!preparedItem) {
        continue;
      }

      if (!pending.has(preparedItem.key)) {
        pending.set(preparedItem.key, preparedItem);
      }
    }

    const sessionItems = new Map(pending);
    let total = sessionItems.size;

    function getProgress() {
      return {
        completed: total - pending.size,
        remaining: pending.size,
        total
      };
    }

    function recordOutcomes(outcomes) {
      const outcomeByKey = new Map();

      for (const outcome of Array.isArray(outcomes) ? outcomes : []) {
        if (
          !Object.hasOwn(cardBuckets, outcome?.kind) ||
          typeof outcome.itemId !== "string" ||
          !["again", "good"].includes(outcome.outcome)
        ) {
          continue;
        }

        const key = createReviewKey(outcome.kind, outcome.itemId);
        const previousOutcome = outcomeByKey.get(key);

        outcomeByKey.set(
          key,
          previousOutcome === "again" || outcome.outcome === "again" ? "again" : "good"
        );
      }

      for (const [key, outcome] of outcomeByKey) {
        if (outcome === "good") {
          pending.delete(key);
        } else if (sessionItems.has(key)) {
          pending.set(key, sessionItems.get(key));
        }
      }

      return getProgress();
    }

    function addItems(itemsToAdd) {
      for (const item of Array.isArray(itemsToAdd) ? itemsToAdd : []) {
        const preparedItem = prepareItem(item);

        if (!preparedItem || pending.has(preparedItem.key)) {
          continue;
        }

        const previousItem = sessionItems.get(preparedItem.key);

        if (previousItem) {
          // A completed item only becomes pending again when the SRS assigned it
          // a genuinely new due date during this session.
          if (!preparedItem.due || preparedItem.due === previousItem.due) {
            continue;
          }
        } else {
          total += 1;
        }

        sessionItems.set(preparedItem.key, preparedItem);
        pending.set(preparedItem.key, preparedItem);
      }

      return getProgress();
    }

    function pickNext() {
      const remaining = [...pending.values()];

      if (remaining.length === 0) {
        return undefined;
      }

      let sections = [...new Set(remaining.map(({ section }) => section))];

      if (sections.length > 1) {
        sections = sections.filter((section) => section !== previousSection);
      }

      const section = sections[Math.floor(random() * sections.length)];
      let candidates = remaining.filter((item) => item.section === section);

      if (candidates.length > 1) {
        candidates = candidates.filter(({ key }) => key !== previousKey);
      }

      const selected = candidates[Math.floor(random() * candidates.length)];

      previousKey = selected.key;
      previousSection = selected.section;
      return { ...selected };
    }

    return Object.freeze({
      getProgress,
      recordOutcomes,
      addItems,
      pickNext
    });
  }

  global.JlptN5Review = Object.freeze({
    cardBuckets,
    createReviewKey,
    createDueItems,
    createDailyItems,
    createSession
  });
})(globalThis);
