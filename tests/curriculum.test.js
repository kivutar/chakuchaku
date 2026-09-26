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
