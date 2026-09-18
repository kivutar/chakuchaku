(function initializeReview(global) {
  "use strict";

  const storageKey = "jlpt-n5.review-session.v1";
  const schemaVersion = 1;
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

  function getStorage(storage) {
    if (storage !== undefined) {
      return storage;
    }

    try {
      return global.JlptN5Storage?.storage || global.localStorage;
    } catch {
      return undefined;
    }
  }

  function getLocalDayKey(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return undefined;
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function readSessionState({ storage, now = new Date() } = {}) {
    const dayKey = getLocalDayKey(now);

    if (!dayKey) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(getStorage(storage)?.getItem(storageKey));

      if (
        parsed?.version !== schemaVersion ||
        parsed.dayKey !== dayKey ||
        !Array.isArray(parsed.items) ||
        !Array.isArray(parsed.completedKeys)
      ) {
        return undefined;
      }

      return {
        dayKey: parsed.dayKey,
        items: parsed.items,
        completedKeys: parsed.completedKeys.filter((key) => typeof key === "string")
      };
    } catch {
      return undefined;
    }
  }

  function writeSessionState(session, { storage, now = new Date() } = {}) {
    const dayKey = typeof session?.getDayKey === "function"
      ? session.getDayKey()
      : getLocalDayKey(now);
    const resolvedStorage = getStorage(storage);

    if (!dayKey || !resolvedStorage || typeof session?.getState !== "function") {
      return;
    }

    try {
      resolvedStorage.setItem(storageKey, JSON.stringify({
        version: schemaVersion,
        dayKey,
        ...session.getState()
      }));
    } catch {
      // The in-memory review session remains usable when storage is unavailable.
    }
  }

  function clearSessionState({ storage } = {}) {
    try {
      getStorage(storage)?.removeItem(storageKey);
    } catch {
      // Nothing else needs to be cleared when storage is unavailable.
    }
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

  function createSession(
    items,
    {
      random = Math.random,
      completedKeys = [],
      dayKey = getLocalDayKey(new Date())
    } = {}
  ) {
    const pending = new Map();
    const sessionDayKey = typeof dayKey === "string" && dayKey
      ? dayKey
      : getLocalDayKey(new Date());
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
    const restoredCompletedKeys = new Set(
      Array.isArray(completedKeys)
        ? completedKeys.filter((key) => typeof key === "string")
        : []
    );

    for (const key of restoredCompletedKeys) {
      if (sessionItems.has(key)) {
        pending.delete(key);
      }
    }

    let total = sessionItems.size;

    function getProgress() {
      return {
        completed: total - pending.size,
        remaining: pending.size,
        total
      };
    }

    function getDayKey() {
      return sessionDayKey;
    }

    function getState() {
      return {
        items: [...sessionItems.values()].map(({ key, ...item }) => item),
        completedKeys: [...sessionItems.keys()].filter((key) => !pending.has(key))
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

    function addItems(itemsToAdd, { reviveCompleted = true } = {}) {
      for (const item of Array.isArray(itemsToAdd) ? itemsToAdd : []) {
        const preparedItem = prepareItem(item);

        if (!preparedItem || pending.has(preparedItem.key)) {
          continue;
        }

        const previousItem = sessionItems.get(preparedItem.key);

        if (previousItem) {
          if (!reviveCompleted) {
            continue;
          }

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
      getDayKey,
      getProgress,
      getState,
      recordOutcomes,
      addItems,
      pickNext
    });
  }

  function restoreSession(
    savedState,
    dueItems,
    {
      random = Math.random,
      isEligible = () => true,
      dayKey = savedState?.dayKey || getLocalDayKey(new Date())
    } = {}
  ) {
    if (!savedState) {
      return createSession(dueItems, { random, dayKey });
    }

    const session = createSession(
      savedState.items.filter((item) => isEligible(item)),
      {
        random,
        completedKeys: savedState.completedKeys,
        dayKey
      }
    );
    const wasInterrupted = session.getProgress().remaining > 0;

    session.addItems(dueItems, { reviveCompleted: !wasInterrupted });
    return session;
  }

  function isSessionCurrent(session, { now = new Date() } = {}) {
    return typeof session?.getDayKey === "function" &&
      session.getDayKey() === getLocalDayKey(now);
  }

  global.JlptN5Review = Object.freeze({
    storageKey,
    schemaVersion,
    cardBuckets,
    createReviewKey,
    createDueItems,
    createDailyItems,
    createSession,
    restoreSession,
    isSessionCurrent,
    readSessionState,
    writeSessionState,
    clearSessionState
  });
})(globalThis);
