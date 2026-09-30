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

test("the curriculum exposes 119 reusable conjugation points", () => {
  assert.equal(points.length, 119);
  assert.equal(new Set(points.map(({ id }) => id)).size, 119);
  assert.ok(points.some(({ id }) => id === "ichidan-polite-past"));
  assert.ok(points.some(({ id }) => id === "godan-polite-volitional"));
  assert.ok(points.some(({ id }) => id === "ichidan-polite-volitional"));
  assert.ok(points.some(({ id }) => id === "suru-polite-volitional"));
  assert.ok(points.some(({ id }) => id === "kuru-polite-volitional"));
  assert.ok(points.some(({ id }) => id === "godan-u-tsu-ru-te-form"));
  assert.ok(points.some(({ id }) => id === "iku-te-form"));
  assert.ok(points.some(({ id }) => id === "godan-u-tsu-ru-plain-past"));
  assert.ok(points.some(({ id }) => id === "iku-plain-past"));
  assert.ok(points.some(({ id }) => id === "godan-plain-negative"));
  assert.ok(points.some(({ id }) => id === "kuru-plain-past-negative"));
  assert.ok(points.some(({ id }) => id === "ichidan-conditional-ba"));
  assert.ok(points.some(({ id }) => id === "i-adjective-polite-past"));
  assert.ok(points.some(({ id }) => id === "na-adjective-polite-negative"));
  assert.ok(points.some(({ id }) => id === "ii-adjective-polite-past"));
  assert.ok(points.some(({ id }) => id === "i-adjective-te-form"));
  assert.ok(points.some(({ id }) => id === "na-adjective-te-form"));
  assert.ok(points.some(({ id }) => id === "ii-adjective-te-form"));
  assert.ok(points.some(({ id }) => id === "i-adjective-adverbial"));
  assert.ok(points.some(({ id }) => id === "ii-adjective-adverbial"));
  assert.ok(points.some(({ id }) => id === "na-adjective-adverbial"));
  assert.ok(points.some(({ id }) => id === "i-adjective-plain-past-negative"));
  assert.ok(points.some(({ id }) => id === "ii-adjective-plain-negative"));
  assert.ok(points.some(({ id }) => id === "na-adjective-plain-past"));
  assert.ok(points.some(({ id }) => id === "godan-plain-volitional"));
  assert.ok(points.some(({ id }) => id === "ichidan-potential"));
  assert.ok(points.some(({ id }) => id === "suru-passive"));
  assert.ok(points.some(({ id }) => id === "godan-causative"));
  assert.ok(points.some(({ id }) => id === "ichidan-causative-passive"));
  assert.ok(points.some(({ id }) => id === "godan-su-causative-passive"));
  assert.ok(points.some(({ id }) => id === "kuru-imperative"));
  assert.ok(points.some(({ id }) => id === "kureru-imperative"));
  assert.ok(points.some(({ id }) => id === "godan-negative-conditional-ba"));
  assert.ok(points.some(({ id }) => id === "i-adjective-conditional-ba"));
  assert.ok(points.some(({ id }) => id === "na-adjective-negative-connective"));
  assert.equal(points.filter(({ introducedAt }) => introducedAt === "n4").length, 43);
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
      verb("暑い", "あつい", "i-adjective"),
      forms.plainPastNegative,
      { surface: "暑くなかった", reading: "あつくなかった" }
    ],
    [
      verb("いい", "いい", "ii-adjective"),
      forms.plainNegative,
      { surface: "よくない", reading: "よくない" }
    ],
    [
      verb("静か", "しずか", "na-adjective"),
      forms.plainPast,
      { surface: "静かだった", reading: "しずかだった" }
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

test("plain past follows the て-form sound families", () => {
  const cases = [
    [verb("買う", "かう", "godan"), "買った", "かった", "godan-u-tsu-ru-plain-past"],
    [verb("飲む", "のむ", "godan"), "飲んだ", "のんだ", "godan-mu-bu-nu-plain-past"],
    [verb("書く", "かく", "godan"), "書いた", "かいた", "godan-ku-plain-past"],
    [verb("泳ぐ", "およぐ", "godan"), "泳いだ", "およいだ", "godan-gu-plain-past"],
    [verb("話す", "はなす", "godan"), "話した", "はなした", "godan-su-plain-past"],
    [verb("食べる", "たべる", "ichidan"), "食べた", "たべた", "ichidan-plain-past"],
    [verb("する", "する", "suru"), "した", "した", "suru-plain-past"],
    [verb("来る", "くる", "kuru"), "来た", "きた", "kuru-plain-past"],
    [verb("行く", "いく", "godan", "iku"), "行った", "いった", "iku-plain-past"]
  ];

  for (const [entry, surface, reading, pointId] of cases) {
    assert.deepEqual(conjugateVerb(entry, forms.plainPast), { surface, reading });
    assert.equal(getPointIdForVerb(entry, forms.plainPast), pointId);
  }
});

test("plain negatives and ～ば cover every godan ending", () => {
  const cases = [
    ["会う", "あう", "会わない", "あわない", "会わなかった", "あわなかった", "会えば", "あえば"],
    ["書く", "かく", "書かない", "かかない", "書かなかった", "かかなかった", "書けば", "かけば"],
    ["泳ぐ", "およぐ", "泳がない", "およがない", "泳がなかった", "およがなかった", "泳げば", "およげば"],
    ["話す", "はなす", "話さない", "はなさない", "話さなかった", "はなさなかった", "話せば", "はなせば"],
    ["待つ", "まつ", "待たない", "またない", "待たなかった", "またなかった", "待てば", "まてば"],
    ["死ぬ", "しぬ", "死なない", "しなない", "死ななかった", "しななかった", "死ねば", "しねば"],
    ["遊ぶ", "あそぶ", "遊ばない", "あそばない", "遊ばなかった", "あそばなかった", "遊べば", "あそべば"],
    ["飲む", "のむ", "飲まない", "のまない", "飲まなかった", "のまなかった", "飲めば", "のめば"],
    ["乗る", "のる", "乗らない", "のらない", "乗らなかった", "のらなかった", "乗れば", "のれば"]
  ];

  for (const [term, reading, negative, negativeReading, pastNegative,
    pastNegativeReading, conditional, conditionalReading] of cases) {
    const entry = verb(term, reading, "godan");

    assert.deepEqual(conjugateVerb(entry, forms.plainNegative), {
      surface: negative,
      reading: negativeReading
    });
    assert.deepEqual(conjugateVerb(entry, forms.plainPastNegative), {
      surface: pastNegative,
      reading: pastNegativeReading
    });
    assert.deepEqual(conjugateVerb(entry, forms.conditionalBa), {
      surface: conditional,
      reading: conditionalReading
    });
  }
});

test("plain negatives and ～ば preserve the ichidan and irregular classes", () => {
  const cases = [
    [verb("食べる", "たべる", "ichidan"), forms.plainPastNegative, "食べなかった", "たべなかった"],
    [verb("勉強する", "べんきょうする", "suru"), forms.plainNegative, "勉強しない", "べんきょうしない"],
    [verb("来る", "くる", "kuru"), forms.plainPastNegative, "来なかった", "こなかった"],
    [verb("見る", "みる", "ichidan"), forms.conditionalBa, "見れば", "みれば"],
    [verb("する", "する", "suru"), forms.conditionalBa, "すれば", "すれば"],
    [verb("来る", "くる", "kuru"), forms.conditionalBa, "来れば", "くれば"]
  ];

  for (const [entry, form, surface, reading] of cases) {
    assert.deepEqual(conjugateVerb(entry, form), { surface, reading });
    assert.equal(getPointIdForVerb(entry, form), `${entry.class}-${form}`);
  }
});

test("plain volitional, potential, and passive forms cover every verb class", () => {
  const cases = [
    [verb("書く", "かく", "godan"), forms.plainVolitional, "書こう", "かこう"],
    [verb("食べる", "たべる", "ichidan"), forms.plainVolitional, "食べよう", "たべよう"],
    [verb("勉強する", "べんきょうする", "suru"), forms.plainVolitional, "勉強しよう", "べんきょうしよう"],
    [verb("来る", "くる", "kuru"), forms.plainVolitional, "来よう", "こよう"],
    [verb("読む", "よむ", "godan"), forms.potential, "読める", "よめる"],
    [verb("見る", "みる", "ichidan"), forms.potential, "見られる", "みられる"],
    [verb("勉強する", "べんきょうする", "suru"), forms.potential, "勉強できる", "べんきょうできる"],
    [verb("来る", "くる", "kuru"), forms.potential, "来られる", "こられる"],
    [verb("呼ぶ", "よぶ", "godan"), forms.passive, "呼ばれる", "よばれる"],
    [verb("見る", "みる", "ichidan"), forms.passive, "見られる", "みられる"],
    [verb("勉強する", "べんきょうする", "suru"), forms.passive, "勉強される", "べんきょうされる"],
    [verb("来る", "くる", "kuru"), forms.passive, "来られる", "こられる"]
  ];

  for (const [entry, form, surface, reading] of cases) {
    assert.deepEqual(conjugateVerb(entry, form), { surface, reading });
    assert.equal(getPointIdForVerb(entry, form), `${entry.class}-${form}`);
  }
});

test("causative, causative-passive, and imperative forms cover every godan ending", () => {
  const cases = [
    ["会う", "あう", "会わせる", "あわせる", "会わされる", "あわされる", "会え", "あえ"],
    ["書く", "かく", "書かせる", "かかせる", "書かされる", "かかされる", "書け", "かけ"],
    ["泳ぐ", "およぐ", "泳がせる", "およがせる", "泳がされる", "およがされる", "泳げ", "およげ"],
    ["話す", "はなす", "話させる", "はなさせる", "話させられる", "はなさせられる", "話せ", "はなせ"],
    ["待つ", "まつ", "待たせる", "またせる", "待たされる", "またされる", "待て", "まて"],
    ["死ぬ", "しぬ", "死なせる", "しなせる", "死なされる", "しなされる", "死ね", "しね"],
    ["遊ぶ", "あそぶ", "遊ばせる", "あそばせる", "遊ばされる", "あそばされる", "遊べ", "あそべ"],
    ["飲む", "のむ", "飲ませる", "のませる", "飲まされる", "のまされる", "飲め", "のめ"],
    ["乗る", "のる", "乗らせる", "のらせる", "乗らされる", "のらされる", "乗れ", "のれ"]
  ];

  for (const [term, reading, causative, causativeReading, causativePassive,
    causativePassiveReading, imperative, imperativeReading] of cases) {
    const entry = verb(term, reading, "godan");

    assert.deepEqual(conjugateVerb(entry, forms.causative), {
      surface: causative,
      reading: causativeReading
    });
    assert.deepEqual(conjugateVerb(entry, forms.causativePassive), {
      surface: causativePassive,
      reading: causativePassiveReading
    });
    assert.deepEqual(conjugateVerb(entry, forms.imperative), {
      surface: imperative,
      reading: imperativeReading
    });
  }
});

test("new N4 verb forms preserve the ichidan and irregular classes", () => {
  const cases = [
    [verb("食べる", "たべる", "ichidan"), forms.causative, "食べさせる", "たべさせる"],
    [verb("勉強する", "べんきょうする", "suru"), forms.causative, "勉強させる", "べんきょうさせる"],
    [verb("来る", "くる", "kuru"), forms.causative, "来させる", "こさせる"],
    [verb("食べる", "たべる", "ichidan"), forms.causativePassive, "食べさせられる", "たべさせられる"],
    [verb("勉強する", "べんきょうする", "suru"), forms.causativePassive, "勉強させられる", "べんきょうさせられる"],
    [verb("来る", "くる", "kuru"), forms.causativePassive, "来させられる", "こさせられる"],
    [verb("食べる", "たべる", "ichidan"), forms.imperative, "食べろ", "たべろ"],
    [verb("勉強する", "べんきょうする", "suru"), forms.imperative, "勉強しろ", "べんきょうしろ"],
    [verb("来る", "くる", "kuru"), forms.imperative, "来い", "こい"]
  ];

  for (const [entry, form, surface, reading] of cases) {
    assert.deepEqual(conjugateVerb(entry, form), { surface, reading });
    assert.equal(getPointIdForVerb(entry, form), `${entry.class}-${form}`);
  }

  const kureru = verb("くれる", "くれる", "ichidan");
  kureru.imperativeException = "kureru";
  assert.deepEqual(conjugateVerb(kureru, forms.imperative), {
    surface: "くれ",
    reading: "くれ"
  });
  assert.equal(getPointIdForVerb(kureru, forms.imperative), "kureru-imperative");
});

test("negative verb conditionals and connectives cover every verb class", () => {
  const cases = [
    [verb("書く", "かく", "godan"), "書かなければ", "かかなければ", "書かなくて", "かかなくて"],
    [verb("食べる", "たべる", "ichidan"), "食べなければ", "たべなければ", "食べなくて", "たべなくて"],
    [verb("勉強する", "べんきょうする", "suru"), "勉強しなければ", "べんきょうしなければ", "勉強しなくて", "べんきょうしなくて"],
    [verb("来る", "くる", "kuru"), "来なければ", "こなければ", "来なくて", "こなくて"]
  ];

  for (const [entry, conditional, conditionalReading, connective, connectiveReading] of cases) {
    assert.deepEqual(conjugateVerb(entry, forms.negativeConditionalBa), {
      surface: conditional,
      reading: conditionalReading
    });
    assert.deepEqual(conjugateVerb(entry, forms.negativeConnective), {
      surface: connective,
      reading: connectiveReading
    });
  }
});

test("adjective conditionals and negative connectives cover every adjective class", () => {
  const cases = [
    [verb("高い", "たかい", "i-adjective"), "高ければ", "たかければ", "高くなければ", "たかくなければ", "高くなくて", "たかくなくて"],
    [verb("いい", "いい", "ii-adjective"), "よければ", "よければ", "よくなければ", "よくなければ", "よくなくて", "よくなくて"],
    [verb("静か", "しずか", "na-adjective"), "静かならば", "しずかならば", "静かでなければ", "しずかでなければ", "静かではなくて", "しずかではなくて"]
  ];

  for (const [entry, conditional, conditionalReading, negativeConditional,
    negativeConditionalReading, connective, connectiveReading] of cases) {
    assert.deepEqual(conjugateAdjective(entry, forms.conditionalBa), {
      surface: conditional,
      reading: conditionalReading
    });
    assert.deepEqual(conjugateAdjective(entry, forms.negativeConditionalBa), {
      surface: negativeConditional,
      reading: negativeConditionalReading
    });
    assert.deepEqual(conjugateAdjective(entry, forms.negativeConnective), {
      surface: connective,
      reading: connectiveReading
    });
  }
});

test("the curated vocabulary supplies exercises for every point", async () => {
  const [vocabulary, curriculum] = await Promise.all([
    readFile(new URL("../data/jlpt-n5-vocabulary.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../data/jlpt-n5-conjugation.json", import.meta.url), "utf8").then(JSON.parse)
  ]);
  const pool = createExercisePool(vocabulary, curriculum);
  const coveredPointIds = new Set(pool.map(({ conjugationPointId }) => conjugationPointId));

  assert.equal(curriculum.length, 128);
  assert.equal(new Set(curriculum.map(({ vocabularyId }) => vocabularyId)).size, 128);
  assert.equal(curriculum.filter(({ class: itemClass }) => itemClass === "i-adjective").length, 60);
  assert.equal(curriculum.filter(({ class: itemClass }) => itemClass === "ii-adjective").length, 2);
  assert.equal(curriculum.filter(({ class: itemClass }) => itemClass === "na-adjective").length, 18);
  assert.equal(pool.length, 1820);
  assert.deepEqual(coveredPointIds, new Set(points.map(({ id }) => id)));
  assert.ok(pool.every(({ section }) => section === "conjugation"));
  assert.ok(pool.every(({ meaning }) => typeof meaning === "string" && meaning));
  assert.equal(pool.some(({ term, form }) => {
    return term === "分かる" && form === forms.potential;
  }), false);

  const quietConditional = pool.find(({ term, form }) => {
    return term === "静か" && form === forms.conditionalBa;
  });
  const quietNegativeConditional = pool.find(({ term, form }) => {
    return term === "静か" && form === forms.negativeConditionalBa;
  });
  const quietNegativeConnective = pool.find(({ term, form }) => {
    return term === "静か" && form === forms.negativeConnective;
  });

  assert.equal(gradeAnswer(quietConditional, "静かなら", wanakana).correct, true);
  assert.equal(gradeAnswer(quietNegativeConditional, "静かじゃなければ", wanakana).correct, true);
  assert.equal(gradeAnswer(quietNegativeConditional, "静かではなければ", wanakana).correct, true);
  assert.equal(gradeAnswer(quietNegativeConnective, "静かでなくて", wanakana).correct, true);
  assert.equal(gradeAnswer(quietNegativeConnective, "静かじゃなくて", wanakana).correct, true);

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

  const forcedToDrink = pool.find(({ term, form }) => {
    return term === "飲む" && form === forms.causativePassive;
  });
  const forcedToSpeak = pool.find(({ term, form }) => {
    return term === "話す" && form === forms.causativePassive;
  });
  const giveCommand = pool.find(({ term, form }) => {
    return term === "くれる" && form === forms.imperative;
  });
  const eatCommand = pool.find(({ term, form }) => {
    return term === "食べる" && form === forms.imperative;
  });
  const studyCommand = pool.find(({ term, form }) => {
    return term === "コピーする" && form === forms.imperative;
  });

  assert.equal(forcedToDrink.answerSurface, "飲まされる");
  assert.equal(forcedToDrink.conjugationPointId, "godan-causative-passive");
  assert.equal(gradeAnswer(forcedToDrink, "飲ませられる", wanakana).correct, true);
  assert.equal(forcedToSpeak.answerSurface, "話させられる");
  assert.equal(forcedToSpeak.conjugationPointId, "godan-su-causative-passive");
  assert.equal(gradeAnswer(forcedToSpeak, "話さされる", wanakana).correct, false);
  assert.equal(giveCommand.answerSurface, "くれ");
  assert.equal(giveCommand.conjugationPointId, "kureru-imperative");
  assert.equal(gradeAnswer(eatCommand, "食べよ", wanakana).correct, true);
  assert.equal(gradeAnswer(studyCommand, "コピーせよ", wanakana).correct, true);
  assert.equal(pool.some(({ term, form }) => {
    return term === "いただく" && [
      forms.causative,
      forms.causativePassive,
      forms.imperative
    ].includes(form);
  }), false);
});

test("conjugation exclusions reject unknown or duplicate forms", () => {
  const vocabulary = [{
    id: "understand",
    term: "分かる",
    reading: "わかる",
    meaning: "to understand",
    partOfSpeech: "verb"
  }];

  for (const excludedForms of ["", ["unknown"], [forms.potential, forms.potential]]) {
    assert.throws(() => createExercisePool(vocabulary, [{
      vocabularyId: "understand",
      class: "godan",
      excludedForms
    }]), /invalid excluded forms/u);
  }
});

test("imperative exceptions are restricted to the matching irregular verb", () => {
  const vocabulary = [{
    id: "eat",
    term: "食べる",
    reading: "たべる",
    meaning: "to eat",
    partOfSpeech: "verb"
  }];

  assert.throws(() => createExercisePool(vocabulary, [{
    vocabularyId: "eat",
    class: "ichidan",
    imperativeException: "kureru"
  }]), /invalid imperative exception/u);
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

  const tidyPolite = {
    answerSurface: "片付けます",
    answerReading: "かたづけます",
    conjugationPointIds: ["ichidan-polite-present"]
  };

  assert.equal(gradeAnswer(tidyPolite, "katazukemasu", wanakana).correct, true);
  assert.equal(gradeAnswer(tidyPolite, "かたずけます", wanakana).correct, false);
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
