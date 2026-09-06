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
  conjugateAdjective,
  getPointIdForVerb,
  createExercisePool,
  chooseExercise,
  gradeAnswer
} = globalThis.JlptN5Conjugation;

function verb(term, reading, verbClass, teException) {
  return { term, reading, class: verbClass, teException };
}

test("the initial curriculum exposes 46 reusable conjugation points", () => {
  assert.equal(points.length, 46);
  assert.equal(new Set(points.map(({ id }) => id)).size, 46);
  assert.ok(points.some(({ id }) => id === "ichidan-polite-past"));
  assert.ok(points.some(({ id }) => id === "godan-polite-volitional"));
  assert.ok(points.some(({ id }) => id === "ichidan-polite-volitional"));
  assert.ok(points.some(({ id }) => id === "suru-polite-volitional"));
  assert.ok(points.some(({ id }) => id === "kuru-polite-volitional"));
  assert.ok(points.some(({ id }) => id === "godan-u-tsu-ru-te-form"));
  assert.ok(points.some(({ id }) => id === "iku-te-form"));
  assert.ok(points.some(({ id }) => id === "i-adjective-polite-past"));
  assert.ok(points.some(({ id }) => id === "na-adjective-polite-negative"));
  assert.ok(points.some(({ id }) => id === "ii-adjective-polite-past"));
  assert.ok(points.some(({ id }) => id === "i-adjective-te-form"));
  assert.ok(points.some(({ id }) => id === "na-adjective-te-form"));
  assert.ok(points.some(({ id }) => id === "ii-adjective-te-form"));
  assert.ok(points.some(({ id }) => id === "i-adjective-adverbial"));
  assert.ok(points.some(({ id }) => id === "ii-adjective-adverbial"));
  assert.ok(points.some(({ id }) => id === "na-adjective-adverbial"));
  assert.ok(!points.some(({ id }) => id === "ii-adjective-polite-present"));
});

test("い, な, and irregular いい adjectives use their beginner polite forms", () => {
  const cases = [
    [
      verb("高い", "たかい", "i-adjective"),
      forms.politePresent,
      { surface: "高いです", reading: "たかいです" }
    ],
    [
      verb("高い", "たかい", "i-adjective"),
      forms.politePast,
      { surface: "高かったです", reading: "たかかったです" }
    ],
    [
      verb("高い", "たかい", "i-adjective"),
      forms.politeNegative,
      { surface: "高くないです", reading: "たかくないです" }
    ],
    [
      verb("高い", "たかい", "i-adjective"),
      forms.politePastNegative,
      { surface: "高くなかったです", reading: "たかくなかったです" }
    ],
    [
      verb("静か", "しずか", "na-adjective"),
      forms.politeNegative,
      { surface: "静かではありません", reading: "しずかではありません" }
    ],
    [
      verb("いい", "いい", "ii-adjective"),
      forms.politePast,
      { surface: "よかったです", reading: "よかったです" }
    ],
    [
      verb("高い", "たかい", "i-adjective"),
      forms.te,
      { surface: "高くて", reading: "たかくて" }
    ],
    [
      verb("静か", "しずか", "na-adjective"),
      forms.te,
      { surface: "静かで", reading: "しずかで" }
    ],
    [
      verb("いい", "いい", "ii-adjective"),
      forms.te,
      { surface: "よくて", reading: "よくて" }
    ],
    [
      verb("かっこいい", "かっこいい", "ii-adjective"),
      forms.politePastNegative,
      { surface: "かっこよくなかったです", reading: "かっこよくなかったです" }
    ],
    [
      verb("高い", "たかい", "i-adjective"),
      forms.adverbial,
      { surface: "高く", reading: "たかく" }
    ],
    [
      verb("静か", "しずか", "na-adjective"),
      forms.adverbial,
      { surface: "静かに", reading: "しずかに" }
    ],
    [
      verb("いい", "いい", "ii-adjective"),
      forms.adverbial,
      { surface: "よく", reading: "よく" }
    ]
  ];

  for (const [entry, form, expected] of cases) {
    assert.deepEqual(conjugateAdjective(entry, form), expected);
  }
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

test("polite volitional forms preserve the correct stem for each verb class", () => {
  const cases = [
    [verb("洗う", "あらう", "godan"), "洗いましょう", "あらいましょう"],
    [verb("食べる", "たべる", "ichidan"), "食べましょう", "たべましょう"],
    [verb("勉強する", "べんきょうする", "suru"), "勉強しましょう", "べんきょうしましょう"],
    [verb("来る", "くる", "kuru"), "来ましょう", "きましょう"]
  ];

  for (const [entry, surface, reading] of cases) {
    assert.deepEqual(conjugateVerb(entry, forms.politeVolitional), { surface, reading });
    assert.equal(
      getPointIdForVerb(entry, forms.politeVolitional),
      `${entry.class}-polite-volitional`
    );
  }
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

  assert.equal(curriculum.length, 122);
  assert.equal(new Set(curriculum.map(({ vocabularyId }) => vocabularyId)).size, 122);
  assert.equal(curriculum.filter(({ class: itemClass }) => itemClass === "i-adjective").length, 59);
  assert.equal(curriculum.filter(({ class: itemClass }) => itemClass === "ii-adjective").length, 2);
  assert.equal(curriculum.filter(({ class: itemClass }) => itemClass === "na-adjective").length, 18);
  assert.equal(pool.length, 732);
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


  const highNegative = pool.find(({ term, form }) => {
    return term === "高い" && form === forms.politeNegative;
  });
  const quietNegative = pool.find(({ term, form }) => {
    return term === "静か" && form === forms.politeNegative;
  });
  const goodPresent = pool.find(({ term, form }) => {
    return term === "いい" && form === forms.politePresent;
  });

  assert.equal(gradeAnswer(highNegative, "takaku arimasen", wanakana).correct, true);
  assert.equal(gradeAnswer(quietNegative, "shizuka ja nai desu", wanakana).correct, true);
  assert.equal(gradeAnswer(goodPresent, "yoi desu", wanakana).correct, true);
  assert.equal(goodPresent.conjugationPointId, "i-adjective-polite-present");
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
