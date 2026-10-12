import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { handleStaticRequest } from "../scripts/serve.js";
import { createReadingVoiceItems, parseVoiceGenerationArguments } from "../scripts/generate-voices.js";

const { validatePassages, gradeAnswers, localizedText } = globalThis.JlptN5Reading;
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
  assert.equal(items.length, 20);
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
