import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { handleStaticRequest } from "../scripts/serve.js";
import {
  createLessonVoiceItems, createReadingVoiceItems, parseVoiceGenerationArguments
} from "../scripts/generate-voices.js";
import { resolveReadingGrammarExercises } from "../scripts/reading-grammar.js";
import { createReadingCoverage, formatReadingCoverage } from "../scripts/reading-coverage.js";
import "../exercise-selection.js";

const { validatePassages, gradeAnswers, localizedText, filterPassages, paginatePassages, storyUrl } = globalThis.JlptN5Reading;
const readJson = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8").then(JSON.parse);
const sources = await readJson("data/source/readings.json");
const prepared = await readJson("data/readings.json");
const passage = prepared[0];

test("the reading prototype has 20 coherent sentences and five bilingual questions", () => {
  assert.doesNotThrow(() => validatePassages(sources));
  assert.doesNotThrow(() => validatePassages(prepared));
  assert.equal(passage.sentences.length, 20);
  assert.equal(passage.questions.length, 5);
  assert.equal(new Set(passage.sentences.map((sentence) => sentence.paragraph)).size, 5);
  assert.equal(localizedText(passage.title, "fr"), "Un dimanche au parc");
  assert.equal(localizedText(passage.title, "de"), passage.title.en);
});

test("the new N5 library story is distinct, roughly twenty sentences, and has grounded bilingual questions", () => {
  const library = prepared.find(({ id }) => id === "my-first-library-card");
  assert.ok(library);
  assert.equal(library.level, "n5");
  assert.ok(library.sentences.length >= 18 && library.sentences.length <= 22);
  assert.equal(library.questions.length, 5);
  const oldText = new Set(passage.sentences.map(({ text }) => text));
  assert.ok(library.sentences.every(({ text }) => !oldText.has(text)));
  assert.equal(gradeAnswers(library, Object.fromEntries(library.questions.map((question) => [question.id, question.answerId]))).correct, 5);
  const find = (point) => library.sentences.find((sentence) => sentence.grammarPointIds.includes(point));
  assert.match(find("nakereba-naranai").text, /見せなければなりません/u);
  assert.match(find("tari-tari-suru").text, /読んだり、写真を見たりしました/u);
  assert.match(find("nakute-mo-ii").text, /払わなくてもいい/u);
  assert.match(find("te-mo-ii").text, /読んでもいいですか/u);
  assert.match(find("te-wa-ikenai").text, /話してはいけません/u);
  const floorAnswer = library.questions[0].choices.find(({ id }) => id === library.questions[0].answerId);
  assert.match(floorAnswer.label.fr, /deuxième niveau/u);
  assert.match(library.questions[0].explanation.fr, /premier étage/u);
});

test("story search is localized and accent-insensitive, level-aware, and paginated without changing content", () => {
  const original = JSON.stringify(prepared);
  assert.deepEqual(filterPassages(prepared, { query: "BIBLIOTHEQUE chats", locale: "fr" }).map(({ id }) => id), ["my-first-library-card"]);
  assert.equal(filterPassages(prepared, { query: "library", locale: "en" }).length, 1);
  assert.equal(filterPassages(prepared, { query: "not in any story" }).length, 0);
  assert.equal(filterPassages(prepared, { level: "n4" }).length, 0);
  const many = Array.from({ length: 25 }, (_, index) => ({ ...passage, id: `story-${index}`, level: index % 2 ? "n4" : "n5" }));
  assert.equal(filterPassages(many, { level: "n4" }).length, 12);
  assert.equal(paginatePassages(many).items.length, 8);
  const last = paginatePassages(many, 99);
  assert.equal(last.page, 4);
  assert.equal(last.items.length, 1);
  assert.equal(paginatePassages(many, -10).page, 1);
  assert.deepEqual(paginatePassages([], 3), { items: [], page: 1, pages: 1, total: 0 });
  assert.throws(() => paginatePassages(many, 1, 0), /page size/);
  assert.equal(JSON.stringify(prepared), original);
});

test("shareable story URLs preserve the native/web reading route and unrelated query parameters", () => {
  for (const base of ["http://127.0.0.1:4174/reading", "https://kivutar.github.io/chakuchaku/reading/", "capacitor://localhost/reading"]) {
    const link = storyUrl(`${base}?qa=fr#reading-questions`, "my-first-library-card");
    assert.equal(new URL(link).searchParams.get("story"), "my-first-library-card");
    assert.equal(new URL(link).searchParams.get("qa"), "fr");
    assert.equal(new URL(link).hash, "");
    assert.equal(new URL(link).pathname, new URL(base).pathname);
    assert.equal(storyUrl(link), `${base}?qa=fr`);
  }
});

test("internal reading coverage is reproducible, counts sentences once, and exposes gaps per level", async () => {
  const grammar = await readJson("data/jlpt-n5-grammar.json");
  const original = JSON.stringify(sources);
  const coverage = createReadingCoverage(sources, grammar);
  assert.deepEqual(coverage, await readJson("data/reading-coverage.json"));
  assert.equal(formatReadingCoverage(coverage), await readFile(new URL("../data/reading-coverage.md", import.meta.url), "utf8"));
  assert.equal(coverage.totalPassages, sources.length);
  assert.equal(coverage.totalSentences, sources.flatMap(({ sentences }) => sentences).length);
  assert.equal(coverage.points.find(({ id }) => id === "nakereba-naranai").sentences, 1);
  assert.equal(coverage.points.find(({ id }) => id === "tari-tari-suru").passages, 1);
  assert.ok(coverage.levels.find(({ level }) => level === "n5").coveredPoints > 35);
  assert.ok(coverage.levels.every(({ coveredPoints, totalPoints, uncoveredPointIds }) => coveredPoints + uncoveredPointIds.length === totalPoints));
  assert.equal(JSON.stringify(sources), original);
  const unknown = structuredClone(sources);
  unknown[1].sentences[0].grammarPointIds = ["invented"];
  assert.throws(() => createReadingCoverage(unknown, grammar), /unknown reading grammar point/u);
  unknown[1].sentences[0].grammarPointIds = [grammar.find(({ introducedAt }) => introducedAt === "n4").id];
  assert.throws(() => createReadingCoverage(unknown, grammar), /grammar exceeds/u);
  const duplicate = structuredClone(sources);
  duplicate[1].sentences[0].grammarPointIds = ["ni-time", "ni-time"];
  assert.throws(() => validatePassages(duplicate), /unique point IDs/u);
  delete duplicate[1].sentences[0].grammarPointIds;
  assert.throws(() => validatePassages(duplicate), /unique point IDs/u);
});

test("every reading sentence has matching tokens, kana furigana, and dictionary helpers", async () => {
  const vocabulary = await readJson("data/jlpt-n5-vocabulary.json");
  const vocabularyById = new Map(vocabulary.map((entry) => [entry.id, entry]));
  for (const reading of prepared) {
    for (const sentence of reading.sentences) {
      assert.equal(sentence.tokens.map(({ surface }) => surface).join(""), sentence.text);
      assert.equal(sentence.audio, `assets/voices/reading/${sentence.id}.m4a`);
      assert.equal(sentence.minimumLevel, reading.level);
      assert.ok(sentence.vocabularyIds.length > 0);
      for (const token of sentence.tokens) {
        if (/\p{Script=Han}/u.test(token.surface)) assert.match(token.reading, /^[\p{Script=Hiragana}ー]+$/u);
        if (!token.vocabularyId) continue;
        const entry = vocabularyById.get(token.vocabularyId);
        assert.ok(entry, token.surface);
        assert.equal(entry.introducedAt, "n5");
      }
    }
  }
  const reading = (sentenceNumber) => passage.sentences[sentenceNumber - 1].tokens
    .map((token) => token.reading || token.surface).join("");
  assert.match(reading(5), /^くじ/u);
  assert.match(reading(6), /にじゅっぷん/u);
  assert.match(reading(7), /さんじゅっぷんご/u);
  assert.match(reading(9), /ふたり/u);
  assert.match(reading(19), /^さんにん/u);
});

test("the quiz grades exactly one choice per question without mutating content or answers", () => {
  const answers = Object.fromEntries(passage.questions.map((question) => [question.id, question.answerId]));
  const originalPassage = JSON.stringify(passage);
  const originalAnswers = JSON.stringify(answers);
  assert.equal(gradeAnswers(passage, answers).correct, 5);
  assert.equal(JSON.stringify(passage), originalPassage);
  assert.equal(JSON.stringify(answers), originalAnswers);
  answers.lunch = "sister";
  const grade = gradeAnswers(passage, answers);
  assert.equal(grade.correct, 4);
  assert.equal(grade.total, 5);
  assert.deepEqual(grade.results[0], {
    questionId: "lunch", answerId: "sister", correctAnswerId: "mother", correct: false
  });
  assert.throws(() => gradeAnswers(passage, {}), /choose an answer/);
  assert.throws(() => gradeAnswers(passage, { ...answers, lunch: "invented" }), /choose an answer/);
});

test("reading validation rejects broken question keys, evidence, IDs, paragraphs, and translations", () => {
  for (const mutate of [
    (p) => { p.questions[0].answerId = "missing"; },
    (p) => { p.questions[0].evidenceSentenceIds = ["missing"]; },
    (p) => { p.questions[0].choices[1].id = p.questions[0].choices[0].id; },
    (p) => { p.sentences[1].id = p.sentences[0].id; },
    (p) => { p.sentences[0].paragraph = 2; },
    (p) => { p.sentences[4].paragraph = 3; },
    (p) => { delete p.questions[0].explanation.fr; }
  ]) {
    const changed = structuredClone(sources);
    mutate(changed[0]);
    assert.throws(() => validatePassages(changed));
  }
  assert.throws(() => validatePassages([]));
  assert.throws(() => validatePassages([...sources, ...sources]));
});

test("reading voices use their own bounded generation target and original Japanese text", () => {
  assert.throws(() => parseVoiceGenerationArguments(["--target", "reading"]), /requires --limit/);
  assert.equal(parseVoiceGenerationArguments(["--target", "reading", "--limit", "2"]).generationLimit, 2);
  assert.throws(() => parseVoiceGenerationArguments(["--target", "reading", "--limit", "2", "--exercise-type", "recognition"]), /only available for lesson/);
  const items = createReadingVoiceItems(sources);
  assert.equal(items.length, sources.flatMap(({ sentences }) => sentences).length);
  assert.equal(items[0].text, sources[0].sentences[0].text);
  assert.equal(items[0].introducedAt, "n5");
  assert.equal(items[0].minimumLevel, "n5");
});

test("reading is served locally and linked in the static and offline app", async () => {
  const request = async (url) => {
    let status;
    let headers;
    let body;
    await handleStaticRequest({ url, method: "GET", headers: { host: "localhost" } }, {
      writeHead: (value, metadata) => { status = value; headers = metadata; },
      end: (value) => { body = value; }
    });
    return { status, headers, body };
  };
  for (const path of ["/reading", "/reading.js", "/reading-view.js", "/data/readings.json"]) {
    assert.equal((await request(path)).status, 200, path);
  }
  const redirect = await request("/reading/");
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.Location, "/reading");
  const storyRedirect = await request("/reading/?story=my-first-library-card");
  assert.equal(storyRedirect.headers.Location, "/reading?story=my-first-library-card");
  const [html, build, sw, app, view] = await Promise.all([
    "index.html", "scripts/build-static.js", "service-worker.js", "app.js", "reading-view.js"
  ].map((path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")));
  assert.match(html, /data-study-section="reading"/u);
  for (const content of [build, sw]) {
    for (const path of ["reading.js", "reading-view.js", "data/readings.json"]) assert.ok(content.includes(`"${path}"`));
    assert.ok(content.includes('"reading"'));
  }
  assert.match(app, /section !== "reading"/u, "reading must not be picked as SRS free practice");
  assert.doesNotMatch(view, /JlptN5(?:Srs|Stats|History|Progress|Storage)/u);
});

test("the question shortcut stays on the reading page despite static route base URLs", async () => {
  const view = await readFile(new URL("../reading-view.js", import.meta.url), "utf8");
  const assignment = view.match(/questionLink\.href = [^;]+;/u)?.[0];
  assert.ok(assignment);
  for (const pageUrl of [
    "http://127.0.0.1:4174/reading",
    "https://kivutar.github.io/chakuchaku/reading/",
    "https://kivutar.github.io/chakuchaku/reading/?qa=fr"
  ]) {
    const questionLink = {};
    runInNewContext(assignment, { questionLink, window: { location: { href: pageUrl } }, URL });
    const target = new URL(questionLink.href, new URL("../", pageUrl));
    assert.equal(target.href, `${pageUrl}#reading-questions`);
  }
});

test("borrowed grammar sources resolve both directions without copying or mutating Japanese content", () => {
  const readingSentence = sources[0].sentences[4];
  const authored = [
    { id: "ordinary", text: "日本語です。", solution: "It is Japanese." },
    { id: "borrowed", readingSentenceId: readingSentence.id, solution: "I left home at nine." },
    { id: "production-borrowed", type: "production", readingSentenceId: readingSentence.id,
      text: "I left home at nine." }
  ];
  const original = JSON.stringify({ authored, sources });
  const resolved = resolveReadingGrammarExercises(authored, sources);
  assert.equal(resolved[0], authored[0], "ordinary exercises remain unchanged");
  assert.equal(resolved[1].text, readingSentence.text);
  assert.equal(resolved[1].solution, authored[1].solution);
  assert.equal(resolved[2].solution, readingSentence.text);
  assert.equal(resolved[2].text, authored[2].text);
  for (const exercise of resolved.slice(1)) {
    assert.deepEqual(exercise.grammarPointIds, readingSentence.grammarPointIds);
    assert.deepEqual(exercise.tokenOverrides, readingSentence.tokenOverrides);
    assert.equal(exercise.minimumLevel, sources[0].level);
    assert.equal(exercise.audio, `assets/voices/reading/${readingSentence.id}.m4a`);
  }
  assert.equal(JSON.stringify({ authored, sources }), original);

  const updated = structuredClone(sources);
  updated[0].level = "n4";
  updated[0].sentences[4].text = "新しい文です。";
  updated[0].sentences[4].tokenOverrides = { 新しい: { reading: "あたらしい" } };
  updated[0].sentences[4].skipVoiceGeneration = true;
  for (const exercise of resolveReadingGrammarExercises(authored, updated).slice(1)) {
    assert.equal(exercise.minimumLevel, "n4");
    assert.equal(exercise.skipVoiceGeneration, true);
    assert.deepEqual(exercise.tokenOverrides, updated[0].sentences[4].tokenOverrides);
    assert.equal(exercise.type === "production" ? exercise.solution : exercise.text, "新しい文です。");
  }
});

test("borrowed grammar rejects missing references and attempts to override shared content", () => {
  assert.throws(() => resolveReadingGrammarExercises([
    { id: "drifted-tags", readingSentenceId: sources[0].sentences[0].id, solution: "Translation.", grammarPointIds: ["te-kara"] }
  ], sources), /grammar tags must match/u);
  assert.throws(() => resolveReadingGrammarExercises([
    { id: "duplicated-tags", readingSentenceId: sources[0].sentences[0].id, solution: "Translation.", grammarPointIds: ["copula-past", "copula-past", "no-possession"] }
  ], sources), /grammar tags must match/u);
  for (const readingSentenceId of [null, "", "not-a-reading-sentence"]) {
    assert.throws(() => resolveReadingGrammarExercises([
      { id: "invalid", readingSentenceId, solution: "Translation." }
    ], sources), /unknown reading sentence/u);
  }
  for (const type of [undefined, "recognition", "production"]) {
    const japaneseField = type === "production" ? "solution" : "text";
    const translationField = type === "production" ? "text" : "solution";
    for (const field of [japaneseField, "tokenOverrides", "vocabularyOverrides", "speechText",
      "skipVoiceGeneration", "audio", "minimumLevel"]) {
      assert.throws(() => resolveReadingGrammarExercises([
        { id: "invalid", readingSentenceId: sources[0].sentences[0].id, type,
          [translationField]: "Translation.", [field]: "override" }
      ], sources), /must come from its reading sentence/u, field);
    }
  }
  assert.throws(() => resolveReadingGrammarExercises([
    { id: "invalid", readingSentenceId: sources[0].sentences[0].id, type: "quiz" }
  ], sources), /invalid reading grammar exercise type/u);
});

test("every story sentence joins the grammar pool in both directions with the original furigana and audio", async () => {
  const [authored, exercises, french] = await Promise.all([
    readJson("data/source/exercises.json"), readJson("data/exercises.json"),
    readJson("data/locales/fr/exercises.json")
  ]);
  const originals = new Map(authored.map((exercise) => [exercise.id, exercise]));
  const borrowed = exercises.filter((exercise) => exercise.readingSentenceId !== undefined);
  assert.equal(borrowed.length, prepared.flatMap(({ sentences }) => sentences).length * 2);
  const ordinaryJapanese = new Set(exercises.filter((exercise) => !exercise.readingSentenceId)
    .map((exercise) => exercise.type === "production" ? exercise.solution : exercise.text));
  for (const { sentence, level } of prepared.flatMap((reading) => (
    reading.sentences.map((sentence) => ({ sentence, level: reading.level }))
  ))) {
    const pair = borrowed.filter((exercise) => exercise.readingSentenceId === sentence.id);
    assert.equal(pair.length, 2, sentence.id);
    const recognition = pair.find((exercise) => exercise.type !== "production");
    const production = pair.find((exercise) => exercise.type === "production");
    assert.ok(recognition && production);
    assert.equal(recognition.text, sentence.text);
    assert.equal(production.solution, sentence.text);
    assert.equal(recognition.solution, production.text);
    assert.deepEqual(recognition.grammarPointIds, production.grammarPointIds);
    assert.deepEqual(recognition.grammarPointIds, sentence.grammarPointIds);
    assert.equal(french[recognition.id].translation, french[production.id].translation);
    assert.ok(french[recognition.id].translation.trim());
    assert.ok(!ordinaryJapanese.has(sentence.text), sentence.id);
    for (const exercise of pair) {
      assert.equal(exercise.audio, sentence.audio);
      assert.equal(exercise.minimumLevel, level);
      assert.deepEqual(exercise.tokens, sentence.tokens, exercise.id);
      assert.deepEqual(exercise.vocabularyIds, sentence.vocabularyIds);
      assert.deepEqual(exercise.kanjiIds, sentence.kanjiIds);
      assert.equal(originals.get(exercise.id)[exercise.type === "production" ? "solution" : "text"], undefined);
    }
  }
});

test("library grammar cards have localized dictionary hints for the exact vocabulary in their Japanese answers", async () => {
  const [exercises, french] = await Promise.all([
    readJson("data/exercises.json"), readJson("data/locales/fr/exercises.json")
  ]);
  const productions = exercises.filter((exercise) => exercise.type === "production" &&
    exercise.readingSentenceId?.startsWith("reading-library-card-"));
  assert.equal(productions.length, 20);
  for (const exercise of productions) {
    assert.ok(exercise.promptVocabularyHints.length > 0);
    const localized = french[exercise.id];
    assert.equal(localized.promptVocabularyHints.length, exercise.promptVocabularyHints.length);
    for (const [index, hint] of exercise.promptVocabularyHints.entries()) {
      assert.ok(exercise.text.toLowerCase().includes(hint.word.toLowerCase()));
      const localizedHint = localized.promptVocabularyHints[index];
      assert.ok(localized.translation.toLowerCase().includes(localizedHint.word.toLowerCase()));
      assert.deepEqual(localizedHint.vocabularyIds, hint.vocabularyIds);
      assert.ok(hint.vocabularyIds.every((id) => exercise.vocabularyIds.includes(id)));
    }
  }
  const floor = productions.find(({ readingSentenceId }) => readingSentenceId === "reading-library-card-03");
  assert.match(floor.text, /second floor/u);
  assert.match(french[floor.id].translation, /deuxième niveau/u);
  const examples = productions.find(({ readingSentenceId }) => readingSentenceId === "reading-library-card-17");
  assert.match(examples.text, /things like/u);
  assert.match(french[examples.id].translation, /notamment/u);
});

test("library grammar assessment keeps obligation, permission, prohibition, and progressive forms distinct", async () => {
  const exercises = await readJson("data/exercises.json");
  for (const [number, point, surface] of [
    [4, "te-iru-progressive", "でいました"],
    [10, "nakereba-naranai", "なければなりません"],
    [11, "nakute-mo-ii", "なくてもいい"],
    [15, "te-mo-ii", "でもいい"],
    [16, "te-wa-ikenai", "てはいけません"],
    [17, "tari-tari-suru", "たりしました"]
  ]) {
    const pair = exercises.filter((exercise) => exercise.readingSentenceId ===
      `reading-library-card-${String(number).padStart(2, "0")}`);
    assert.equal(pair.length, 2);
    for (const exercise of pair) {
      assert.ok(exercise.grammarPointIds.includes(point));
      const highlight = exercise.grammarHighlights.find(({ grammarPointId }) => grammarPointId === point);
      assert.ok(highlight, `${exercise.id}: missing ${point} highlight`);
      assert.equal(exercise.tokens.slice(highlight.tokenStart, highlight.tokenEnd)
        .map((token) => token.surface).join(""), surface);
    }
  }
  for (const [number, excluded] of [[4, "te-iru-result-state"], [11, "te-wa-ikenai"],
    [15, "nakute-mo-ii"], [17, "te-action-link"]]) {
    assert.ok(exercises.filter((exercise) => exercise.readingSentenceId ===
      `reading-library-card-${String(number).padStart(2, "0")}`)
      .every((exercise) => !exercise.grammarPointIds.includes(excluded)));
  }
});

test("the story's grammar tags retain the meaning of particles and conjugated constructions", async () => {
  const exercises = await readJson("data/exercises.json");
  const find = (number) => exercises.find((exercise) => (
    exercise.readingSentenceId === `reading-sunday-park-${String(number).padStart(2, "0")}` &&
    exercise.type !== "production"
  ));
  assert.ok(find(2).grammarPointIds.includes("tai-desire"));
  assert.ok(find(3).grammarPointIds.includes("te-kureru"));
  assert.ok(find(5).grammarPointIds.includes("o-route"));
  assert.ok(!find(5).grammarPointIds.includes("o-object"));
  assert.ok(find(6).grammarPointIds.includes("made-end"));
  assert.ok(!find(6).grammarPointIds.includes("kara-made-range"));
  assert.ok(find(8).grammarPointIds.includes("tai-desire"));
  assert.ok(!find(8).grammarPointIds.includes("verb-nai"));
  assert.ok(find(9).grammarPointIds.includes("i-adjective-negative"));
  assert.ok(find(16).grammarPointIds.includes("relative-clause"));
  assert.ok(find(17).grammarPointIds.includes("naru-ku-change"));
  assert.ok(!find(17).grammarPointIds.includes("naru-change"));
  assert.ok(find(18).grammarPointIds.includes("i-adjective-adverb"));
  assert.ok(find(19).grammarPointIds.includes("common-counters"));
  assert.ok(find(19).grammarPointIds.includes("ni-target-recipient"));
  assert.ok(!find(19).grammarPointIds.includes("de-means"));
  for (const [number, point, surface] of [
    [8, "tai-desire", "たくない"], [17, "naru-ku-change", "暗くなりました"],
    [19, "ni-target-recipient", "に"]
  ]) {
    const exercise = find(number);
    const highlight = exercise.grammarHighlights.find(({ grammarPointId }) => grammarPointId === point);
    assert.ok(highlight);
    assert.equal(exercise.tokens.slice(highlight.tokenStart, highlight.tokenEnd)
      .map((token) => token.surface).join(""), surface);
  }
});

test("borrowed exercises are selected normally and train existing grammar units only", async () => {
  const [exercises, grammar] = await Promise.all([
    readJson("data/exercises.json"), readJson("data/jlpt-n5-grammar.json")
  ]);
  const borrowed = exercises.filter((exercise) => exercise.readingSentenceId);
  const grammarById = new Map(grammar.map((point) => [point.id, point]));
  for (const exercise of borrowed) {
    for (const id of exercise.grammarPointIds) {
      assert.equal(grammarById.get(id)?.introducedAt, "n5");
      assert.ok(exercises.some((other) => !other.readingSentenceId && other.grammarPointIds.includes(id)));
    }
  }
  const selection = globalThis.JlptN5ExerciseSelection;
  assert.equal(selection.selectExerciseTypePool({
    exercises, candidates: borrowed, exerciseHistory: []
  }).length, borrowed.length / 2);
  assert.equal(selection.selectExerciseTypePool({
    exercises, candidates: borrowed, exerciseHistory: [], forcedExerciseType: "production"
  }).length, borrowed.length / 2);
  const knownPoints = [...new Set(borrowed.flatMap((exercise) => exercise.grammarPointIds))];
  const exerciseHistory = [{ grammarRatings: knownPoints.map((grammarPointId) => ({ grammarPointId, outcome: "good" })) }];
  for (const id of knownPoints) {
    assert.ok(selection.selectTargetExercisePool({
      candidates: borrowed.filter((exercise) => exercise.type !== "production"),
      exerciseHistory, targetGrammarPointId: id
    }).length > 0);
  }
});

test("borrowed sentences never trigger duplicate lesson voice generation or bypass reading exclusions", async () => {
  const [introduction, exercises] = await Promise.all([
    readJson("data/source/introduction.json"), readJson("data/source/exercises.json")
  ]);
  const lessons = createLessonVoiceItems(introduction, exercises);
  assert.equal(lessons.length, 1 + Object.keys(introduction.levelVariants).length +
    exercises.filter((exercise) => exercise.readingSentenceId === undefined).length);
  assert.ok(lessons.every((item) => item.readingSentenceId === undefined));
  const voices = createReadingVoiceItems(sources);
  assert.equal(voices.length, sources.flatMap(({ sentences }) => sentences).length);
  assert.deepEqual(voices.filter((item) => item.skipVoiceGeneration).map((item) => item.id), [
    "reading-sunday-park-07", "reading-sunday-park-14"
  ]);
  assert.equal(new Set(voices.map((item) => item.id)).size, voices.length);
});
