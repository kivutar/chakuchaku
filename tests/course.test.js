import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as FSRS from "ts-fsrs";
import "../curriculum.js";
import "../course.js";
import "../kanji.js";

globalThis.FSRS = FSRS;
await import("../srs.js");

const { createPlan, pickNextItem } = globalThis.JlptN5Course;
const curriculum = globalThis.JlptN5Curriculum.createCurriculum({
  version: 1,
  defaultLevel: "n5",
  levels: [{ id: "foundation", rank: 0 }, { id: "n5", rank: 1 }, { id: "n4", rank: 2 }]
});
const now = new Date("2026-11-07T12:00:00Z");
const entries = (count, kind, level = "n5") => Array.from({ length: count }, (_, i) => ({
  id: `${kind}-${i}`, introducedAt: level
}));
const entriesByKind = {
  grammar: entries(5, "grammar"),
  vocabulary: entries(10, "vocabulary"),
  kanji: entries(5, "kanji"),
  conjugation: entries(5, "conjugation"),
  kana: entries(10, "kana", "foundation").map((entry) => ({ ...entry, section: "hiragana" }))
};
const options = { curriculum, entriesByKind, now };

test("the daily course deliberately targets new units within the chosen pace and level", () => {
  const plan = createPlan({
    ...options,
    entriesByKind: {
      ...entriesByKind,
      grammar: [...entriesByKind.grammar, ...entries(3, "n4-grammar", "n4")]
    },
    srsData: { cards: { "grammar-0": { due: "2026-11-07T08:00:00Z" } } }
  });

  assert.equal(plan.total, 18);
  assert.equal(plan.remaining, 18);
  assert.equal(plan.completed, 0);
  assert.deepEqual(plan.groups.map(({ kind, remaining }) => [kind, remaining]), [
    ["grammar", 2], ["vocabulary", 7], ["kanji", 3], ["conjugation", 1], ["kana", 5]
  ]);
  assert.deepEqual(plan.items.filter(({ kind }) => kind === "grammar").map(({ itemId }) => itemId), [
    "grammar-1", "grammar-2"
  ]);
  assert.ok(plan.items.every(({ itemId }) => !itemId.startsWith("n4-")));
  assert.deepEqual(pickNextItem(plan), { kind: "grammar", itemId: "grammar-1", section: "grammar" });
  assert.equal(pickNextItem(plan, { previousSection: "grammar" }).section, "vocabulary");
});

test("units introduced elsewhere today consume the same allowance and survive reopening", () => {
  const srsData = { vocabularyCards: {
    "vocabulary-0": { introduced_at: now.toISOString() },
    "vocabulary-1": { introduced_at: now.toISOString() },
    "vocabulary-2": { introduced_at: "2026-11-01T12:00:00Z", due: "2027-01-01T12:00:00Z" }
  } };
  const plan = createPlan({ ...options, srsData });
  const group = plan.groups.find(({ kind }) => kind === "vocabulary");

  assert.deepEqual(group, { kind: "vocabulary", completed: 2, remaining: 5, total: 7 });
  assert.ok(plan.items.every(({ itemId }) => !Object.hasOwn(srsData.vocabularyCards, itemId)));
  assert.deepEqual(createPlan({ ...options, srsData }), plan);

  const tomorrow = createPlan({ ...options, srsData, now: "2026-11-08T12:00:00Z" });

  assert.deepEqual(tomorrow.groups.find(({ kind }) => kind === "vocabulary"), {
    kind: "vocabulary", completed: 0, remaining: 7, total: 7
  });
});

test("a first failed answer completes introduction while preserving its real SRS grade", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  const srsData = globalThis.JlptN5Srs.recordVocabularyReviews([
    { vocabularyId: "vocabulary-0", outcome: "again" }
  ], { storage, now });
  const plan = createPlan({ ...options, srsData });

  assert.equal(plan.groups.find(({ kind }) => kind === "vocabulary").completed, 1);
  assert.ok(plan.items.every(({ itemId }) => itemId !== "vocabulary-0"));
  assert.equal(srsData.vocabularyCards["vocabulary-0"].state, FSRS.State.Learning);
  assert.ok(Date.parse(srsData.vocabularyCards["vocabulary-0"].due) <= now.getTime() + 60_000);
  assert.deepEqual(globalThis.JlptN5Srs.readSrsData({ storage }), srsData);
});

test("reviews-only pauses the course and unlimited still produces a finite plan", () => {
  const paused = createPlan({ ...options, pace: "reviews" });

  assert.equal(paused.paused, true);
  assert.equal(paused.remaining, 0);
  assert.equal(pickNextItem(paused), undefined);
  const unlimited = createPlan({ ...options, pace: "unlimited" });
  assert.equal(unlimited.remaining, 35);
});

test("a completed daily allowance introduces no extra units; no inventory means no exercises", () => {
  const cards = Object.fromEntries(entriesByKind.vocabulary.slice(0, 8).map(({ id }) => [
    id, { introduced_at: now.toISOString() }
  ]));
  const plan = createPlan({ ...options, srsData: { vocabularyCards: cards } });

  assert.deepEqual(plan.groups.find(({ kind }) => kind === "vocabulary"), {
    kind: "vocabulary", completed: 8, remaining: 0, total: 8
  });
  const empty = createPlan({ curriculum, now });
  assert.equal(empty.total, 0);
  assert.equal(empty.remaining, 0);
});

test("the shared long-vowel kana is counted and scheduled only once", () => {
  const plan = createPlan({
    curriculum, now,
    entriesByKind: { kana: [
      { id: "ー", introducedAt: "foundation", section: "katakana" },
      { id: "ー", introducedAt: "foundation", section: "katakana" }
    ] }
  });

  assert.equal(plan.total, 1);
  assert.deepEqual(plan.items, [{ kind: "kana", itemId: "ー", section: "katakana" }]);
});

test("the daily allowance resets at local midnight", () => {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const srsData = { vocabularyCards: {
    "vocabulary-0": { introduced_at: new Date(midnight.getTime() - 1).toISOString() },
    "vocabulary-1": { introduced_at: midnight.toISOString() }
  } };
  const plan = createPlan({ ...options, srsData });

  assert.deepEqual(plan.groups.find(({ kind }) => kind === "vocabulary"), {
    kind: "vocabulary", completed: 1, remaining: 6, total: 7
  });
});

test("course exercises respect a lowered level while reviews retain earlier higher-level material", async () => {
  const appCode = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const exercises = JSON.parse(await readFile(new URL("../data/exercises.json", import.meta.url), "utf8"));
  const higher = exercises.find(({ id }) => id === "n4-paper-hat-cannot-be-heavy");
  const helper = appCode.slice(
    appCode.indexOf("function filterCourseExercises("),
    appCode.indexOf("function createEmptyStudyResult(")
  );
  assert.equal(higher.minimumLevel, "n4");
  assert.ok(higher.grammarPointIds.includes("relative-clause"));

  for (const section of ["course", "review", "grammar"]) {
    const filter = runInNewContext(`${helper}; filterCourseExercises`, {
      currentStudySection: section,
      curriculumModel: curriculum,
      getStudyLevel: () => "n5",
      globalThis: { JlptN5Course: globalThis.JlptN5Course }
    });
    const selected = filter(exercises);

    assert.ok(selected.length > 0);
    assert.equal(selected.includes(higher), section !== "course");
    if (section === "course") {
      assert.ok(selected.every(({ minimumLevel }) => curriculum.isAvailable(minimumLevel, "n5")));
      assert.ok(selected.some(({ grammarPointIds }) => grammarPointIds.includes("relative-clause")));
    }
  }
});

test("course kanji contexts account for the word's level and retain complete coverage", async () => {
  const [appCode, vocabulary, kanji, contexts] = await Promise.all([
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    ...["jlpt-n5-vocabulary", "jlpt-n5-kanji", "kanji-contexts"].map(async (name) => {
      return JSON.parse(await readFile(new URL(`../data/${name}.json`, import.meta.url), "utf8"));
    })
  ]);
  const helper = appCode.slice(
    appCode.indexOf("function prepareKanjiExercises("),
    appCode.indexOf("function prepareVocabularyItems(")
  );
  const prepare = runInNewContext(`${helper}; prepareKanjiExercises`, {
    kanjiExercisePool: undefined,
    curriculumModel: curriculum,
    globalThis: { JlptN5Kanji: globalThis.JlptN5Kanji }
  });
  const pool = prepare(
    new Map(vocabulary.map((entry) => [entry.id, entry])),
    new Map(kanji.map((entry) => [entry.id, entry])),
    contexts
  );
  const n5Kanji = new Set(kanji.filter(({ introducedAt }) => introducedAt === "n5").map(({ id }) => id));
  const aboveLevelWords = pool.filter((exercise) => {
    return n5Kanji.has(exercise.kanjiId) && exercise.minimumLevel === "n4";
  });
  assert.ok(aboveLevelWords.length > 0);
  const selected = globalThis.JlptN5Course.filterExercises(pool, { curriculum, through: "n5" });
  assert.ok(aboveLevelWords.every((exercise) => !selected.includes(exercise)));
  assert.equal(new Set(selected.map(({ kanjiId }) => kanjiId)).size, n5Kanji.size);
});
