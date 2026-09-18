import assert from "node:assert/strict";
import test from "node:test";

await import("../review.js");

const { createDailyItems, createDueItems, createSession } = globalThis.JlptN5Review;

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
