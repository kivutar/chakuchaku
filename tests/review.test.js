import assert from "node:assert/strict";
import test from "node:test";

await import("../review.js");

const {
  createDailyItems,
  createDueItems,
  createSession,
  isSessionCurrent,
  readSessionState,
  restoreSession,
  storageKey,
  writeSessionState
} = globalThis.JlptN5Review;

class MemoryStorage {
  constructor() {
    this.values = new Map();
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

test("daily reviews contain only existing cards due when the session starts", () => {
  const due = "2026-09-08T08:00:00.000Z";
  const future = "2026-09-09T08:00:00.000Z";
  const srsData = {
    cards: {
      "grammar-due": { due },
      "grammar-future": { due: future }
    },
    kanaCards: { "みゅ": { due } },
    vocabularyCards: { "vocab-due": { due } },
    kanjiCards: { "kanji-due": { due } },
    conjugationCards: { "conjugation-due": { due } }
  };

  assert.deepEqual(
    createDueItems(srsData, { dueBefore: "2026-09-08T12:00:00.000Z" })
      .map(({ kind, itemId }) => `${kind}:${itemId}`),
    [
      "conjugation:conjugation-due",
      "grammar:grammar-due",
      "kana:みゅ",
      "kanji:kanji-due",
      "vocabulary:vocab-due"
    ]
  );
  assert.deepEqual(createDueItems(undefined), []);
  assert.deepEqual(createDueItems(srsData, { dueBefore: "invalid" }), []);
});

test("successful knowledge units advance the review session while failures stay queued", () => {
  const session = createSession([
    { kind: "grammar", itemId: "a", section: "grammar", due: "2026-09-08T08:00:00Z" },
    { kind: "grammar", itemId: "b", section: "grammar", due: "2026-09-08T08:00:00Z" },
    { kind: "vocabulary", itemId: "word", section: "vocabulary", due: "2026-09-08T08:00:00Z" }
  ], { random: () => 0 });

  assert.deepEqual(session.getProgress(), { completed: 0, remaining: 3, total: 3 });
  assert.equal(session.pickNext().section, "grammar");
  assert.equal(session.pickNext().section, "vocabulary");
  assert.deepEqual(session.recordOutcomes([
    { kind: "grammar", itemId: "a", outcome: "good" },
    { kind: "grammar", itemId: "b", outcome: "again" },
    { kind: "vocabulary", itemId: "not-in-session", outcome: "good" }
  ]), { completed: 1, remaining: 2, total: 3 });
  assert.deepEqual(session.recordOutcomes([
    { kind: "grammar", itemId: "b", outcome: "good" },
    { kind: "vocabulary", itemId: "word", outcome: "good" }
  ]), { completed: 3, remaining: 0, total: 3 });
  assert.deepEqual(session.recordOutcomes([
    { kind: "grammar", itemId: "a", outcome: "again" }
  ]), { completed: 2, remaining: 1, total: 3 });
  session.recordOutcomes([{ kind: "grammar", itemId: "a", outcome: "good" }]);
  assert.equal(session.pickNext(), undefined);
});

test("daily reviews include day-based cards due later today but wait for short learning steps", () => {
  const srsData = {
    cards: {
      overdue: { due: "2026-09-08T08:00:00.000Z", scheduled_days: 0 },
      "later-today": { due: "2026-09-08T18:00:00.000Z", scheduled_days: 3 },
      "learning-later": { due: "2026-09-08T10:10:00.000Z", scheduled_days: 0 },
      tomorrow: { due: "2026-09-09T09:00:00.000Z", scheduled_days: 1 }
    }
  };

  assert.deepEqual(
    createDailyItems(srsData, { now: "2026-09-08T10:00:00.000Z" })
      .map(({ itemId }) => itemId),
    ["overdue", "later-today"]
  );
  assert.deepEqual(createDailyItems(srsData, { now: "invalid" }), []);
});

test("a conflicting duplicate result keeps the unit in the review queue", () => {
  const session = createSession([
    { kind: "kana", itemId: "か", section: "hiragana" },
    { kind: "kana", itemId: "か", section: "hiragana" }
  ]);

  assert.equal(session.getProgress().total, 1);
  session.recordOutcomes([
    { kind: "kana", itemId: "か", outcome: "good" },
    { kind: "kana", itemId: "か", outcome: "again" }
  ]);
  assert.deepEqual(session.getProgress(), { completed: 0, remaining: 1, total: 1 });
});

test("refreshing a session adds newly due items without reviving unchanged completed items", () => {
  const session = createSession([{
    kind: "grammar",
    itemId: "completed",
    section: "grammar",
    due: "2026-09-08T08:00:00.000Z"
  }]);

  session.recordOutcomes([
    { kind: "grammar", itemId: "completed", outcome: "good" }
  ]);
  assert.deepEqual(session.addItems([
    {
      kind: "grammar",
      itemId: "completed",
      section: "grammar",
      due: "2026-09-08T08:00:00.000Z"
    },
    {
      kind: "conjugation",
      itemId: "newly-due",
      section: "conjugation",
      due: "2026-09-08T10:05:00.000Z"
    }
  ]), { completed: 1, remaining: 1, total: 2 });

  session.recordOutcomes([
    { kind: "conjugation", itemId: "newly-due", outcome: "good" }
  ]);
  assert.deepEqual(session.addItems([{
    kind: "grammar",
    itemId: "completed",
    section: "grammar",
    due: "2026-09-08T10:10:00.000Z"
  }]), { completed: 1, remaining: 1, total: 2 });
  assert.equal(session.pickNext().itemId, "completed");
});

test("an interrupted daily session resumes its completed and pending items", () => {
  const storage = new MemoryStorage();
  const now = "2026-09-18T09:00:00.000Z";
  const items = [
    { kind: "grammar", itemId: "done", section: "grammar", due: now },
    { kind: "vocabulary", itemId: "pending", section: "vocabulary", due: now }
  ];
  const firstSession = createSession(items);

  firstSession.recordOutcomes([
    { kind: "grammar", itemId: "done", outcome: "good" }
  ]);
  writeSessionState(firstSession, { storage, now });

  const savedState = readSessionState({ storage, now: "2026-09-18T16:00:00.000Z" });
  const resumedSession = createSession(savedState.items, {
    completedKeys: savedState.completedKeys,
    random: () => 0
  });

  assert.deepEqual(
    resumedSession.getProgress(),
    { completed: 1, remaining: 1, total: 2 }
  );
  assert.equal(resumedSession.pickNext().itemId, "pending");
});

test("resuming an interrupted session does not immediately revive learning steps", () => {
  const due = "2026-09-18T09:00:00.000Z";
  const session = createSession([
    { kind: "grammar", itemId: "done", section: "grammar", due },
    { kind: "grammar", itemId: "pending", section: "grammar", due }
  ]);

  session.recordOutcomes([{ kind: "grammar", itemId: "done", outcome: "good" }]);
  session.addItems([{
    kind: "grammar",
    itemId: "done",
    section: "grammar",
    due: "2026-09-18T09:10:00.000Z"
  }], { reviveCompleted: false });

  assert.deepEqual(session.getProgress(), { completed: 1, remaining: 1, total: 2 });

  session.recordOutcomes([{ kind: "grammar", itemId: "pending", outcome: "good" }]);
  session.addItems([{
    kind: "grammar",
    itemId: "done",
    section: "grammar",
    due: "2026-09-18T09:10:00.000Z"
  }]);

  assert.deepEqual(session.getProgress(), { completed: 1, remaining: 1, total: 2 });
  assert.equal(session.pickNext().itemId, "done");
});

test("saved daily sessions expire at the next local day", () => {
  const storage = new MemoryStorage();
  const session = createSession([{
    kind: "kanji",
    itemId: "日",
    section: "kanji",
    due: "2026-09-18T09:00:00.000Z"
  }]);

  writeSessionState(session, { storage, now: "2026-09-18T20:00:00" });

  assert.ok(storage.getItem(storageKey));
  assert.ok(readSessionState({ storage, now: "2026-09-18T23:00:00" }));
  assert.equal(
    readSessionState({ storage, now: "2026-09-19T09:00:00" }),
    undefined
  );
});

test("a session keeps its original day when saved after midnight", () => {
  const storage = new MemoryStorage();
  const session = createSession([], { dayKey: "2026-09-18" });

  writeSessionState(session, { storage, now: "2026-09-19T00:05:00" });

  const serialized = JSON.parse(storage.getItem(storageKey));

  assert.equal(serialized.dayKey, "2026-09-18");
  assert.equal(isSessionCurrent(session, { now: "2026-09-18T23:59:00" }), true);
  assert.equal(isSessionCurrent(session, { now: "2026-09-19T00:01:00" }), false);
});

test("restoring a session drops targets removed by a content update", () => {
  const due = "2026-09-18T09:00:00.000Z";
  const savedState = {
    dayKey: "2026-09-18",
    items: [
      { kind: "grammar", itemId: "removed", section: "grammar", due },
      { kind: "vocabulary", itemId: "kept", section: "vocabulary", due }
    ],
    completedKeys: []
  };
  const session = restoreSession(savedState, [], {
    dayKey: savedState.dayKey,
    isEligible: ({ itemId }) => itemId === "kept",
    random: () => 0
  });

  assert.deepEqual(session.getProgress(), { completed: 0, remaining: 1, total: 1 });
  assert.equal(session.pickNext().itemId, "kept");
});
