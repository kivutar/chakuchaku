import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as wanakana from "wanakana";

globalThis.wanakana = wanakana;
await import("../conjugation.js");

const {
  forms,
  points,
  conjugateVerb,
  getPointIdForVerb,
  createExercisePool,
  chooseExercise,
  gradeAnswer
} = globalThis.JlptN5Conjugation;

function verb(term, reading, verbClass, teException) {
  return { term, reading, class: verbClass, teException };
}

test("the initial curriculum exposes 25 reusable conjugation points", () => {
  assert.equal(points.length, 25);
  assert.equal(new Set(points.map(({ id }) => id)).size, 25);
  assert.ok(points.some(({ id }) => id === "ichidan-polite-past"));
  assert.ok(points.some(({ id }) => id === "godan-u-tsu-ru-te-form"));
  assert.ok(points.some(({ id }) => id === "iku-te-form"));
});

test("polite forms preserve the correct stem for each verb class", () => {
  assert.deepEqual(
    conjugateVerb(verb("撮る", "とる", "godan"), forms.politePresent),
    { surface: "撮ります", reading: "とります" }
  );
  assert.deepEqual(
    conjugateVerb(verb("くれる", "くれる", "ichidan"), forms.politePast),
    { surface: "くれました", reading: "くれました" }
  );
  assert.deepEqual(
    conjugateVerb(verb("コピーする", "こぴーする", "suru"), forms.politeNegative),
    { surface: "コピーしません", reading: "こぴーしません" }
  );
  assert.deepEqual(
    conjugateVerb(verb("来る", "くる", "kuru"), forms.politePastNegative),
    { surface: "来ませんでした", reading: "きませんでした" }
  );
});

test("te-forms cover every godan sound change and the core irregulars", () => {
  const cases = [
    [verb("買う", "かう", "godan"), "買って", "かって", "godan-u-tsu-ru-te-form"],
    [verb("待つ", "まつ", "godan"), "待って", "まって", "godan-u-tsu-ru-te-form"],
    [verb("撮る", "とる", "godan"), "撮って", "とって", "godan-u-tsu-ru-te-form"],
    [verb("飲む", "のむ", "godan"), "飲んで", "のんで", "godan-mu-bu-nu-te-form"],
    [verb("遊ぶ", "あそぶ", "godan"), "遊んで", "あそんで", "godan-mu-bu-nu-te-form"],
    [verb("死ぬ", "しぬ", "godan"), "死んで", "しんで", "godan-mu-bu-nu-te-form"],
    [verb("書く", "かく", "godan"), "書いて", "かいて", "godan-ku-te-form"],
    [verb("泳ぐ", "およぐ", "godan"), "泳いで", "およいで", "godan-gu-te-form"],
    [verb("話す", "はなす", "godan"), "話して", "はなして", "godan-su-te-form"],
    [verb("食べる", "たべる", "ichidan"), "食べて", "たべて", "ichidan-te-form"],
    [verb("する", "する", "suru"), "して", "して", "suru-te-form"],
    [verb("来る", "くる", "kuru"), "来て", "きて", "kuru-te-form"],
    [verb("行く", "いく", "godan", "iku"), "行って", "いって", "iku-te-form"]
  ];

  for (const [entry, surface, reading, pointId] of cases) {
    assert.deepEqual(conjugateVerb(entry, forms.te), { surface, reading });
    assert.equal(getPointIdForVerb(entry, forms.te), pointId);
  }
});

test("the curated vocabulary supplies exercises for every point", async () => {
  const [vocabulary, curriculum] = await Promise.all([
    readFile(new URL("../data/jlpt-n5-vocabulary.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../data/jlpt-n5-conjugation.json", import.meta.url), "utf8").then(JSON.parse)
  ]);
  const pool = createExercisePool(vocabulary, curriculum);
  const coveredPointIds = new Set(pool.map(({ conjugationPointId }) => conjugationPointId));

  assert.equal(curriculum.length, 43);
  assert.equal(new Set(curriculum.map(({ vocabularyId }) => vocabularyId)).size, 43);
  assert.equal(pool.length, curriculum.length * 5);
  assert.deepEqual(coveredPointIds, new Set(points.map(({ id }) => id)));
  assert.ok(pool.every(({ section }) => section === "conjugation"));
  assert.ok(pool.every(({ meaning }) => typeof meaning === "string" && meaning));

  for (const exercise of pool) {
    assert.equal(gradeAnswer(exercise, exercise.answerSurface, wanakana).correct, true);
    assert.equal(gradeAnswer(exercise, exercise.answerReading, wanakana).correct, true);
    assert.equal(
      gradeAnswer(exercise, wanakana.toRomaji(exercise.answerReading), wanakana).correct,
      true,
      exercise.id
    );
  }
});

test("grading accepts the written form, kana, and converted romaji", () => {
  const exercise = {
    answerSurface: "撮って",
    answerReading: "とって",
    conjugationPointIds: ["godan-u-tsu-ru-te-form"]
  };

  for (const answer of ["撮って", "とって", "totte", " とって。 "]) {
    const result = gradeAnswer(exercise, answer, wanakana);

    assert.equal(result.correct, true, answer);
    assert.deepEqual(result.ratings, [{
      conjugationPointId: "godan-u-tsu-ru-te-form",
      outcome: "good"
    }]);
  }

  assert.deepEqual(gradeAnswer(exercise, "とりて", wanakana).ratings, [{
    conjugationPointId: "godan-u-tsu-ru-te-form",
    outcome: "again"
  }]);
});

test("selection targets the scheduled point without immediately repeating an exercise", () => {
  const pool = [
    { id: "first", conjugationPointIds: ["point"] },
    { id: "second", conjugationPointIds: ["point"] },
    { id: "other", conjugationPointIds: ["other-point"] }
  ];

  assert.equal(
    chooseExercise(pool, "point", { previousExerciseId: "first", random: () => 0 }).id,
    "second"
  );
  assert.equal(chooseExercise(pool, "missing"), undefined);
});
