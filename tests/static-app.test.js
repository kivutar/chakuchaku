import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { toHiragana, toKana, toKatakana } from "wanakana";
import { TokenizerBuilder } from "lindera-wasm-ipadic-nodejs";
import { handleStaticRequest } from "../scripts/serve.js";
import { resolveReadingGrammarExercises } from "../scripts/reading-grammar.js";

const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const allowedCategories = new Set([
  "particle",
  "verb",
  "auxiliary",
  "adjective",
  "noun",
  "interjection",
  "adverb",
  "determiner",
  "conjunction"
]);
const glossCategories = new Set(["noun", "verb", "adjective", "adverb", "interjection"]);
const japaneseTokenPattern = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}々ー]/u;
const trailingHiraganaPattern = /[\p{Script=Hiragana}ー]+$/u;

async function readJson(path) {
  return JSON.parse(await readFile(join(rootDirectory, path), "utf8"));
}

function assertPreparedLesson(lesson, vocabularyById, kanjiById, kanjiByCharacter) {
  const japaneseText = lesson.type === "production" ? lesson.solution : lesson.text;

  assert.match(lesson.id, /^[a-z0-9-]+$/);
  assert.equal(typeof lesson.text, "string");
  assert.ok(lesson.text.length > 0);
  assert.equal(lesson.audio, lesson.readingSentenceId
    ? `assets/voices/reading/${lesson.readingSentenceId}.m4a`
    : `assets/voices/grammar/${lesson.id}.m4a`);
  assert.ok(Array.isArray(lesson.vocabularyIds));
  assert.equal(new Set(lesson.vocabularyIds).size, lesson.vocabularyIds.length);
  assert.ok(lesson.vocabularyIds.every((id) => vocabularyById.has(id)));
  assert.ok(Array.isArray(lesson.kanjiIds));
  assert.equal(new Set(lesson.kanjiIds).size, lesson.kanjiIds.length);
  assert.ok(lesson.kanjiIds.every((id) => kanjiById.has(id)));
  assert.deepEqual(
    lesson.kanjiIds,
    [...new Set(
      [...japaneseText]
        .map((character) => kanjiByCharacter.get(character)?.id)
        .filter(Boolean)
    )]
  );
  assert.ok(Array.isArray(lesson.tokens));
  assert.equal(
    lesson.tokens.map(({ surface }) => surface).join(""),
    japaneseText,
    `${lesson.id} tokens must reconstruct its Japanese content`
  );

  const usedVocabularyIds = new Set();

  for (const token of lesson.tokens) {
    assert.equal(typeof token.surface, "string");
    assert.equal(token.gloss, undefined);
    assert.doesNotMatch(
      token.reading || "",
      /[～〜]/u,
      `${lesson.id}:${token.surface} must not expose an abstract affix marker in its reading`
    );

    if (token.reading && /\p{Script=Han}/u.test(token.surface)) {
      const trailingHiragana = token.surface.match(trailingHiraganaPattern)?.[0];

      if (trailingHiragana) {
        assert.ok(
          token.reading.endsWith(trailingHiragana),
          `${lesson.id}:${token.surface} reading ${token.reading} must match its visible ending`
        );
      }
    }

    if (token.category) {
      assert.ok(allowedCategories.has(token.category));
    }

    if (token.vocabularyId) {
      assert.ok(vocabularyById.has(token.vocabularyId));
      assert.ok(lesson.vocabularyIds.includes(token.vocabularyId));
      usedVocabularyIds.add(token.vocabularyId);
    }

    if (glossCategories.has(token.category) && japaneseTokenPattern.test(token.surface)) {
      assert.ok(token.vocabularyId, `${lesson.id}:${token.surface} must link vocabulary`);
    }
  }

  assert.deepEqual(usedVocabularyIds, new Set(lesson.vocabularyIds));
}

test("generated lessons match their authored sources", async () => {
  const [
    introductionSource,
    exerciseSources,
    introduction,
    exercises,
    grammarPoints,
    vocabulary,
    kanji,
    curriculum
  ] =
    await Promise.all([
      readJson("data/source/introduction.json"),
      readJson("data/source/exercises.json"),
      readJson("data/introduction.json"),
      readJson("data/exercises.json"),
      readJson("data/jlpt-n5-grammar.json"),
      readJson("data/jlpt-n5-vocabulary.json"),
      readJson("data/jlpt-n5-kanji.json"),
      readJson("data/curriculum.json")
    ]);
  const grammarPointIds = new Set(grammarPoints.map(({ id }) => id));
  const vocabularyById = new Map(vocabulary.map((entry) => [entry.id, entry]));
  const kanjiById = new Map(kanji.map((entry) => [entry.id, entry]));
  const kanjiByCharacter = new Map(kanji.map((entry) => [entry.character, entry]));

  assert.equal(introduction.id, introductionSource.id);
  assert.equal(introduction.text, introductionSource.text);
  assert.equal(introductionSource.vocabularyIds, undefined);
  assert.equal(introductionSource.kanjiIds, undefined);
  assert.equal(introductionSource.readings, undefined);
  assert.equal(introductionSource.glosses, undefined);
  assert.equal(introduction.tokenOverrides, undefined);
  assert.deepEqual(introduction.grammarPointIds, introductionSource.grammarPointIds);
  assert.deepEqual(introduction.grammarHighlights, [
    { grammarPointId: "no-possession", tokenStart: 5, tokenEnd: 6 },
    { grammarPointId: "e-direction", tokenStart: 7, tokenEnd: 8 },
    { grammarPointId: "mashou", tokenStart: 13, tokenEnd: 15 }
  ]);
  assertPreparedLesson(introduction, vocabularyById, kanjiById, kanjiByCharacter);
  const baseLevelRank = curriculum.levels.find(({ id }) => {
    return id === introductionSource.minimumLevel;
  }).rank;
  const requiredVariantLevels = curriculum.levels
    .filter(({ rank }) => rank > baseLevelRank)
    .map(({ id }) => id);

  assert.deepEqual(Object.keys(introduction.levelVariants), requiredVariantLevels);
  assert.equal(
    introduction.levelVariants.n4.text,
    introductionSource.levelVariants.n4.text
  );
  assert.equal(introduction.levelVariants.n4.minimumLevel, "n4");
  assert.equal(
    introduction.levelVariants.n4.tokens.find(({ surface }) => surface === "4")?.reading,
    "よん"
  );
  assertPreparedLesson(
    { id: "introduction-n4", ...introduction.levelVariants.n4 },
    vocabularyById,
    kanjiById,
    kanjiByCharacter
  );
  assert.equal(exercises.length, exerciseSources.length);

  const potentialExercise = exercises.find(({ id }) => {
    return id === "n4-can-read-not-write-kanji";
  });

  assert.equal(
    potentialExercise.tokens.find(({ surface }) => surface === "読め")?.reading,
    "よめ"
  );
  assert.equal(
    potentialExercise.tokens.find(({ surface }) => surface === "書け")?.reading,
    "かけ"
  );

  const resolvedSources = resolveReadingGrammarExercises(
    exerciseSources, await readJson("data/source/readings.json")
  );
  const sourceById = new Map(resolvedSources.map((exercise) => [exercise.id, exercise]));
  const ids = new Set([introduction.id]);

  for (const exercise of exercises) {
    const source = sourceById.get(exercise.id);

    assert.ok(source, `Missing source for ${exercise.id}`);
    assert.ok(!ids.has(exercise.id), `Duplicate lesson id ${exercise.id}`);
    ids.add(exercise.id);
    assert.equal(exercise.text, source.text);
    assert.equal(exercise.solution, source.solution);
    assert.equal(exercise.type, source.type);
    assert.deepEqual(exercise.promptVocabularyHints, source.promptVocabularyHints);
    assert.deepEqual(exercise.attribution, source.attribution);
    assert.deepEqual(exercise.grammarPointIds, source.grammarPointIds);
    assert.equal(source.grammarHighlights, undefined);
    assert.equal(source.vocabularyIds, undefined);
    assert.equal(source.kanjiIds, undefined);
    assert.equal(source.readings, undefined);
    assert.equal(source.glosses, undefined);
    assert.equal(exercise.tokenOverrides, undefined);
    assert.ok(
      exercise.grammarPointIds.length >= (exercise.type === "production" ? 1 : 2)
    );
    assert.equal(new Set(exercise.grammarPointIds).size, exercise.grammarPointIds.length);
    assert.ok(exercise.grammarPointIds.every((id) => grammarPointIds.has(id)));
    assert.ok(Array.isArray(exercise.grammarHighlights));
    assert.ok(exercise.grammarHighlights.every(({ grammarPointId, tokenStart, tokenEnd }) => {
      return (
        exercise.grammarPointIds.includes(grammarPointId) &&
        Number.isInteger(tokenStart) &&
        Number.isInteger(tokenEnd) &&
        tokenStart >= 0 &&
        tokenStart < tokenEnd &&
        tokenEnd <= exercise.tokens.length
      );
    }));
    assertPreparedLesson(exercise, vocabularyById, kanjiById, kanjiByCharacter);
  }

  const recognitionExercises = exercises.filter(({ type }) => type !== "production");

  for (const { id } of grammarPoints.filter(({ introducedAt }) => introducedAt === "n4")) {
    assert.ok(
      recognitionExercises.some((exercise) => {
        return exercise.grammarHighlights.some(({ grammarPointId }) => grammarPointId === id);
      }),
      `${id} needs a visible highlight in an N4 recognition exercise`
    );
  }

  const productionExercises = exercises.filter(({ type }) => type === "production");

  assert.equal(productionExercises.length,
    exerciseSources.filter(({ type }) => type === "production").length);
  assert.ok(productionExercises.every(({ id }) => id.startsWith("production-")));
  assert.ok(productionExercises.every(({ text, promptVocabularyHints }) => {
    return (
      Array.isArray(promptVocabularyHints) &&
      promptVocabularyHints.length > 0 &&
      promptVocabularyHints.every(({ word, vocabularyIds }) => (
        new RegExp(`\\b${word}\\b`, "i").test(text) &&
        vocabularyIds.length > 0 &&
        vocabularyIds.every((id) => vocabularyById.has(id))
      ))
    );
  }));
  assert.ok(exercises.every(({ type }) => {
    return type === undefined || type === "production";
  }));

  const preparedById = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const token = (exerciseId, surface) => {
    return preparedById.get(exerciseId).tokens.find((candidate) => candidate.surface === surface);
  };

  assert.equal(token("sister-not-eaten-yet", "何").reading, "なに");
  assert.equal(token("sister-not-eaten-yet", "い").category, "auxiliary");
  assert.equal(token("sister-not-eaten-yet", "い").vocabularyId, undefined);
  assert.equal(token("cat-under-table", "い").category, "verb");
  assert.ok(token("cat-under-table", "い").vocabularyId);
  assert.equal(token("library-weekday-hours", "開い").reading, "あい");
  assert.equal(token("swim-three-times-weekly", "週間").reading, "しゅうかん");
  assert.equal(token("swim-three-times-weekly", "回").reading, "かい");
  assert.equal(token("game-after-homework", "後").reading, "あと");
  assert.equal(token("siblings-study-english", "勉強").category, "noun");
  assert.ok(token("siblings-study-english", "勉強").vocabularyId);
  assert.ok(token("no-school-tomorrow", "あり").vocabularyId);
  assert.equal(token("been-to-japan", "日本").reading, "にほん");
  assert.equal(
    token("birthday-book-gift", "誕生").vocabularyId,
    token("birthday-book-gift", "日").vocabularyId
  );
  assert.ok(token("birthday-book-gift", "くれ").vocabularyId);
  assert.ok(token("order-hot-tea", "ください").vocabularyId);
  assert.equal(token("photography-and-camera", "の").category, "particle");
  assert.equal(token("photography-and-camera", "の").vocabularyId, undefined);
  assert.equal(token("photography-and-camera", "欲しい").category, "adjective");
  assert.ok(token("photography-and-camera", "欲しい").vocabularyId);
  assert.equal(token("meet-around-three", "時").reading, "じ");
  assert.ok(token("meet-around-three", "時").vocabularyId);
  assert.equal(token("meet-around-three", "ごろ").category, "particle");
  assert.equal(token("meet-around-three", "ごろ").vocabularyId, undefined);

  assert.deepEqual(
    preparedById.get("open-window-empty-room").grammarHighlights,
    [
      { grammarPointId: "kedo-contrast", tokenStart: 6, tokenEnd: 7 },
      { grammarPointId: "verb-nakatta", tokenStart: 11, tokenEnd: 13 },
      { grammarPointId: "te-aru-result-state", tokenStart: 3, tokenEnd: 6 },
      { grammarPointId: "dare", tokenStart: 8, tokenEnd: 9 },
      { grammarPointId: "question-word-mo", tokenStart: 9, tokenEnd: 10 }
    ]
  );
  assert.equal(token("spring-gets-warmer", "段々").category, "adverb");
  assert.ok(token("spring-gets-warmer", "段々").vocabularyId);
  assert.equal(
    token("umbrella-belongs-to-sister", "私").vocabularyId,
    "vocab-b6944a5fe271"
  );
  assert.ok(token("siblings-occupations", "員").vocabularyId);
  assert.ok(token("mother-teaches-cake-recipe", "作り方").vocabularyId);
  assert.equal(token("try-hot-soup", "熱そ").category, "adjective");
  assert.equal(token("try-hot-soup", "熱そ").reading, "あつそ");
  assert.ok(token("try-hot-soup", "熱そ").vocabularyId);
  assert.ok(token("try-hot-soup", "スープ").vocabularyId);
  assert.equal(token("umbrella-for-possible-rain", "しれ").category, "auxiliary");
  assert.equal(token("umbrella-for-possible-rain", "しれ").vocabularyId, undefined);
  assert.equal(token("walk-on-mild-day", "あまり").category, "adverb");
  assert.ok(token("walk-on-mild-day", "あまり").vocabularyId);
  assert.equal(token("pack-homework-to-remember", "よう").category, "auxiliary");
  assert.equal(token("pack-homework-to-remember", "よう").vocabularyId, undefined);
  assert.equal(token("snow-forecast-hearsay", "そう").category, "auxiliary");
  assert.equal(token("snow-forecast-hearsay", "そう").vocabularyId, undefined);
  assert.equal(token("breakfast-then-school", "ご飯").reading, "ごはん");
  assert.ok(token("breakfast-then-school", "ご飯").vocabularyId);
  assert.equal(token("brother-owns-three-cars", "台").reading, "だい");
  assert.ok(token("brother-owns-three-cars", "台").vocabularyId);
  assert.ok(token("ask-japanese-test-date", "いつ").vocabularyId);
  assert.equal(token("ask-route-to-station", "やっ").category, "auxiliary");
  assert.equal(token("ask-route-to-station", "やっ").vocabularyId, undefined);
  assert.equal(token("ask-route-to-station", "行き").category, "verb");
  assert.ok(token("ask-route-to-station", "行き").vocabularyId);
  assert.deepEqual(sourceById.get("ask-route-to-station").tokenOverrides, {
    "やっ": { category: "auxiliary" },
    "行き": { category: "verb" }
  });
  assert.equal(token("sister-draws-beautiful-cards", "きれい").reading, "きれい");
  assert.ok(token("sister-draws-beautiful-cards", "きれい").vocabularyId);
  assert.equal(token("explain-missed-call", "ん").category, "auxiliary");
  assert.equal(token("explain-missed-call", "ん").vocabularyId, undefined);
  assert.equal(token("uncertain-help-start-alone", "自分").reading, "じぶん");
  assert.ok(token("uncertain-help-start-alone", "自分").vocabularyId);
  assert.ok(token("ask-reason-for-absence", "なんで").vocabularyId);
  assert.equal(
    token("ask-polite-person-and-opinion", "方").vocabularyId,
    "vocab-22d08b21620a"
  );
  assert.equal(token("ask-polite-person-and-opinion", "方").reading, "かた");
  assert.equal(token("ask-party-schedule-and-age", "何").reading, "なん");
  assert.equal(token("ask-party-schedule-and-age", "曜日").reading, "ようび");
  assert.ok(token("ask-party-schedule-and-age", "曜日").vocabularyId);
  assert.equal(token("ask-party-schedule-and-age", "歳").reading, "さい");
  assert.ok(token("ask-party-schedule-and-age", "歳").vocabularyId);
  assert.deepEqual(sourceById.get("soup-is-a-little-spicy").tokenOverrides, {
    "辛い": { reading: "からい" }
  });
  assert.equal(token("soup-is-a-little-spicy", "辛い").reading, "からい");
});

test("the learning interface opts out of browser translation", async () => {
  const html = await readFile(join(rootDirectory, "index.html"), "utf8");

  assert.match(html, /<html class="notranslate" lang="en" translate="no">/);
  assert.match(html, /<meta name="google" content="notranslate">/);
});

test("the welcome lesson follows the selected curriculum level", async () => {
  const browserCode = await readFile(join(rootDirectory, "app.js"), "utf8");

  assert.match(browserCode, /const targetLevel = getStudyLevel\(curriculum\)/);
  assert.match(browserCode, /baseIntroduction\.levelVariants\?\.\[targetLevel\]/);
  assert.match(
    browserCode,
    /\{ \.\.\.baseIntroduction, \.\.\.levelVariant, id: baseIntroduction\.id \}/
  );
});

test("grammar coverage checklist matches authored exercises", async () => {
  const [grammarPoints, exercises, coverage] = await Promise.all([
    readJson("data/jlpt-n5-grammar.json"),
    readJson("data/source/exercises.json"),
    readFile(join(rootDirectory, "data", "grammar-coverage.md"), "utf8")
  ]);
  const exerciseIdsByGrammarPoint = new Map();

  for (const exercise of exercises) {
    for (const grammarPointId of exercise.grammarPointIds) {
      const exerciseIds = exerciseIdsByGrammarPoint.get(grammarPointId) || [];

      exerciseIds.push(exercise.id);
      exerciseIdsByGrammarPoint.set(grammarPointId, exerciseIds);
    }
  }

  const bullets = coverage.split("\n").filter((line) => line.startsWith("- ["));

  assert.match(
    coverage,
    new RegExp(`Covered: \\*\\*${exerciseIdsByGrammarPoint.size} / ${grammarPoints.length}\\*\\*`)
  );
  assert.equal(bullets.length, grammarPoints.length);

  grammarPoints.forEach((grammarPoint, index) => {
    const exerciseIds = exerciseIdsByGrammarPoint.get(grammarPoint.id) || [];
    const checkbox = exerciseIds.length > 0 ? "x" : " ";

    assert.ok(
      bullets[index].startsWith(`- [${checkbox}] \`${grammarPoint.id}\` - `),
      grammarPoint.id
    );

    for (const exerciseId of exerciseIds) {
      assert.ok(bullets[index].includes(`\`${exerciseId}\``), exerciseId);
    }
  });
});

test("authored exercises cover the core question-word surfaces", async () => {
  const exercises = await readJson("data/source/exercises.json");
  const corpus = exercises.map(({ text }) => text).join("\n");
  const requiredQuestionForms = [
    "何を",
    "誰の",
    "いつ",
    "どこ",
    "どれ",
    "どの",
    "どちら",
    "どっち",
    "どなた",
    "どう",
    "どうやって",
    "どんな",
    "なぜ",
    "どうして",
    "なんで",
    "いかが",
    "いくら",
    "いくつ",
    "何人",
    "何時",
    "何曜日",
    "何歳",
    "どのくらい"
  ];

  for (const form of requiredQuestionForms) {
    assert.ok(corpus.includes(form), `Missing question-word exercise for ${form}`);
  }
});

test("browser code has no application backend or embedded API key", async () => {
  const browserCode = await Promise.all([
    readFile(join(rootDirectory, "app.js"), "utf8"),
    readFile(join(rootDirectory, "autocorrect.js"), "utf8"),
    readFile(join(rootDirectory, "srs.js"), "utf8"),
    readFile(join(rootDirectory, "learning-stats.js"), "utf8"),
    readFile(join(rootDirectory, "hiragana.js"), "utf8"),
    readFile(join(rootDirectory, "katakana.js"), "utf8"),
    readFile(join(rootDirectory, "kanji.js"), "utf8"),
    readFile(join(rootDirectory, "vocabulary.js"), "utf8"),
    readFile(join(rootDirectory, "exercise-selection.js"), "utf8"),
    readFile(join(rootDirectory, "review.js"), "utf8"),
    readFile(join(rootDirectory, "statistics.js"), "utf8"),
    readFile(join(rootDirectory, "settings.js"), "utf8")
  ]).then((files) => files.join("\n"));

  assert.doesNotMatch(browserCode, /\/api\//);
  assert.doesNotMatch(browserCode, /["']\.key["']/);
  assert.doesNotMatch(browserCode, /sk-[a-zA-Z0-9_-]{20,}/);
  assert.match(browserCode, /https:\/\/api\.openai\.com\/v1\/responses/);
});

test("FSRS loads before the app and schedules assessed grammar", async () => {
  const [html, browserCode] = await Promise.all([
    readFile(join(rootDirectory, "index.html"), "utf8"),
    readFile(join(rootDirectory, "app.js"), "utf8")
  ]);

  assert.ok(html.indexOf('src="vendor/ts-fsrs.js"') < html.indexOf('src="srs.js"'));
  assert.ok(html.indexOf('src="srs.js"') < html.indexOf('src="app.js"'));
  assert.ok(html.indexOf('src="exercise-selection.js"') < html.indexOf('src="app.js"'));
  assert.match(browserCode, /pickNextGrammarPoint/);
  assert.match(browserCode, /recordReviews/);
  assert.match(browserCode, /grammarSection\.append\(grammarList\)/);
  assert.match(browserCode, /data-grammar-rating/);
  assert.match(browserCode, /t\("exercise\.again"\)/);
  assert.match(browserCode, /t\("exercise\.good"\)/);
});

test("the main menu links every implemented study route", async () => {
  const [html, browserCode] = await Promise.all([
    readFile(join(rootDirectory, "index.html"), "utf8"),
    readFile(join(rootDirectory, "app.js"), "utf8")
  ]);

  assert.match(html, /data-study-section="hiragana"/);
  assert.match(html, /data-study-section="review"/);
  assert.match(html, /data-study-section="katakana"/);
  assert.match(html, /data-study-section="kanji"/);
  assert.match(html, /data-study-section="vocabulary"/);
  assert.match(html, /data-study-section="grammar"/);
  assert.match(html, /data-study-section="conjugation"/);
  assert.match(html, /id="current-study-label"/);
  assert.ok(html.indexOf('src="hiragana.js"') < html.indexOf('src="app.js"'));
  assert.ok(html.indexOf('src="katakana.js"') < html.indexOf('src="app.js"'));
  assert.ok(html.indexOf('src="kanji.js"') < html.indexOf('src="app.js"'));
  assert.ok(html.indexOf('src="vocabulary.js"') < html.indexOf('src="app.js"'));
  assert.ok(html.indexOf('src="conjugation.js"') < html.indexOf('src="app.js"'));
  assert.ok(html.indexOf('src="review.js"') < html.indexOf('src="app.js"'));
  assert.match(html, /id="review-progress"/);
  assert.match(html, /id="review-section-badge"/);
  assert.match(html, /id="review-complete"/);
  assert.match(html, /id="review-complete"[\s\S]*?aria-live="polite"/);
  assert.match(browserCode, /reviewContinueButton\.focus\(\{ preventScroll: true \}\)/);
  assert.match(browserCode, /await refreshDailyReviewSession\(\)/);
  assert.match(browserCode, /reviewSectionBadge\.dataset\.section = section/);
  assert.match(browserCode, /renderReviewSectionBadge\(lesson\.section\)/);
  assert.match(
    browserCode,
    /async function pickNextExercise[\s\S]*?return \{ \.\.\.exercise, section: "grammar" \};/
  );
  assert.match(
    browserCode,
    /async function loadEligibleDailyReviewItems\(\)[\s\S]*?vocabularyById \|\|= entriesById;[\s\S]*?kanjiById \|\|= kanjiEntriesById;/
  );
  assert.match(
    browserCode,
    /await globalThis\.JlptN5Storage\.flush\(\);[\s\S]*?window\.location\.assign/
  );
  assert.match(browserCode, /vocabularyById\?\.get\(token\.vocabularyId\)/);
  assert.match(browserCode, /vocabularyById\?\.get\(vocabularyId\)/);
  assert.match(
    browserCode,
    /function getCharacterRevealDelay[\s\S]*?currentStudySection === "review"[\s\S]*?return 0;/
  );
  assert.match(browserCode, /currentStudySection/);
  assert.match(browserCode, /pickNextHiraganaExercise/);
  assert.match(browserCode, /pickNextKatakanaExercise/);
  assert.match(browserCode, /pickNextKanjiExercise/);
  assert.match(browserCode, /pickNextVocabularyExercise/);
  assert.match(browserCode, /pickNextConjugationExercise/);
  assert.match(browserCode, /recordKanaReviews/);
  assert.match(browserCode, /recordKanaAttempt/);
  assert.match(browserCode, /solution-kana-item/);
});

test("Conjugation uses reusable deterministic SRS points", async () => {
  const [html, browserCode, conjugationCode, srsCode, statsCode] = await Promise.all([
    readFile(join(rootDirectory, "index.html"), "utf8"),
    readFile(join(rootDirectory, "app.js"), "utf8"),
    readFile(join(rootDirectory, "conjugation.js"), "utf8"),
    readFile(join(rootDirectory, "srs.js"), "utf8"),
    readFile(join(rootDirectory, "learning-stats.js"), "utf8")
  ]);

  assert.match(html, /id="conjugation-guidance"/);
  assert.match(conjugationCode, /function gradeAnswer\(exercise, answer, converter\)/);
  assert.match(conjugationCode, /conjugationPointIds: \[conjugationPointId\]/);
  assert.match(browserCode, /recordConjugationEncounter\(lesson\)/);
  assert.match(browserCode, /recordConjugationReviews\(result\.ratings\)/);
  assert.match(browserCode, /recordConjugationAttempt/);
  assert.match(srsCode, /conjugationCards/);
  assert.match(statsCode, /section: "conjugation"/);
});

test("Vocabulary alternates deterministic translation directions and reviews one word", async () => {
  const [html, browserCode, vocabularyCode, srsCode, statsCode] = await Promise.all([
    readFile(join(rootDirectory, "index.html"), "utf8"),
    readFile(join(rootDirectory, "app.js"), "utf8"),
    readFile(join(rootDirectory, "vocabulary.js"), "utf8"),
    readFile(join(rootDirectory, "srs.js"), "utf8"),
    readFile(join(rootDirectory, "learning-stats.js"), "utf8")
  ]);

  assert.match(html, /id="vocabulary-guidance"/);
  assert.match(vocabularyCode, /japaneseToEnglish: "japanese-to-english"/);
  assert.match(vocabularyCode, /englishToJapanese: "english-to-japanese"/);
  assert.match(vocabularyCode, /completedCount % 2 === 0/);
  assert.match(vocabularyCode, /function gradeAnswer\(exercise, answer\)/);
  assert.match(browserCode, /recordVocabularyEncounter\(lesson\)/);
  assert.match(browserCode, /recordVocabularyReviews/);
  assert.match(browserCode, /recordVocabularyAttempt/);
  assert.match(browserCode, /data-vocabulary-rating/);
  assert.match(browserCode, /recordCurrentVocabularyReview/);
  assert.match(browserCode, /exercise\.vocabularyToJapanese/);
  assert.match(browserCode, /exercise\.vocabularyFromJapanese/);
  assert.match(srsCode, /vocabularyCards/);
  assert.match(statsCode, /section: "vocabulary"/);
});

async function loadAdaptiveFuriganaHelpers(extraContext = {}) {
  await import("../statistics.js");
  const code = await readFile(join(rootDirectory, "app.js"), "utf8");
  const helpers = code.slice(code.indexOf("function getAcquiredKanjiCharacters("),
    code.indexOf("function createTokenElement("));
  return runInNewContext(`${helpers}; ({
    getAcquiredKanjiCharacters, hasOnlyKnownKanji, markAdaptiveFurigana, refreshAdaptiveFurigana
  });`, {
    JlptN5Statistics: globalThis.JlptN5Statistics,
    JlptN5Srs: { getRetrievability: () => 0.9 },
    acquiredKanjiCharacters: new Set(),
    ...extraContext
  });
}

test("adaptive furigana use only mature and mastered kanji cards, without altering progress", async () => {
  const { getAcquiredKanjiCharacters } = await loadAdaptiveFuriganaHelpers();
  const entries = new Map([
    ["sun", { id: "sun", character: "日" }],
    ["moon", { id: "moon", character: "月" }],
    ["school", { id: "school", character: "学" }],
    ["book", { id: "book", character: "本" }],
    ["person", { id: "person", character: "人" }],
    ["unseen", { id: "unseen", character: "語" }]
  ]);
  const cards = {
    sun: { state: 2, stability: 30 }, moon: { state: 2, stability: 100 },
    school: { state: 2, stability: 29.9 }, book: { state: 1, stability: 100 },
    person: { state: 3, stability: 100 }
  };
  const original = JSON.stringify({ entries: [...entries], cards });
  assert.deepEqual([...getAcquiredKanjiCharacters(entries, cards)], ["日", "月"]);
  assert.equal(JSON.stringify({ entries: [...entries], cards }), original);
});

test("mixed, unknown, and out-of-curriculum compounds keep their complete furigana", async () => {
  const { hasOnlyKnownKanji } = await loadAdaptiveFuriganaHelpers();
  const known = new Set(["日", "本", "学", "人", "読"]);
  assert.equal(hasOnlyKnownKanji("日本", known), true);
  assert.equal(hasOnlyKnownKanji("日本語", known), false);
  assert.equal(hasOnlyKnownKanji("学校", known), false);
  assert.equal(hasOnlyKnownKanji("日本橋", known), false);
  assert.equal(hasOnlyKnownKanji("読んで", known), true);
  assert.equal(hasOnlyKnownKanji("人々", known), true);
  assert.equal(hasOnlyKnownKanji("みんな", known), false);
  assert.equal(hasOnlyKnownKanji("々", known), false);
});

test("adaptive furigana refresh existing reading and grammar ruby after a kanji lapse", async () => {
  const knownClass = new Set();
  const ruby = { dataset: { furiganaSurface: "日" }, classList: {
    toggle(name, value) { if (value) knownClass.add(name); else knownClass.delete(name); }
  } };
  const settings = { adaptiveFurigana: true };
  const kanjiById = new Map([["sun", { id: "sun", character: "日" }]]);
  const data = { kanjiCards: { sun: { state: 2, stability: 30 } } };
  let reads = 0;
  const original = JSON.stringify(data);
  const { refreshAdaptiveFurigana } = await loadAdaptiveFuriganaHelpers({
    settings, kanjiById,
    JlptN5Srs: { getRetrievability: () => 0.9, readSrsData: () => { reads += 1; return data; } },
    document: { querySelectorAll: () => [ruby] }
  });
  refreshAdaptiveFurigana();
  assert.ok(knownClass.has("has-known-kanji"));
  assert.equal(JSON.stringify(data), original);
  data.kanjiCards.sun.state = 3;
  refreshAdaptiveFurigana();
  assert.ok(!knownClass.has("has-known-kanji"));
  settings.adaptiveFurigana = false;
  refreshAdaptiveFurigana();
  assert.equal(reads, 2, "the disabled option does not read progress");
});

test("vocabulary readings are optional accessible hints rather than automatic kanji clues", async () => {
  const [html, browserCode] = await Promise.all([
    readFile(join(rootDirectory, "index.html"), "utf8"),
    readFile(join(rootDirectory, "app.js"), "utf8")
  ]);

  assert.match(html, /id="vocabulary-reading-hint"[\s\S]*?type="button"[\s\S]*?aria-expanded="false"/);
  assert.match(html, /id="vocabulary-reading"[^>]*aria-hidden="true"/);
  assert.match(browserCode, /vocabularyReadingHint\.hidden = !showReading/);
  assert.match(browserCode, /setVocabularyReadingHintExpanded\(false\)/);
  assert.match(browserCode, /setMeaningHintExpanded\(vocabularyReadingHint, vocabularyReading, expanded, "Reading"\)/);
  assert.match(browserCode, /vocabularyReadingHint\.addEventListener\("click", handleVocabularyReadingHintClick\)/);
});

test("beginner comprehension gaps have balanced exercises and tracked grammar IDs", async () => {
  const [grammar, exercises, vocabulary, examples, kanji] = await Promise.all([
    readJson("data/jlpt-n5-grammar.json"),
    readJson("data/exercises.json"),
    readJson("data/jlpt-n5-vocabulary.json"),
    readJson("data/vocabulary-examples.json"),
    readJson("data/jlpt-n5-kanji.json")
  ]);

  for (const id of ["de-total-price", "ni-turn-direction", "question-word-demo", "mieru-kikoeru"]) {
    assert.equal(grammar.find((point) => point.id === id).introducedAt, "n5");
    const lessons = exercises.filter(({ grammarPointIds, minimumLevel }) => (
      grammarPointIds.includes(id) && minimumLevel === "n5"
    ));
    assert.ok(lessons.length >= 4, id);
    assert.ok(lessons.some(({ type }) => type === "production"), id);
    assert.ok(lessons.some(({ type }) => type !== "production"), id);
    assert.ok(lessons.every(({ minimumLevel }) => minimumLevel === "n5"), id);
  }

  for (const id of ["leave-station-turn-right", "cinema-after-right-at-intersection"]) {
    assert.ok(exercises.find((entry) => entry.id === id).grammarPointIds.includes("ni-turn-direction"));
  }
  for (const term of ["あちこち", "何でも", "考え", "午前中", "数字", "聞こえる", "見える", "通る", "趣味", "戻る", "もうすぐ"]) {
    assert.equal(vocabulary.find((entry) => entry.term === term).introducedAt, "n5", term);
  }

  const birds = exercises.find(({ id }) => id === "birds-singing-audible");
  assert.ok(birds.vocabularyIds.includes("vocab-c0ecee8c2c68"));
  assert.ok(birds.kanjiIds.includes("kanji-9cf4"));
  assert.deepEqual(kanji.find(({ character }) => character === "鳴").kunReadings, ["な"]);
  const anything = examples.find(({ vocabularyId }) => vocabularyId === "vocab-befa979d0246");
  assert.equal(anything.targetReading, "なんでも");
  assert.equal(exercises.find(({ id }) => id === "restaurant-anything-delicious")
    .tokens.find(({ surface }) => surface === "何でも").reading, "なんでも");
});

test("price and counter exercises preserve contextual sound changes", async () => {
  const exercises = await readJson("data/exercises.json");
  const token = (id, surface) => exercises.find((entry) => entry.id === id)
    .tokens.find((entry) => entry.surface === surface);

  assert.equal(token("fruit-pair-total-price", "百").reading, "びゃく");
  assert.equal(token("production-pencils-three-total", "本").reading, "ぼん");
  assert.equal(token("eggs-six-total-price", "百").reading, "ひゃく");
});

test("reviewed N4 time spans and voiced requests keep correct readings and highlights", async () => {
  const exercises = await readJson("data/exercises.json");
  const timeSpanExercises = exercises.filter(({ grammarPointIds }) => (
    grammarPointIds.includes("aida") || grammarPointIds.includes("aida-ni")
  ));

  assert.ok(timeSpanExercises.length >= 8);
  for (const exercise of timeSpanExercises) {
    const interval = exercise.tokens.find(({ surface }) => surface === "間");
    assert.equal(interval?.reading, "あいだ", exercise.id);
  }

  const glass = exercises.find(({ id }) => id === "n4-fragile-glass-carry-slowly");
  const request = glass.grammarHighlights.find(({ grammarPointId }) => grammarPointId === "te-kudasai");
  assert.ok(request);
  assert.equal(glass.tokens.slice(request.tokenStart, request.tokenEnd)
    .map(({ surface }) => surface).join(""), "でください");

  const hiragana = exercises.find(({ id }) => id === "production-n4-hard-to-read-kanji-in-hiragana");
  assert.equal(hiragana.tokens.find(({ surface }) => surface === "平仮名")?.reading, "ひらがな");
});

test("new grammar combinations retain compound suffix and voiced preparation highlights", async () => {
  const exercises = await readJson("data/exercises.json");
  const highlightedText = (id, pointId) => {
    const exercise = exercises.find((entry) => entry.id === id);
    const highlight = exercise.grammarHighlights.find(({ grammarPointId }) => grammarPointId === pointId);
    assert.ok(highlight, `${id} needs a ${pointId} highlight`);
    return exercise.tokens.slice(highlight.tokenStart, highlight.tokenEnd)
      .map(({ surface }) => surface).join("");
  };

  assert.equal(highlightedText("production-how-to-make-sturdy-desk", "kata-how-to"), "作り方");
  assert.equal(highlightedText("production-n4-call-taxi-while-showering", "te-oku"), "でおいて");
  assert.equal(highlightedText("production-n4-sister-can-eat-egg-free-cake", "ba-conditional"), "なければ");
  assert.equal(highlightedText("production-n4-sister-can-eat-egg-free-cake", "potential-form"), "られます");
});

test("fifth-sentence additions keep contextual readings and inflected grammar highlights", async () => {
  const exercises = await readJson("data/exercises.json");
  const exercise = (id) => {
    const match = exercises.find((entry) => entry.id === id);
    assert.ok(match, `${id} is missing`);
    return match;
  };
  const readings = (id, surface) => exercise(id).tokens
    .filter((token) => token.surface === surface).map(({ reading }) => reading);
  const highlightedText = (id, pointId) => {
    const entry = exercise(id);
    const highlight = entry.grammarHighlights.find(({ grammarPointId }) => grammarPointId === pointId);
    assert.ok(highlight, `${id} needs a ${pointId} highlight`);
    return entry.tokens.slice(highlight.tokenStart, highlight.tokenEnd)
      .map(({ surface }) => surface).join("");
  };

  assert.deepEqual(readings("banana-single-and-bundle-price", "一"), ["いっ"]);
  assert.deepEqual(readings("banana-single-and-bundle-price", "本"), ["ぽん", "ほん"]);
  assert.deepEqual(readings("banana-single-and-bundle-price", "百"), ["ひゃく", "びゃく"]);
  for (const id of ["production-n4-child-unwilling-to-sleep-alone", "n4-thanks-for-explaining-unclear-parts"]) {
    assert.deepEqual(readings(id, "一人"), ["ひとり"]);
  }
  assert.deepEqual(readings("n4-two-people-needed-to-carry-box", "二人"), ["ふたり"]);
  assert.deepEqual(readings("n4-father-drinks-little-rice-based-sake", "米"), ["こめ"]);
  assert.deepEqual(readings("n4-what-to-add-if-food-too-spicy", "辛"), ["から"]);
  for (const id of ["production-n4-light-off-habit-forgot-yesterday", "production-n4-long-drive-break-every-two-hours", "production-n4-personal-rule-try-again-after-failure"]) {
    assert.deepEqual(readings(id, "時"), ["とき"]);
  }

  assert.equal(highlightedText("n4-window-closed-still-too-noisy-to-sleep", "potential-form"), "眠れません");
  assert.equal(highlightedText("n4-clean-desk-before-teacher-honorific-use", "o-ni-naru"), "お使いになる");
  assert.equal(highlightedText("production-n4-humbly-hand-documents-before-teacher-leaves", "o-suru-humble"), "お渡しします");
  assert.equal(highlightedText("n4-respectful-call-number-if-unclear", "o-go-kudasai-honorific"), "お電話ください");
  assert.equal(highlightedText("n4-hearsay-teacher-plays-tennis-honorific", "sou-hearsay"), "そうです");
  assert.equal(highlightedText("n4-hearsay-teacher-plays-tennis-honorific", "sonkeigo-special-verbs"), "なさる");
  assert.equal(highlightedText("n4-humbly-tell-teacher-coming-tomorrow", "to-iu"), "と申しました");
  assert.equal(highlightedText("production-n4-breakfast-ready-around-child-waking-time", "koro"), "頃");
  assert.equal(highlightedText("n4-hard-to-sleep-decision-no-coffee-before-bed", "nakanaka-nai"), "なかなか眠れない");
  assert.equal(highlightedText("production-n4-at-sea-invitation-to-swim-together", "no-desu"), "んだ");
});

test("irregular person counts stay whole without changing larger counts", async () => {
  const [vocabulary, preparationCode] = await Promise.all([
    readJson("data/jlpt-n5-vocabulary.json"),
    readFile(join(rootDirectory, "scripts/prepare-content.js"), "utf8")
  ]);
  const builder = new TokenizerBuilder();
  builder.setDictionary("embedded://ipadic");
  builder.setMode("normal");
  const tokenizer = builder.build();
  const { createVocabularyIndex, tokenizeContent } = runInNewContext(
    `${preparationCode.slice(
      preparationCode.indexOf("function createVocabularyIndex("),
      preparationCode.indexOf("function createKanjiIndex(")
    )}\n({ createVocabularyIndex, tokenizeContent });`,
    { tokenizer }
  );
  const index = createVocabularyIndex(vocabulary);

  for (const [text, surface, reading] of [
    ["一人で帰る。", "一人", "ひとり"],
    ["1人で帰る。", "1人", "ひとり"],
    ["二人で帰る。", "二人", "ふたり"],
    ["2人で帰る。", "2人", "ふたり"]
  ]) {
    const tokens = tokenizeContent(text, index);
    assert.equal(tokens.map((token) => token.surface).join(""), text);
    assert.equal(tokens.find((token) => token.surface === surface)?.details[7], reading);
  }

  for (const text of ["十一人で帰る。", "二十二人で帰る。", "21人で帰る。", "12人で帰る。", "三人で帰る。", "第一人者"]) {
    const tokens = tokenizeContent(text, index);
    assert.equal(tokens.map((token) => token.surface).join(""), text);
    assert.equal(tokens.some((token) => ["一人", "二人", "1人", "2人"].includes(token.surface)), false, text);
    assert.equal(tokens.map((token) => token.details[7]).join(""),
      tokenizer.tokenize(text).map((token) => token.details[7]).join(""), text);
  }
  assert.equal(tokenizeContent("一人一人", index)
    .map((token) => token.details[7]).join(""), "ひとりひとり");
});

test("grammar, stories, and vocabulary examples use whole-word person-count readings", async () => {
  const [exercises, stories, examples] = await Promise.all([
    readJson("data/exercises.json"),
    readJson("data/readings.json"),
    readJson("data/vocabulary-examples.json")
  ]);
  const lessons = [...exercises, ...stories.flatMap((story) => story.sentences), ...examples];
  assert.ok(lessons.some((lesson) => lesson.id === "avoid-walking-home-alone-in-dark"));

  for (const [surface, reading, vocabularyId] of [
    ["一人", "ひとり", "vocab-7de8b40e4f57"],
    ["二人", "ふたり", "vocab-4fa716f651b2"]
  ]) {
    const matches = lessons.filter((lesson) =>
      (lesson.type === "production" ? lesson.solution : lesson.text).includes(surface));
    assert.ok(matches.length > 0);
    for (const lesson of matches) {
      const token = lesson.tokens.find((entry) => entry.surface === surface);
      assert.ok(token, `${lesson.id || lesson.vocabularyId}: ${surface} must remain one word`);
      assert.equal(token.reading, reading);
      assert.equal(token.vocabularyId, vocabularyId);
      if (lesson.grammarPointIds?.includes("common-counters") && lesson.grammarHighlights) {
        const highlight = lesson.grammarHighlights.find((entry) => entry.grammarPointId === "common-counters");
        assert.ok(highlight, `${lesson.id}: keep the counter highlighted`);
        assert.equal(lesson.tokens.slice(highlight.tokenStart, highlight.tokenEnd)
          .map((entry) => entry.surface).join(""), surface);
      }
    }
  }

  const exercise = exercises.find((lesson) => lesson.id === "avoid-walking-home-alone-in-dark");
  const advice = exercise.grammarHighlights.find((highlight) => highlight.grammarPointId === "hou-ga-ii-advice");
  assert.equal(exercise.tokens.slice(advice.tokenStart, advice.tokenEnd)
    .map((token) => token.surface).join(""), "ないほうがいい");
});

test("compound vocabulary keeps word identity and aligned grammar highlights", async () => {
  const [exercises, examples] = await Promise.all([
    readJson("data/exercises.json"),
    readJson("data/vocabulary-examples.json")
  ]);

  for (const [id, vocabularyId, surface, reading] of [
    ["restaurant-anything-delicious", "vocab-befa979d0246", "何でも", "なんでも"],
    ["production-morning-soon-finish", "vocab-d1ce9c780dd7", "午前中", "ごぜんちゅう"]
  ]) {
    const exercise = exercises.find((entry) => entry.id === id);
    const token = exercise.tokens.find((entry) => entry.surface === surface);
    assert.equal(token.vocabularyId, vocabularyId);
    assert.equal(token.reading, reading);
    assert.ok(exercise.vocabularyIds.includes(vocabularyId));
    const example = examples.find((entry) => entry.vocabularyId === vocabularyId);
    assert.equal(example.tokens[example.targetTokenStart].vocabularyId, vocabularyId);
    assert.equal(example.targetTokenEnd, example.targetTokenStart + 1);
  }

  const anything = exercises.find((entry) => entry.id === "restaurant-anything-delicious");
  const highlight = anything.grammarHighlights.find((entry) => entry.grammarPointId === "question-word-demo");
  assert.equal(anything.tokens.slice(highlight.tokenStart, highlight.tokenEnd)
    .map(({ surface }) => surface).join(""), "何でも");
  const morning = exercises.find((entry) => entry.id === "production-morning-soon-finish");
  for (const { grammarPointId, tokenStart, tokenEnd } of morning.grammarHighlights) {
    if (grammarPointId === "no-possession") {
      assert.equal(morning.tokens.slice(tokenStart, tokenEnd).map(({ surface }) => surface).join(""), "の");
    }
  }
});

test("hint hover and explicit activation share one visible and accessible state", async () => {
  const [browserCode, styles] = await Promise.all([
    readFile(join(rootDirectory, "app.js"), "utf8"),
    readFile(join(rootDirectory, "styles.css"), "utf8")
  ]);
  const functions = browserCode.slice(
    browserCode.indexOf("function setMeaningHintExpanded("),
    browserCode.indexOf("function setKatakanaMeaningHintExpanded(")
  );
  const { setMeaningHintExpanded, bindHintHover } = runInNewContext(
    `${functions}\n({ setMeaningHintExpanded, bindHintHover });`,
    { t: (key) => key }
  );
  const attributes = new Map();
  const contentAttributes = new Map();
  const classes = new Set();
  const listeners = new Map();
  const button = {
    classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) },
    setAttribute: (name, value) => attributes.set(name, value),
    addEventListener: (name, handler) => listeners.set(name, handler)
  };
  const content = {
    textContent: "なく",
    setAttribute: (name, value) => contentAttributes.set(name, value)
  };
  const setExpanded = (expanded) => setMeaningHintExpanded(button, content, expanded, "Reading");
  const assertState = (expanded) => {
    assert.equal(classes.has("is-expanded"), expanded);
    assert.equal(attributes.get("aria-expanded"), String(expanded));
    assert.equal(contentAttributes.get("aria-hidden"), String(!expanded));
    assert.equal(attributes.get("aria-label"), expanded ? "common.hideReading" : "common.revealReading");
  };

  bindHintHover(button, setExpanded);
  setExpanded(false);
  listeners.get("pointerenter")({ pointerType: "touch" });
  assertState(false);
  listeners.get("pointerenter")({ pointerType: "mouse" });
  assertState(true);
  setExpanded(false); // Explicit activation can hide a hovered/focused hint.
  assertState(false);
  listeners.get("pointerleave")({ pointerType: "mouse" });
  assertState(false);
  setExpanded(true);
  listeners.get("pointerleave")({ pointerType: "touch" });
  assertState(true);
  setExpanded(false);
  assertState(false);
  assert.doesNotMatch(styles, /\.katakana-meaning-hint:(?:hover|focus)\s+\.katakana-meaning-hint-content/);
  for (const name of ["KatakanaMeaning", "KanjiMeaning", "VocabularyReading"]) {
    const buttonName = name[0].toLowerCase() + name.slice(1) + "Hint";
    assert.ok(browserCode.includes(`bindHintHover(${buttonName}, set${name}HintExpanded)`));
  }
});

test("Grammar answers silently reinforce unrevealed due vocabulary", async () => {
  const [browserCode, vocabularyCode, srsCode] = await Promise.all([
    readFile(join(rootDirectory, "app.js"), "utf8"),
    readFile(join(rootDirectory, "vocabulary.js"), "utf8"),
    readFile(join(rootDirectory, "srs.js"), "utf8")
  ]);

  assert.match(vocabularyCode, /function findContextualVocabularyIds/);
  assert.match(vocabularyCode, /function findRecognizedVocabularyIds/);
  assert.match(browserCode, /excludedVocabularyIds: revealedVocabularyIds/);
  assert.match(browserCode, /markVocabularyHintRevealed/);
  assert.match(browserCode, /filterNewOrDueVocabulary/);
  assert.match(browserCode, /outcome: "good"/);
  assert.match(srsCode, /function filterNewOrDueVocabulary/);
});

test("Kanji uses contextual bidirectional prompts and schedules one target character", async () => {
  const [html, browserCode, kanjiCode, srsCode, statsCode] = await Promise.all([
    readFile(join(rootDirectory, "index.html"), "utf8"),
    readFile(join(rootDirectory, "app.js"), "utf8"),
    readFile(join(rootDirectory, "kanji.js"), "utf8"),
    readFile(join(rootDirectory, "srs.js"), "utf8"),
    readFile(join(rootDirectory, "learning-stats.js"), "utf8")
  ]);

  assert.match(html, /id="kanji-guidance"/);
  assert.match(html, /id="kanji-meaning-hint"[\s\S]*aria-expanded="false"/);
  assert.match(html, /id="kanji-choice-grid"[\s\S]*role="group"/);
  assert.match(kanjiCode, /kanjiToReading: "kanji-to-reading"/);
  assert.match(kanjiCode, /readingToKanji: "reading-to-kanji"/);
  assert.match(kanjiCode, /function getStageOrder\(kanji\)/);
  assert.doesNotMatch(kanjiCode, /\["B6", "B5", "B4"\]/);
  assert.match(kanjiCode, /maskedTerm: term\.replaceAll\(character, "□"\)/);
  assert.match(kanjiCode, /function gradeAnswer\(exercise, answer, converter\)/);
  assert.match(kanjiCode, /function createAnswerChoices\(/);
  assert.match(browserCode, /recordKanjiEncounter\(lesson\)/);
  assert.match(browserCode, /recordKanjiReviews/);
  assert.match(browserCode, /createPositiveVocabularyRating/);
  assert.match(browserCode, /filterNewOrDueVocabulary/);
  assert.match(browserCode, /recordKanjiAttempt/);
  assert.match(
    browserCode,
    /function revealKanjiSolution\(\)[\s\S]*createVocabularyExampleElement\(currentLesson\.example\)/
  );
  assert.match(browserCode, /No kanji example is available/);
  assert.match(browserCode, /data-kanji-rating/);
  assert.match(browserCode, /function selectKanjiChoice\(character\)/);
  assert.match(browserCode, /kanjiChoiceGrid\.addEventListener\("click", handleKanjiChoiceClick\)/);
  assert.match(browserCode, /expectedInventoryCount/);
  assert.doesNotMatch(browserCode, /inventory\.length !== 73/);
  assert.match(browserCode, /activeKanjiIds/);
  assert.match(browserCode, /updateSolutionSpeech\(currentLesson, solutionSpeakButton\)/);
  assert.match(srsCode, /kanjiCards/);
  assert.match(statsCode, /section: "kanji"/);
});

test("Katakana meanings use an accessible secret hint", async () => {
  const [html, browserCode, styles] = await Promise.all([
    readFile(join(rootDirectory, "index.html"), "utf8"),
    readFile(join(rootDirectory, "app.js"), "utf8"),
    readFile(join(rootDirectory, "styles.css"), "utf8")
  ]);

  assert.match(html, /id="katakana-meaning-hint"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /id="katakana-meaning"[\s\S]*aria-hidden="true"/);
  assert.match(browserCode, /function setKatakanaMeaningHintExpanded\(expanded\)/);
  assert.match(browserCode, /kanaMeaning\.hidden = isKatakana/);
  assert.match(browserCode, /katakanaMeaningHint\.hidden = !isKatakana/);
  assert.match(browserCode, /katakanaMeaningHint\.addEventListener\("click"/);
  assert.match(styles, /\.katakana-meaning-hint:hover/);
  assert.match(styles, /\.katakana-meaning-hint:focus/);
  assert.match(styles, /\.katakana-meaning-hint\.is-expanded/);
});

test("Katakana includes paired Hiragana-to-Katakana reviews", async () => {
  const [browserCode, katakanaCode, statsCode] = await Promise.all([
    readFile(join(rootDirectory, "app.js"), "utf8"),
    readFile(join(rootDirectory, "katakana.js"), "utf8"),
    readFile(join(rootDirectory, "learning-stats.js"), "utf8")
  ]);

  assert.match(katakanaCode, /hiraganaToKatakana: "hiragana-to-katakana"/);
  assert.match(katakanaCode, /createKanaPairInventory/);
  assert.match(katakanaCode, /word\.kanaPairs\.flatMap/);
  assert.match(katakanaCode, /function createKanaRatings\(partResults\)/);
  assert.match(
    browserCode,
    /exerciseKindLabel\.textContent = isSingleKatakana[\s\S]*: isHiraganaToKatakana/
  );
  assert.match(browserCode, /t\("exercise\.hiraganaToKatakana"\)/);
  assert.match(browserCode, /hiragana: currentLesson\.hiragana/);
  assert.match(browserCode, /kanaApi\.createKanaRatings\(result\.parts\)/);
  assert.match(browserCode, /\.\.\.hiraganaMetadata, \.\.\.pairedHiraganaMetadata/);
  assert.match(statsCode, /Array\.isArray\(exercise\.reviewKanaParts\)/);
  assert.match(statsCode, /hiraganaToKatakana\s*\? exercise\.hiragana/);
});

test("Katakana includes standalone item-to-rōmaji reviews", async () => {
  const [browserCode, katakanaCode, styles] = await Promise.all([
    readFile(join(rootDirectory, "app.js"), "utf8"),
    readFile(join(rootDirectory, "katakana.js"), "utf8"),
    readFile(join(rootDirectory, "styles.css"), "utf8")
  ]);

  assert.match(katakanaCode, /singleKana: "single-kana"/);
  assert.match(katakanaCode, /function createSingleKanaPool\(words, converter\)/);
  assert.match(katakanaCode, /!\["ッ", "ー"\]\.includes\(katakana\)/);
  assert.match(katakanaCode, /cycleIndex === 2 \? exerciseKinds\.singleKana/);
  assert.match(katakanaCode, /function chooseSingleKanaExercise\(singleKanaPool, targetKana\)/);
  assert.match(browserCode, /getNextExerciseMode\(exerciseHistory\)/);
  assert.match(browserCode, /chooseSingleKanaExercise/);
  assert.match(browserCode, /t\("exercise\.singleKatakana"\)/);
  assert.match(browserCode, /kanaGuidance\.hidden = !isKana \|\| isSingleKatakana/);
  assert.match(browserCode, /classList\.toggle\("is-single-kana", isSingleKatakana\)/);
  assert.match(styles, /\.lesson-sentence\.is-single-kana/);
});

test("production cadence uses completed recognition history", async () => {
  const [html, browserCode, selectionCode] = await Promise.all([
    readFile(join(rootDirectory, "index.html"), "utf8"),
    readFile(join(rootDirectory, "app.js"), "utf8"),
    readFile(join(rootDirectory, "exercise-selection.js"), "utf8")
  ]);

  assert.ok(html.indexOf('src="learning-stats.js"') < html.indexOf('src="exercise-selection.js"'));
  assert.match(browserCode, /JlptN5ExerciseSelection\.selectExerciseTypePool/);
  assert.match(browserCode, /JlptN5ExerciseSelection\.selectTargetExercisePool/);
  assert.match(selectionCode, /productionInterval = 5/);
  assert.match(selectionCode, /recognitionThreshold = 2/);
  assert.match(selectionCode, /newGrammarPointLimit = 1/);
  assert.match(selectionCode, /limitNewGrammarPoints/);
  assert.match(selectionCode, /productionExercises\.length > 0\s*\?\s*productionExercises/);
  assert.ok(
    browserCode.indexOf("selectExerciseTypePool") < browserCode.indexOf("pickNextGrammarPoint(")
  );
  assert.ok(
    browserCode.indexOf("pickNextGrammarPoint(") <
      browserCode.indexOf("selectTargetExercisePool")
  );
});

test("query parameter can force production exercises", async () => {
  const browserCode = await readFile(join(rootDirectory, "app.js"), "utf8");

  assert.match(browserCode, /URLSearchParams\(window\.location\.search\)/);
  assert.match(browserCode, /get\("type"\)/);
  assert.match(browserCode, /forcedExerciseType/);
  assert.match(browserCode, /getExerciseType\(lesson\) === "production"/);
  assert.match(browserCode, /promptVocabularyHints/);
  assert.match(browserCode, /productionGrammarTargets/);
  assert.match(browserCode, /t\("exercise\.writeJapanese"\)/);
});

test("study inputs use the appropriate IME mode", async () => {
  const [html, browserCode] = await Promise.all([
    readFile(join(rootDirectory, "index.html"), "utf8"),
    readFile(join(rootDirectory, "app.js"), "utf8")
  ]);

  assert.ok(html.indexOf('src="vendor/wanakana.js"') < html.indexOf('src="app.js"'));
  assert.ok(html.indexOf('src="voice-paths.js"') < html.indexOf('src="app.js"'));
  assert.match(browserCode, /wanakana\.bind\(translationInput, options\)/);
  assert.match(browserCode, /wanakana\.unbind\(translationInput\)/);
  assert.match(browserCode, /IMEMode: "toHiragana"/);
  assert.match(browserCode, /IMEMode: "toKatakana"/);
  assert.equal(
    toKana("maiasa ha shichiji ni ie wo demasu"),
    "まいあさ は しちじ に いえ を でます"
  );
  assert.equal(toKana("kitte"), "きって");
});

test("vocabulary prompts display alternate readings", async () => {
  const browserCode = await readFile(join(rootDirectory, "app.js"), "utf8");

  assert.match(browserCode, /function getVocabularyReadingLabel\(lesson\)/);
  assert.match(browserCode, /lesson\?\.alternateReadings/);
  assert.match(browserCode, /getVocabularyReadingLabel\(currentLesson\)/);
});

test("submitting commits unfinished romaji in Japanese answers", async () => {
  const browserCode = await readFile(join(rootDirectory, "app.js"), "utf8");

  assert.match(browserCode, /function commitPendingKanaInput\(\)/);
  assert.match(browserCode, /wanakana\.toHiragana/);
  assert.match(browserCode, /wanakana\.toKatakana/);
  assert.match(browserCode, /wanakana\.toKana/);
  assert.match(
    browserCode,
    /if \(!exerciseSubmitted\) \{\s*commitPendingKanaInput\(\);\s*\}/
  );
  assert.equal(toKana("ばんごはn"), "ばんごはん");
  assert.equal(toHiragana("ばんごはn"), "ばんごはん");
  assert.equal(toKatakana("パn"), "パン");
});

test("Enter submits an answer without interrupting IME composition", async () => {
  const browserCode = await readFile(join(rootDirectory, "app.js"), "utf8");

  assert.match(browserCode, /function handleTranslationInputKeydown\(event\)/);
  assert.match(browserCode, /event\.key !== "Enter" \|\| event\.isComposing/);
  assert.match(browserCode, /event\.stopPropagation\(\)/);
  assert.match(browserCode, /actionButton\.click\(\)/);
  assert.match(
    browserCode,
    /translationInput\.addEventListener\("keydown", handleTranslationInputKeydown\)/
  );
  assert.match(browserCode, /function handleResultKeydown\(event\)/);
  assert.match(browserCode, /!exerciseSubmitted/);
  assert.match(browserCode, /actionButton\.disabled/);
  assert.match(browserCode, /document\.addEventListener\("keydown", handleResultKeydown\)/);
});

test("the reply field wraps and grows to show long sentences", async () => {
  const [html, browserCode, styles] = await Promise.all([
    readFile(join(rootDirectory, "index.html"), "utf8"),
    readFile(join(rootDirectory, "app.js"), "utf8"),
    readFile(join(rootDirectory, "styles.css"), "utf8")
  ]);

  assert.match(html, /<textarea[\s\S]*id="translation-input"[\s\S]*rows="1"/);
  assert.match(browserCode, /function resizeTranslationInput\(\)/);
  assert.match(browserCode, /translationInput\.scrollHeight/);
  assert.match(
    browserCode,
    /translationInput\.addEventListener\("input", handleTranslationInputResize\)/
  );
  assert.match(styles, /\.translation-input \{[\s\S]*width: min\(48rem, 100%\)/);
  assert.match(styles, /\.translation-input \{[\s\S]*overflow: hidden/);
  assert.match(styles, /\.translation-input \{[\s\S]*resize: none/);
});

test("browser records exercise encounters after loading the stats layer", async () => {
  const [html, browserCode] = await Promise.all([
    readFile(join(rootDirectory, "index.html"), "utf8"),
    readFile(join(rootDirectory, "app.js"), "utf8")
  ]);

  assert.ok(html.indexOf('src="learning-stats.js"') < html.indexOf('src="app.js"'));
  assert.match(browserCode, /lesson\.id !== introductionId/);
  assert.match(browserCode, /recordExerciseEncounter\(lesson\)/);
  assert.match(
    browserCode,
    /recordExerciseAttempt\(\s*currentLesson,\s*translationInput\.value\s*\)/
  );
});

test("global statistics count every study section", async () => {
  const [browserCode, statisticsCode] = await Promise.all([
    readFile(join(rootDirectory, "app.js"), "utf8"),
    readFile(join(rootDirectory, "statistics.js"), "utf8")
  ]);

  assert.match(browserCode, /label: t\("statistics\.exercisesCompleted"\)/);
  assert.match(browserCode, /overview\.exerciseCounts\.total/);
  assert.match(browserCode, /overview\.exerciseCounts\.hiragana/);
  assert.match(browserCode, /overview\.exerciseCounts\.katakana/);
  assert.match(browserCode, /overview\.exerciseCounts\.kanji/);
  assert.match(browserCode, /overview\.exerciseCounts\.vocabulary/);
  assert.match(browserCode, /overview\.exerciseCounts\.conjugation/);
  assert.match(statisticsCode, /function countCompletedExercises\(exerciseHistory\)/);
  assert.match(statisticsCode, /kana: counts\.hiragana \+ counts\.katakana/);
  assert.match(
    statisticsCode,
    /const globalReviewEvents = \[[\s\S]*\.\.\.events,[\s\S]*\.\.\.kanaEvents,[\s\S]*\.\.\.vocabularyEvents,[\s\S]*\.\.\.kanjiEvents,[\s\S]*\.\.\.conjugationEvents[\s\S]*\]/
  );
  assert.match(statisticsCode, /createReviewDays\(globalReviewEvents, currentTime\)/);
});

test("touch devices activate one sentence token at a time", async () => {
  const [browserCode, styles] = await Promise.all([
    readFile(join(rootDirectory, "app.js"), "utf8"),
    readFile(join(rootDirectory, "styles.css"), "utf8")
  ]);

  assert.match(browserCode, /function handleTokenTap\(event\)/);
  assert.match(browserCode, /const tappedToken = event\.currentTarget/);
  assert.match(browserCode, /tokenElement\.addEventListener\("click", handleTokenTap\)/);
  assert.match(browserCode, /\.token\.is-touch-active/);
  assert.doesNotMatch(browserCode, /touchTokenQuery/);
  assert.match(browserCode, /document\.addEventListener\("click", dismissActiveToken\)/);
  assert.match(styles, /@media \(hover: none\), \(pointer: coarse\)/);
  assert.match(styles, /\.token\[data-category\] \{\s+cursor: pointer/);
  assert.match(styles, /\.token\[data-category="noun"\]\.is-touch-active/);
  assert.match(styles, /\.is-touch-active::after/);
  assert.match(styles, /\)::after \{\s+display: none;/);
  assert.match(styles, /\.is-touch-active::after \{\s+display: block;/);
});

test("user menu exposes accessible navigation placeholders", async () => {
  const [html, browserCode, styles] = await Promise.all([
    readFile(join(rootDirectory, "index.html"), "utf8"),
    readFile(join(rootDirectory, "app.js"), "utf8"),
    readFile(join(rootDirectory, "styles.css"), "utf8")
  ]);

  assert.match(html, /id="profile-menu-button"/);
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, /id="profile-menu"[^>]*role="menu"[^>]*hidden/);
  assert.match(html, />Settings<[^>]*>/);
  assert.match(html, />Statistics<[^>]*>/);
  assert.match(html, /id="history-menu-item"/);
  assert.equal((html.match(/href="https:\/\/apps\.apple\.com\/app\/id6803144387"/gu) || []).length, 1);
  assert.match(html, /id="app-store-welcome-link"[^>]*web-app-store-only[^>]*hidden/);
  assert.match(html, /developer\.apple\.com\/assets\/elements\/badges\/download-on-the-app-store\.svg/);
  assert.match(html, /href="https:\/\/github\.com\/kivutar\/chakuchaku"/);
  assert.match(html, /data-i18n="menu\.about">About<\/span> <span aria-hidden="true">↗<\/span>/);
  assert.match(browserCode, /event\.key === "Escape"/);
  assert.match(browserCode, /event\.key === "ArrowDown"/);
  assert.match(browserCode, /handleOutsideProfileMenuClick/);
  assert.match(browserCode, /openActivity\("history"\)/);
  assert.match(browserCode, /document\.title = `\$\{label\} · \$\{t\("app\.title"\)\}`/);
  assert.match(browserCode, /appStoreWelcomeLink\.hidden = lesson\.id !== introductionId/);
  assert.match(html, /id="web-marketing-summary"[^>]*web-app-store-only[^>]*hidden/);
  assert.match(html, /data-i18n="marketing\.title"/);
  assert.match(browserCode, /webMarketingSummary\.hidden = lesson\.id !== introductionId/);
  assert.match(styles, /html\[data-native-platform\] \.web-app-store-only \{\s+display: none !important;/);
});

test("settings layer loads before the app and exposes every initial control", async () => {
  const [html, browserCode] = await Promise.all([
    readFile(join(rootDirectory, "index.html"), "utf8"),
    readFile(join(rootDirectory, "app.js"), "utf8")
  ]);

  assert.ok(html.indexOf('src="settings.js"') < html.indexOf('src="app.js"'));
  assert.ok(html.indexOf('src="i18n.js"') < html.indexOf('src="app.js"'));

  for (const settingName of [
    "userLanguage",
    "studyLevel",
    "newContentPace",
    "furigana",
    "adaptiveFurigana",
    "autoPlayAudio",
    "visualEffects",
    "soundEffects",
    "tokenColoring",
    "translationTooltips",
    "aiAutoCorrect"
  ]) {
    assert.match(html, new RegExp(`data-setting="${settingName}"`));
  }

  assert.match(browserCode, /JlptN5Settings\.writeSettings/);
  assert.match(browserCode, /async function handleSettingChange\(event\)/);
  assert.match(
    browserCode,
    /if \(\["userLanguage", "studyLevel", "newContentPace"\]\.includes\(input\.dataset\.setting\)\) \{\s+if \(await flushLearnerData\(\)\) \{\s+window\.location\.reload\(\);/
  );
  assert.match(browserCode, /settingsDialog\.showModal\(\)/);
  assert.match(html, /id="openai-api-key"[^>]*type="password"/);
  assert.match(html, /Stored only in this tab/);
  assert.match(browserCode, /readOpenAiApiKey/);
  assert.match(browserCode, /openAiApiKeyInput\.addEventListener\("input", handleSettingChange\)/);
});

test("answer feedback is bundled, optional, and gives pronunciation priority", async () => {
  const [html, browserCode, styles, build, worker] = await Promise.all([
    readFile(join(rootDirectory, "index.html"), "utf8"),
    readFile(join(rootDirectory, "app.js"), "utf8"),
    readFile(join(rootDirectory, "styles.css"), "utf8"),
    readFile(join(rootDirectory, "scripts/build-static.js"), "utf8"),
    readFile(join(rootDirectory, "service-worker.js"), "utf8")
  ]);
  assert.ok(html.indexOf('src="feedback.js"') < html.indexOf('src="app.js"'));
  assert.match(build, /"feedback\.js"/);
  assert.match(worker, /"feedback\.js"/);
  assert.match(browserCode, /firstFeedback && !\(settings\.autoPlayAudio && currentLesson\.audio\)/);
  assert.match(browserCode, /if \(ratedCount === totalCount && totalCount > 0\)/);
  assert.match(browserCode, /if \(requestId === lessonRequestId && exerciseSubmitted\)/);
  assert.match(browserCode, /JlptN5Feedback\.setSpeechActive\(true\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.feedback-stage/);
  assert.match(styles, /\.feedback-particles[\s\S]*?pointer-events: none/);
});

test("review-only sections explain when no cards have been introduced", async () => {
  const [html, browserCode, styles] = await Promise.all([
    readFile(join(rootDirectory, "index.html"), "utf8"),
    readFile(join(rootDirectory, "app.js"), "utf8"),
    readFile(join(rootDirectory, "styles.css"), "utf8")
  ]);

  assert.match(html, /id="study-empty"[^>]*hidden/);
  assert.match(html, /id="study-empty-settings-button"/);
  assert.match(html, /data-i18n="studyEmpty\.message"/);
  assert.match(browserCode, /function createEmptyStudyResult\(section\)/);
  assert.match(browserCode, /function displayStudyEmpty\(section\)/);
  assert.match(
    browserCode,
    /newContentPaceInput\.focus\(\{ preventScroll: true \}\)/
  );
  assert.match(
    browserCode,
    /studyEmptySettingsButton\.addEventListener\("click", handleStudyEmptySettingsClick\)/
  );
  assert.match(styles, /\.study-empty-mark/);
});

test("AI autocorrect uses one bounded structured classification request", async () => {
  const [html, browserCode, autoCorrectCode] = await Promise.all([
    readFile(join(rootDirectory, "index.html"), "utf8"),
    readFile(join(rootDirectory, "app.js"), "utf8"),
    readFile(join(rootDirectory, "autocorrect.js"), "utf8")
  ]);

  assert.ok(html.indexOf('src="autocorrect.js"') < html.indexOf('src="app.js"'));
  assert.match(html, /maxlength="500"/);
  assert.match(autoCorrectCode, /gpt-4\.1-mini/);
  assert.doesNotMatch(autoCorrectCode, /reasoning: \{ effort:/);
  assert.match(autoCorrectCode, /max_output_tokens: 100/);
  assert.match(autoCorrectCode, /service_tier: "default"/);
  assert.match(autoCorrectCode, /store: false/);
  assert.match(autoCorrectCode, /type: "json_schema"/);
  assert.match(browserCode, /assessGrammarPoints/);
  assert.match(browserCode, /t\("autocorrect\.done"\)/);
  assert.match(browserCode, /t\("autocorrect\.failed"\)/);
});

test("speaker checks local narration availability before playback", async () => {
  const [browserCode, styles] = await Promise.all([
    readFile(join(rootDirectory, "app.js"), "utf8"),
    readFile(join(rootDirectory, "styles.css"), "utf8")
  ]);

  assert.match(browserCode, /fetch\(audioUrl, \{ method: "HEAD" \}\)/);
  assert.match(browserCode, /fetch\("data\/available-voices\.json"\)/);
  assert.match(browserCode, /getVocabularyVoicePath\(entry\)/);
  assert.match(browserCode, /bundledSpeechPathsPromise\.then\(\(paths\) => paths\.has\(audioUrl\)\)/);
  assert.match(browserCode, /return new Audio\(new URL\(lesson\.audio, document\.baseURI\)\.href\)/);
  assert.match(browserCode, /currentLesson !== lesson \|\| requestId !== lessonRequestId/);
  assert.match(browserCode, /setSpeakButtonState\(available \? "ready" : "unavailable", button\)/);
  assert.match(browserCode, /if \(!speechAvailable\)/);
  assert.match(browserCode, /getExerciseType\(currentLesson\) === "production"/);
  assert.match(browserCode, /isEnglishToJapanese && currentLesson\.audio/);
  assert.match(browserCode, /renderFuriganaText\(answer, currentLesson\.solution, currentLesson\.tokens, \{ adaptiveFurigana: true \}\)/);
  assert.match(browserCode, /answerSpeakButton\.className = "speak-button solution-speak-button"/);
  assert.match(browserCode, /async function updateSolutionSpeech\(lesson, button, hideWhenUnavailable = false\)/);
  assert.match(browserCode, /updateSpeechAvailability\(lesson, button, false\)/);
  assert.match(browserCode, /updateSolutionSpeech\(currentLesson, solutionSpeakButton\)/);
  assert.match(browserCode, /getConjugationVoicePath\(exercise\)/);
  assert.match(browserCode, /updateSolutionSpeech\(currentLesson, answerSpeakButton, true\)/);
  assert.match(styles, /\.speak-button\[hidden\] \{\s+display: none/);
});

test("Kana-to-Romaji audio waits until the answer is submitted", async () => {
  const browserCode = await readFile(join(rootDirectory, "app.js"), "utf8");

  assert.match(browserCode, /function shouldDelayKanaPromptAudio\(lesson\)/);
  assert.match(browserCode, /lesson\?\.section === "hiragana"/);
  assert.match(browserCode, /lesson\?\.section === "katakana"/);
  assert.match(browserCode, /globalThis\.JlptN5Hiragana/);
  assert.match(browserCode, /globalThis\.JlptN5Katakana/);
  assert.match(browserCode, /directions\.kanaToRomaji/);
  assert.match(
    browserCode,
    /!shouldDelayKanaPromptAudio\(currentLesson\) \|\| exerciseSubmitted/
  );
  assert.match(browserCode, /speakButton\.hidden = !lesson\.audio \|\| delayKanaPromptAudio/);
  assert.match(browserCode, /updateSpeechAvailability\(lesson, speakButton, !delayKanaPromptAudio\)/);
  assert.match(
    browserCode,
    /shouldDelayKanaPromptAudio\(currentLesson\)[\s\S]*updateSolutionSpeech\(currentLesson, speakButton\)/
  );
});

test("grammar ratings are always visible instead of using a disclosure", async () => {
  const browserCode = await readFile(join(rootDirectory, "app.js"), "utf8");

  assert.match(browserCode, /document\.createElement\("section"\)/);
  assert.match(browserCode, /grammarList\.className = "solution-grammar-list"/);
  assert.doesNotMatch(browserCode, /文法を評価済み/);
  assert.doesNotMatch(browserCode, /文法を評価（/);
  assert.doesNotMatch(browserCode, /document\.createElement\("details"\)/);
  assert.doesNotMatch(browserCode, /document\.createElement\("summary"\)/);
});

test("statistics UI combines SRS progress, outcomes, and exposure coverage", async () => {
  const [html, browserCode, statisticsCode, styles] = await Promise.all([
    readFile(join(rootDirectory, "index.html"), "utf8"),
    readFile(join(rootDirectory, "app.js"), "utf8"),
    readFile(join(rootDirectory, "statistics.js"), "utf8"),
    readFile(join(rootDirectory, "styles.css"), "utf8")
  ]);

  assert.match(html, /id="statistics-panel"/);
  assert.match(html, /id="history-panel"/);
  assert.doesNotMatch(html, /role="tab"/);
  assert.match(html, /data-stat-kind="overview"/);
  assert.match(html, /data-stat-kind="grammar"/);
  assert.match(html, /data-stat-kind="conjugation"/);
  assert.match(html, /data-stat-kind="vocabulary"/);
  assert.match(html, /data-stat-kind="kanji"/);
  assert.match(html, /data-stat-kind="hiragana"[\s\S]*aria-label="Hiragana"[\s\S]*>あ</);
  assert.match(html, /data-stat-kind="katakana"[\s\S]*aria-label="Katakana"[\s\S]*>ア</);
  assert.match(html, /data-stat-kind="grammar"[\s\S]*aria-label="Grammar"[\s\S]*>文</);
  assert.match(html, /data-stat-kind="conjugation"[\s\S]*aria-label="Conjugation"[\s\S]*>活</);
  assert.match(html, /data-stat-kind="vocabulary"[\s\S]*aria-label="Vocabulary"[\s\S]*>語</);
  assert.match(html, /data-stat-kind="kanji"[\s\S]*aria-label="Kanji"[\s\S]*>漢</);
  assert.ok(html.indexOf('src="statistics.js"') < html.indexOf('src="app.js"'));
  assert.match(browserCode, /readSrsData/);
  assert.match(browserCode, /createStatisticsModel/);
  assert.match(browserCode, /data-grammar-filter/);
  assert.match(browserCode, /data-exposure-sort/);
  assert.match(browserCode, /stats\.exerciseHistory/);
  assert.match(browserCode, /attempt\.grammarRatings/);
  assert.match(browserCode, /recordExerciseGrammarRatings/);
  assert.match(browserCode, /getLocalDayKey/);
  assert.match(statisticsCode, /recentResults/);
  assert.match(statisticsCode, /needsAttention/);
  assert.match(statisticsCode, /createExposureModel/);
  assert.match(statisticsCode, /function createProgressBreakdown/);
  assert.match(statisticsCode, /masteredStabilityDays = 90/);
  assert.match(statisticsCode, /masteredRetrievability = 0\.8/);
  assert.match(browserCode, /statistics-progress-segment/);
  assert.match(browserCode, /t\("statistics\.mastered"\)/);
  assert.match(browserCode, /t\("statistics\.mature"\)/);
  assert.match(browserCode, /t\("statistics\.consolidating"\)/);
  assert.match(browserCode, /t\("statistics\.learning"\)/);
  assert.match(styles, /data-progress-state="mastered"/);
  assert.match(styles, /data-progress-state="mature"/);
  assert.match(styles, /data-progress-state="consolidating"/);
  assert.match(styles, /data-progress-state="learning"/);
  assert.match(styles, /rgb\(77 130 96 \/ 30%\)/);
  assert.match(styles, /@media \(max-width: 32rem\) \{[\s\S]*\.app-dialog \{[\s\S]*width: 100%;[\s\S]*max-width: 100%/);
  assert.match(styles, /\.stat-kind-control button \{[\s\S]*flex-direction: column;/);
  assert.match(styles, /\.stat-kind-label \{[\s\S]*text-overflow: ellipsis;[\s\S]*white-space: nowrap;/);
  assert.match(styles, /\.stat-kind-label \{\s+display: none;/);
  assert.match(styles, /\.dialog-header \{[\s\S]*flex: 0 0 auto;/);
});

test("history lazily folds days and keeps both navigation levels bounded", async () => {
  const [html, browserCode, historyCode, styles] = await Promise.all([
    readFile(join(rootDirectory, "index.html"), "utf8"),
    readFile(join(rootDirectory, "app.js"), "utf8"),
    readFile(join(rootDirectory, "history.js"), "utf8"),
    readFile(join(rootDirectory, "styles.css"), "utf8")
  ]);

  assert.ok(html.indexOf('src="history.js"') < html.indexOf('src="app.js"'));
  assert.match(historyCode, /const daysPerPage = 7/);
  assert.match(historyCode, /const attemptsPerPage = 50/);
  assert.match(historyCode, /function createHistoryDays\(exerciseHistory, getDayKey\)/);
  assert.match(historyCode, /function createPage\(items, requestedPage, pageSize\)/);
  assert.match(browserCode, /content\.hidden = !expanded/);
  assert.match(browserCode, /if \(expanded\) \{[\s\S]*attemptsPerPage/);
  assert.match(browserCode, /newer\.dataset\.historyPageKind = kind/);
  assert.match(browserCode, /older\.dataset\.historyPageKind = kind/);
  assert.match(browserCode, /historyList\.addEventListener\("click", handleHistoryListClick\)/);
  assert.match(styles, /\.history-day-toggle\[aria-expanded="true"\]/);
  assert.match(styles, /\.history-pagination/);
  assert.match(styles, /grid-template-areas:[\s\S]*"newer older"[\s\S]*"status status"/);
});

test("the branded web loading screen appears once per browser session and never natively", async () => {
  const [html, browserCode, styles] = await Promise.all([
    readFile(join(rootDirectory, "index.html"), "utf8"),
    readFile(join(rootDirectory, "app.js"), "utf8"),
    readFile(join(rootDirectory, "styles.css"), "utf8")
  ]);

  assert.match(html, /sessionStorage\.getItem\("chakuchaku:splash-shown"\)/);
  assert.match(html, /document\.documentElement\.dataset\.splashShown = "true"/);
  assert.match(html, /<script src="vendor\/capacitor\.js"><\/script>/);
  assert.match(html, /Capacitor\?\.isNativePlatform\?\.\(\)/);
  assert.match(browserCode, /splashWasAlreadyShown \? 0 : 1600/);
  assert.match(browserCode, /sessionStorage\.setItem\("chakuchaku:splash-shown", "true"\)/);
  assert.match(styles, /html\[data-splash-shown="true"\] \.loading-screen \{\s+display: none;/);
  assert.match(styles, /html\[data-native-platform\] \.loading-screen \{\s+display: none;/);
});

test("the interface follows the operating system color scheme", async () => {
  const [html, privacyHtml, browserCode, styles] = await Promise.all([
    readFile(join(rootDirectory, "index.html"), "utf8"),
    readFile(join(rootDirectory, "privacy.html"), "utf8"),
    readFile(join(rootDirectory, "app.js"), "utf8"),
    readFile(join(rootDirectory, "styles.css"), "utf8")
  ]);

  for (const document of [html, privacyHtml]) {
    assert.match(document, /name="color-scheme" content="light dark"/);
    assert.match(document, /content="#101412" media="\(prefers-color-scheme: dark\)"/);
  }

  assert.match(styles, /@media \(prefers-color-scheme: dark\)/);
  assert.match(styles, /color-scheme: dark;/);
  assert.match(styles, /background: #101412;/);
  assert.match(browserCode, /matchMedia\("\(prefers-color-scheme: dark\)"\)/);
  assert.match(browserCode, /statusBar\.setStyle\(\{ style: isDark \? "DARK" : "LIGHT" \}\)/);
  assert.match(browserCode, /preferredDarkColorScheme\.addEventListener\("change"/);
});

test("native reminder settings keep the toggle and time on separate rows", async () => {
  const [html, browserCode] = await Promise.all([
    readFile(join(rootDirectory, "index.html"), "utf8"),
    readFile(join(rootDirectory, "app.js"), "utf8")
  ]);

  assert.match(html, /data-i18n="settings\.reviewReminder">Review reminder<\/span>/);
  assert.match(html, /data-i18n="settings\.reviewReminderDescription">Daily notification\.<\/small>/);
  assert.match(html, /class="setting-row native-setting-row setting-row-reminder-time"/);
  assert.match(html, /<label for="review-reminder-time" data-i18n="settings\.reminderTime">Reminder time<\/label>/);
  assert.doesNotMatch(html, /setting-reminder-controls/);
  assert.match(browserCode, /reviewReminderTimeInput\.closest\("\.setting-row"\)\.classList\.toggle/);
});

test("vocabulary inventory has a substantial core and labeled learner favorites", async () => {
  const vocabulary = await readJson("data/jlpt-n5-vocabulary.json");
  const allowedPartsOfSpeech = new Set([
    "adjective",
    "adverb",
    "affix",
    "conjunction",
    "counter",
    "determiner",
    "expression",
    "interjection",
    "noun",
    "number",
    "particle",
    "pronoun",
    "verb"
  ]);
  const ids = new Set();
  const core = vocabulary.filter(({ scope }) => scope === "core");
  const supplemental = vocabulary.filter(({ scope }) => scope === "supplemental");

  assert.ok(core.length >= 700);
  assert.ok(supplemental.length > 0);
  assert.equal(vocabulary.some(({ term }) => term === "N"), false);

  for (const entry of vocabulary) {
    assert.match(entry.id, /^vocab-[a-f0-9]{12}$/);
    assert.ok(!ids.has(entry.id), `Duplicate vocabulary id ${entry.id}`);
    ids.add(entry.id);
    assert.ok(entry.term);
    assert.ok(entry.reading);
    assert.ok(entry.meaning);
    assert.ok(allowedPartsOfSpeech.has(entry.partOfSpeech));
    assert.ok(["core", "supplemental"].includes(entry.scope));
    assert.ok(
      [
        "open-anki-jlpt-decks",
        "curated-learner-favorites",
        "curated-lesson-vocabulary",
        "former-jlpt-level-4",
        "curated-katakana-curriculum",
        "curated-beginner-vocabulary",
        "curated-kanji-vocabulary",
        "curated-migii-vocabulary",
        "curated-beginner-coverage",
        "curated-n4-vocabulary"
      ].includes(entry.source)
    );

    if (entry.variants) {
      assert.ok(Array.isArray(entry.variants));
      assert.ok(entry.variants.every(Boolean));
    }

    if (entry.inflections) {
      assert.ok(Array.isArray(entry.inflections));
      assert.ok(entry.inflections.every(({ surface, reading }) => surface && reading));
      assert.ok(entry.inflections.every(({ allowPartOfSpeechMismatch }) => {
        return (
          allowPartOfSpeechMismatch === undefined ||
          typeof allowPartOfSpeechMismatch === "boolean"
        );
      }));
    }
  }

  const supplementalTerms = new Set(supplemental.map(({ term }) => term));

  for (const term of ["ラーメン", "寿司", "アニメ", "漫画", "ゲーム", "スマホ"]) {
    assert.ok(supplementalTerms.has(term), `Missing learner favorite ${term}`);
  }
});

async function requestStatic(path, method = "GET") {
  const result = {};
  const request = {
    method,
    url: path,
    headers: { host: "127.0.0.1" }
  };
  const response = {
    writeHead(status, headers = {}) {
      result.status = status;
      result.headers = headers;
    },
    end(body) {
      result.body = body;
    }
  };

  await handleStaticRequest(request, response);
  return result;
}

test("preview serves the committed static application", async () => {
  const expectedTypes = new Map([
    ["/", "text/html"],
    ["/landing.css", "text/css"],
    ["/landing.js", "text/javascript"],
    ["/locales/fil.json", "application/json"],
    ["/assets/landing/iphone-hiragana-en.png", "image/png"],
    ["/assets/landing/iphone-hiragana-fr.png", "image/png"],
    ["/assets/landing/iphone-grammar-en.png", "image/png"],
    ["/assets/landing/iphone-grammar-fr.png", "image/png"],
    ["/privacy.html", "text/html"],
    ["/review", "text/html"],
    ["/grammar", "text/html"],
    ["/conjugation", "text/html"],
    ["/hiragana", "text/html"],
    ["/katakana", "text/html"],
    ["/kanji", "text/html"],
    ["/vocabulary", "text/html"],
    ["/app.js", "text/javascript"],
    ["/native-storage.js", "text/javascript"],
    ["/native.js", "text/javascript"],
    ["/native-synapse.js", "text/javascript"],
    ["/pwa.js", "text/javascript"],
    ["/service-worker.js", "text/javascript"],
    ["/manifest.webmanifest", "application/manifest+json"],
    ["/storage.js", "text/javascript"],
    ["/curriculum.js", "text/javascript"],
    ["/voice-paths.js", "text/javascript"],
    ["/srs.js", "text/javascript"],
    ["/hiragana.js", "text/javascript"],
    ["/katakana.js", "text/javascript"],
    ["/kanji.js", "text/javascript"],
    ["/vocabulary.js", "text/javascript"],
    ["/conjugation.js", "text/javascript"],
    ["/vendor/ts-fsrs.js", "text/javascript"],
    ["/vendor/wanakana.js", "text/javascript"],
    ["/vendor/capacitor.js", "text/javascript"],
    ["/vendor/capacitor-preferences.js", "text/javascript"],
    ["/vendor/capacitor-haptics.js", "text/javascript"],
    ["/vendor/capacitor-local-notifications.js", "text/javascript"],
    ["/vendor/capacitor-splash-screen.js", "text/javascript"],
    ["/vendor/capacitor-status-bar.js", "text/javascript"],
    ["/vendor/capacitor-keyboard.js", "text/javascript"],
    ["/vendor/capacitor-app.js", "text/javascript"],
    ["/vendor/capacitor-synapse.js", "text/javascript"],
    ["/vendor/capacitor-filesystem.js", "text/javascript"],
    ["/vendor/capacitor-share.js", "text/javascript"],
    ["/learning-stats.js", "text/javascript"],
    ["/exercise-selection.js", "text/javascript"],
    ["/review.js", "text/javascript"],
    ["/statistics.js", "text/javascript"],
    ["/history.js", "text/javascript"],
    ["/settings.js", "text/javascript"],
    ["/progress.js", "text/javascript"],
    ["/autocorrect.js", "text/javascript"],
    ["/styles.css", "text/css"],
    ["/assets/branding/logo.png", "image/png"],
    ["/assets/branding/icon-192.png", "image/png"],
    ["/assets/branding/icon-512.png", "image/png"],
    ["/assets/branding/icon-maskable-512.png", "image/png"],
    ["/assets/branding/apple-touch-icon.png", "image/png"],
    ["/assets/voices/grammar/introduction.m4a", "audio/mp4"],
    ["/assets/voices/vocab/aa.m4a", "audio/mp4"],
    ["/data/introduction.json", "application/json"],
    ["/data/curriculum.json", "application/json"],
    ["/data/exercises.json", "application/json"],
    ["/data/vocabulary-examples.json", "application/json"],
    ["/data/kanji-contexts.json", "application/json"],
    ["/data/kanji-mnemonics.json", "application/json"],
    ["/data/locales/fr/kanji-contexts.json", "application/json"],
    ["/data/locales/fr/kanji-mnemonics.json", "application/json"],
    ["/data/locales/fr/vocabulary-examples.json", "application/json"],
    ["/data/jlpt-n5-vocabulary.json", "application/json"],
    ["/data/jlpt-n5-grammar.json", "application/json"],
    ["/data/jlpt-n5-conjugation.json", "application/json"]
  ]);

  for (const [path, contentType] of expectedTypes) {
    const response = await requestStatic(path);

    assert.equal(response.status, 200, path);
    const escapedContentType = contentType.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

    assert.match(response.headers["Content-Type"], new RegExp(`^${escapedContentType}`));
    assert.ok(response.body.length > 0);
  }
});

test("web entry points welcome visitors while study links open practice directly", async () => {
  const [home, index, grammar, hiragana] = await Promise.all([
    requestStatic("/"),
    requestStatic("/index.html"),
    requestStatic("/grammar"),
    requestStatic("/hiragana")
  ]);

  assert.equal(home.body.toString(), index.body.toString());
  assert.match(home.body.toString(), /id="hero-title"/);
  assert.match(home.body.toString(), /href="hiragana"/);
  assert.doesNotMatch(home.body.toString(), /src="app\.js"/);
  for (const page of [grammar, hiragana]) {
    assert.match(page.body.toString(), /src="app\.js"/);
    assert.doesNotMatch(page.body.toString(), /id="hero-title"/);
  }
});

test("preview exposes no private files or runtime endpoints", async () => {
  const privatePaths = [
    "/.key",
    "/assets/voices/introduction.m4a",
    "/data/source/introduction.json",
    "/scripts/generate-voices.js",
    "/node_modules/ts-fsrs/dist/index.umd.js",
    "/node_modules/wanakana/wanakana.min.js",
    "/package.json"
  ];

  for (const path of privatePaths) {
    assert.equal((await requestStatic(path)).status, 404, path);
  }

  for (const path of ["/api/speech", "/api/tokenize"]) {
    const response = await requestStatic(path, "POST");

    assert.equal(response.status, 405, path);
    assert.equal(response.headers.Allow, "GET, HEAD");
  }
});
