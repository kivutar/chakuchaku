import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "../curriculum.js";
import "../conjugation.js";

async function readJson(path) {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
}

test("curriculum levels are ordered and filter content through a target level", () => {
  const curriculum = globalThis.JlptN5Curriculum.createCurriculum({
    version: 1,
    defaultLevel: "n5",
    levels: [
      { id: "foundation", rank: 0 },
      { id: "n5", rank: 1 },
      { id: "n4", rank: 2 }
    ]
  });
  const entries = [
    { id: "kana", introducedAt: "foundation" },
    { id: "basic", introducedAt: "n5" },
    { id: "next", introducedAt: "n4" }
  ];

  assert.equal(curriculum.defaultLevel, "n5");
  assert.equal(curriculum.isAvailable("foundation"), true);
  assert.equal(curriculum.isAvailable("n4"), false);
  assert.deepEqual(
    curriculum.filterAvailable(entries).map(({ id }) => id),
    ["kana", "basic"]
  );
  assert.deepEqual(
    curriculum.filterAvailable(entries, { through: "n4" }).map(({ id }) => id),
    ["kana", "basic", "next"]
  );
  assert.equal(curriculum.highestLevel(["foundation", "n4", "n5"]), "n4");
});

test("curriculum manifests reject gaps, duplicates, and unknown defaults", () => {
  assert.throws(() => globalThis.JlptN5Curriculum.createCurriculum({
    version: 1,
    defaultLevel: "n5",
    levels: [{ id: "foundation", rank: 1 }]
  }));
  assert.throws(() => globalThis.JlptN5Curriculum.createCurriculum({
    version: 1,
    defaultLevel: "n4",
    levels: [
      { id: "foundation", rank: 0 },
      { id: "n5", rank: 1 }
    ]
  }));
  assert.throws(() => globalThis.JlptN5Curriculum.createCurriculum({
    version: 1,
    defaultLevel: "n5",
    levels: [
      { id: "foundation", rank: 0 },
      { id: "n5", rank: 1 },
      { id: "n5", rank: 2 }
    ]
  }));
});

test("curriculum manifests require foundation before selectable study levels", () => {
  for (const manifest of [{
    version: 1,
    defaultLevel: "n5",
    levels: [{ id: "n5", rank: 0 }]
  }, {
    version: 1,
    defaultLevel: "n5",
    levels: [
      { id: "n5", rank: 0 },
      { id: "foundation", rank: 1 }
    ]
  }, {
    version: 1,
    defaultLevel: "foundation",
    levels: [{ id: "foundation", rank: 0 }]
  }, {
    version: 1,
    defaultLevel: "foundation",
    levels: [
      { id: "foundation", rank: 0 },
      { id: "n5", rank: 1 }
    ]
  }]) {
    assert.throws(() => globalThis.JlptN5Curriculum.createCurriculum(manifest));
  }
});

test("daily introduction paces expose a stable authored cohort", () => {
  const curriculum = globalThis.JlptN5Curriculum.createCurriculum({
    version: 1,
    defaultLevel: "n5",
    levels: [
      { id: "foundation", rank: 0 },
      { id: "n5", rank: 1 },
      { id: "n4", rank: 2 }
    ]
  });
  const entries = [
    { id: "first", introducedAt: "n5" },
    { id: "second", introducedAt: "n5" },
    { id: "third", introducedAt: "n5" },
    { id: "later", introducedAt: "n4" }
  ];
  const options = {
    through: "n5",
    cards: {},
    maxNew: 2,
    now: "2026-09-26T09:00:00.000Z"
  };

  assert.deepEqual(
    curriculum.selectStudyEntries(entries, options).entries.map(({ id }) => id),
    ["first", "second"]
  );
  assert.deepEqual(
    curriculum.selectStudyEntries(entries, options).entries.map(({ id }) => id),
    ["first", "second"]
  );
  assert.equal(curriculum.getNewItemLimit("balanced", "vocabulary"), 7);
  assert.equal(curriculum.getNewItemLimit("reviews", "grammar"), 0);
  assert.deepEqual(
    curriculum.selectStudyEntries(entries, {
      ...options,
      maxNew: curriculum.getNewItemLimit("reviews", "grammar")
    }).entries,
    []
  );
  assert.equal(
    curriculum.getNewItemLimit("unlimited", "kanji"),
    Number.POSITIVE_INFINITY
  );
});

test("introduced cards consume today's quota without relocking prior material", () => {
  const curriculum = globalThis.JlptN5Curriculum.createCurriculum({
    version: 1,
    defaultLevel: "n5",
    levels: [
      { id: "foundation", rank: 0 },
      { id: "n5", rank: 1 },
      { id: "n4", rank: 2 }
    ]
  });
  const entries = [
    { id: "legacy", introducedAt: "n5" },
    { id: "today", introducedAt: "n5" },
    { id: "next", introducedAt: "n5" },
    { id: "locked-card", introducedAt: "n4" },
    { id: "locked-encounter", introducedAt: "n4" },
    { id: "locked-new", introducedAt: "n4" }
  ];
  const result = curriculum.selectStudyEntries(entries, {
    through: "n5",
    cards: {
      legacy: { due: "2026-09-30T00:00:00.000Z" },
      today: { introduced_at: "2026-09-26T07:00:00.000Z" },
      "locked-card": { introduced_at: "2026-09-25T07:00:00.000Z" }
    },
    encounteredIds: ["locked-encounter"],
    maxNew: 2,
    now: "2026-09-26T09:00:00.000Z"
  });

  assert.equal(result.introducedToday, 1);
  assert.deepEqual(result.entries.map(({ id }) => id), [
    "legacy",
    "today",
    "next",
    "locked-card",
    "locked-encounter"
  ]);
});

test("the current knowledge units are explicitly assigned to N5", async () => {
  const [manifest, grammar, vocabulary, kanji, contexts, conjugation] =
    await Promise.all([
      readJson("data/curriculum.json"),
      readJson("data/jlpt-n5-grammar.json"),
      readJson("data/jlpt-n5-vocabulary.json"),
      readJson("data/jlpt-n5-kanji.json"),
      readJson("data/kanji-contexts.json"),
      readJson("data/jlpt-n5-conjugation.json")
    ]);
  const curriculum = globalThis.JlptN5Curriculum.createCurriculum(manifest);

  for (const entries of [grammar, vocabulary, kanji, contexts, conjugation]) {
    assert.ok(entries.length > 0);
    assert.ok(entries.every(({ introducedAt }) => introducedAt === "n5"));
    assert.equal(curriculum.filterAvailable(entries).length, entries.length);
  }

  assert.ok(globalThis.JlptN5Conjugation.points.length > 0);
  assert.ok(globalThis.JlptN5Conjugation.points.every(({ introducedAt }) => {
    return introducedAt === "n5";
  }));
});

test("all prepared grammar exercises declare their minimum level", async () => {
  const [introduction, exercises] = await Promise.all([
    readJson("data/introduction.json"),
    readJson("data/exercises.json")
  ]);

  for (const lesson of [introduction, ...exercises]) {
    assert.equal(lesson.minimumLevel, "n5", lesson.id);
  }
});
