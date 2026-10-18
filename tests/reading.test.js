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
import "../curriculum.js";
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

test("the N5 Dark Souls interview preserves game titles, Japanese narration, and the distinction between sequels and favourite", async () => {
  const story = prepared.find(({ id }) => id === "learning-to-love-dark-souls");
  assert.equal(story.level, "n5");
  const paragraphs = Map.groupBy(story.sentences, ({ paragraph }) => paragraph);
  assert.equal(paragraphs.size, 10);
  for (let paragraph = 1; paragraph <= 10; paragraph += 2) {
    assert.equal(paragraphs.get(paragraph).length, 1);
    assert.match(paragraphs.get(paragraph)[0].text, /^「.*か。」$/u);
    assert.ok(paragraphs.get(paragraph + 1).every(({ text }) => !text.startsWith("「")));
  }
  const vocabulary = new Map((await readJson("data/jlpt-n5-vocabulary.json"))
    .map((entry) => [entry.id, entry]));
  assert.ok(story.sentences.flatMap(({ vocabularyIds }) => vocabularyIds)
    .every((id) => vocabulary.get(id).introducedAt === "n5"));
  const voices = new Map(createReadingVoiceItems(sources).map((item) => [item.id, item]));
  const sequels = story.sentences.find(({ text }) => text.includes("DARK SOULS III"));
  assert.match(sequels.text, /DARK SOULS IIとDARK SOULS III/u);
  assert.match(voices.get(sequels.id).speechText, /ダークソウルツーとダークソウルスリー/u);
  for (const sentence of story.sentences.filter(({ text }) => text.includes("DARK SOULS"))) {
    assert.equal(sentence.tokens.map(({ surface }) => surface).join(""), sentence.text);
    assert.ok(!voices.get(sentence.id).speechText.includes("DARK"));
  }
  const answers = Object.fromEntries(story.questions.map(({ id, answerId }) => [id, answerId]));
  assert.equal(gradeAnswers(story, answers).correct, 5);
  answers.sequels = "three-favourite";
  assert.equal(gradeAnswers(story, answers).correct, 4, "playing both sequels does not make III the favourite");
  assert.ok(story.questions.find(({ id }) => id === "sequels")
    .evidenceSentenceIds.includes("reading-dark-souls-16"));
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

test("the N5 birthday story has a different plot, grounded questions, and previously unused reading grammar", async () => {
  const cake = prepared.find(({ id }) => id === "a-cake-for-mum");
  assert.ok(cake);
  assert.equal(cake.level, "n5");
  assert.ok(cake.sentences.length >= 18 && cake.sentences.length <= 22);
  assert.equal(cake.questions.length, 5);
  assert.equal(new Set(cake.sentences.map(({ paragraph }) => paragraph)).size, 5);
  const others = prepared.slice(0, prepared.findIndex(({ id }) => id === cake.id))
    .flatMap(({ sentences }) => sentences);
  const existingText = new Set(others.map(({ text }) => text));
  assert.ok(cake.sentences.every(({ text }) => !existingText.has(text)));
  const previousPoints = new Set(others.flatMap(({ grammarPointIds }) => grammarPointIds));
  for (const [number, point, surface] of [
    [6, "yori-comparison", "これより小さい"],
    [7, "shika-nai-limitation", "三つしかありませんでした"],
    [9, "dake-limitation", "少しだけ"],
    [10, "no-nominalizer", "作るのは"],
    [13, "na-adjective-past-negative", "きれいではありませんでした"],
    [14, "mada-te-inai", "まだ帰っていませんでした"],
    [15, "naide-kudasai", "まだ食べないでください"],
    [19, "no-noun-omission", "大きいのを"]
  ]) {
    const sentence = cake.sentences[number - 1];
    assert.ok(sentence.text.includes(surface));
    assert.ok(sentence.grammarPointIds.includes(point));
    assert.ok(!previousPoints.has(point), point);
  }
  const byId = new Map(cake.sentences.map((sentence) => [sentence.id, sentence]));
  for (const question of cake.questions) {
    assert.ok(question.prompt.en && question.prompt.fr);
    assert.ok(question.evidenceSentenceIds.every((id) => byId.has(id)));
  }
  const answer = (id) => cake.questions.find((question) => question.id === id).answerId;
  assert.equal(answer("birthday"), "mother");
  assert.equal(answer("usual-cake"), "home");
  assert.equal(answer("ingredients"), "all-eggs-little-sugar");
  assert.equal(answer("waiting"), "three");
  assert.equal(answer("result"), "tastier");
  const responses = Object.fromEntries(cake.questions.map(({ id, answerId }) => [id, answerId]));
  assert.equal(gradeAnswers(cake, responses).correct, 5);
  responses.result = "pretty";
  assert.equal(gradeAnswers(cake, responses).correct, 4, "good taste does not imply good appearance");
  assert.match(cake.sentences[6].tokens.map((token) => token.reading || token.surface).join(""), /みっつ/u);
  assert.match(cake.sentences[15].tokens.map((token) => token.reading || token.surface).join(""), /さんにん/u);
  const exercises = await readJson("data/exercises.json");
  const pair = exercises.filter(({ readingSentenceId }) => readingSentenceId === cake.sentences[12].id);
  assert.equal(pair.length, 2);
  for (const exercise of pair) {
    const connective = exercise.grammarHighlights.find(({ grammarPointId }) => grammarPointId === "adjective-connective");
    assert.ok(connective);
    assert.equal(exercise.tokens.slice(connective.tokenStart, connective.tokenEnd)
      .map(({ surface }) => surface).join(""), "小さくて", "highlight the connective, not the negative copula");
    assert.ok(!exercise.grammarPointIds.includes("i-adjective-past-negative"), "きれい is a na-adjective");
  }
});

test("the N5 classroom mystery has new sentences, accurate readings, and unambiguous evidence", async () => {
  const index = prepared.findIndex(({ id }) => id === "a-voice-in-the-classroom");
  assert.ok(index >= 0);
  const story = prepared[index];
  assert.equal(story.level, "n5");
  assert.ok(story.sentences.length >= 18 && story.sentences.length <= 22);
  assert.equal(story.questions.length, 5);
  const earlier = prepared.slice(0, index).flatMap(({ sentences }) => sentences);
  const earlierText = new Set(earlier.map(({ text }) => text));
  assert.ok(story.sentences.every(({ text }) => !earlierText.has(text)));
  const earlierPoints = new Set(earlier.flatMap(({ grammarPointIds }) => grammarPointIds));
  for (const [number, point, surface] of [
    [3, "question-word-mo", "誰もいませんでした"],
    [4, "te-iru-result-state", "窓が開いていました"],
    [6, "question-word-ka", "誰かいるんですか"],
    [7, "ya-incomplete-list", "机や椅子"],
    [12, "naide-without", "箱から出ないで"],
    [14, "ni-purpose", "先生を呼びに"],
    [18, "deshou-darou", "来るでしょうか"]
  ]) {
    const sentence = story.sentences[number - 1];
    assert.ok(sentence.text.includes(surface));
    assert.ok(sentence.grammarPointIds.includes(point));
    assert.ok(!earlierPoints.has(point), point);
  }
  const readings = (number) => story.sentences[number - 1].tokens
    .map((token) => token.reading || token.surface).join("");
  assert.match(readings(4), /まどがあいていました/u);
  assert.match(readings(11), /いっぴきいました/u);
  assert.match(readings(17), /どあをあけると/u);
  assert.match(readings(18), /あした/u);
  assert.ok(story.sentences[10].tokens.some((token) =>
    token.surface === "匹" && token.vocabularyId === "vocab-962a64eb7b14"));
  assert.ok(story.sentences[13].tokens.some((token) =>
    token.surface === "たち" && token.vocabularyId === "vocab-7bd027373fce"));
  assert.ok(!story.sentences[3].grammarPointIds.includes("te-iru-progressive"));
  assert.ok(!story.sentences[11].grammarPointIds.includes("naide-kudasai"));
  assert.ok(story.sentences[11].grammarPointIds.includes("te-iru-progressive"));
  assert.ok(story.sentences[16].grammarPointIds.includes("o-route"));
  const answer = (id) => story.questions.find((question) => question.id === id).answerId;
  assert.equal(answer("reason"), "book");
  assert.equal(answer("discovery"), "box");
  assert.equal(answer("owner"), "nearby");
  assert.equal(answer("exit"), "door");
  assert.equal(answer("tomorrow"), "return");
  const responses = Object.fromEntries(story.questions.map(({ id, answerId }) => [id, answerId]));
  assert.equal(gradeAnswers(story, responses).correct, 5);
  responses.exit = "window";
  assert.equal(gradeAnswers(story, responses).correct, 4, "entry and exit are different");
  const byId = new Map(story.sentences.map((sentence) => [sentence.id, sentence]));
  for (const question of story.questions) {
    assert.ok(question.evidenceSentenceIds.every((id) => byId.has(id)));
    assert.ok(question.explanation.en && question.explanation.fr);
  }
  const exercises = await readJson("data/exercises.json");
  for (const [number, point, surface] of [
    [4, "te-iru-result-state", "ていました"],
    [11, "common-counters", "匹"],
    [12, "naide-without", "ないで"],
    [12, "te-iru-progressive", "ていました"],
    [18, "deshou-darou", "でしょう"]
  ]) {
    const pair = exercises.filter(({ readingSentenceId }) =>
      readingSentenceId === story.sentences[number - 1].id);
    assert.equal(pair.length, 2);
    for (const exercise of pair) {
      const highlight = exercise.grammarHighlights.find(({ grammarPointId }) => grammarPointId === point);
      assert.ok(highlight);
      assert.equal(exercise.tokens.slice(highlight.tokenStart, highlight.tokenEnd)
        .map((token) => token.surface).join(""), surface);
    }
  }
});

test("the N5 email story has a different plot, accurate counters, and evidence for each answer", async () => {
  const index = prepared.findIndex(({ id }) => id === "grandpas-first-email");
  assert.ok(index >= 0);
  const story = prepared[index];
  assert.equal(story.level, "n5");
  assert.ok(story.sentences.length >= 18 && story.sentences.length <= 22);
  assert.equal(story.questions.length, 5);
  assert.equal(new Set(story.sentences.map(({ paragraph }) => paragraph)).size, 5);
  const earlier = prepared.slice(0, index).flatMap(({ sentences }) => sentences);
  const existingText = new Set(earlier.map(({ text }) => text));
  assert.ok(story.sentences.every(({ text }) => !existingText.has(text)));
  const earlierPoints = new Set(earlier.flatMap(({ grammarPointIds }) => grammarPointIds));
  for (const [number, point, surface] of [
    [3, "koto-ga-dekiru", "会うことができません"],
    [5, "ato-de", "昼御飯の後で"],
    [5, "te-miru", "やってみませんか"],
    [5, "masen-ka-invitation", "やってみませんか"],
    [6, "kata-how-to", "使い方"],
    [8, "suru-change", "大きくしてください"],
    [10, "mashou-ka", "書きましょうか"],
    [11, "hou-ga-ii-advice", "書いたほうがいい"],
    [11, "to-omou", "と思います"],
    [12, "nagara", "聞きながら"],
    [14, "te-shimau", "消してしまいました"],
    [20, "ga-identification", "私が料理を教えます"]
  ]) {
    const sentence = story.sentences[number - 1];
    assert.ok(sentence.text.includes(surface));
    assert.ok(sentence.grammarPointIds.includes(point));
    assert.ok(!earlierPoints.has(point), point);
  }
  const reading = (number) => story.sentences[number - 1].tokens
    .map(({ reading, surface }) => reading || surface).join("");
  assert.match(reading(6), /つかいかた/u);
  assert.match(reading(10), /なにをかきましょうか/u);
  assert.match(reading(16), /ひとりで/u);
  assert.match(reading(17), /ふたりで/u);
  assert.match(reading(19), /ひとりでも/u);
  assert.match(reading(20), /あした/u);
  const answer = (id) => story.questions.find((question) => question.id === id).answerId;
  assert.equal(answer("recipient"), "brother");
  assert.equal(answer("bigger"), "small");
  assert.equal(answer("message"), "flowers");
  assert.equal(answer("mistake"), "again");
  assert.equal(answer("tomorrow"), "cook");
  const responses = Object.fromEntries(story.questions.map(({ id, answerId }) => [id, answerId]));
  assert.equal(gradeAnswers(story, responses).correct, 5);
  responses.mistake = "narrator";
  assert.equal(gradeAnswers(story, responses).correct, 4, "the grandfather rewrites the email himself");
  const byId = new Set(story.sentences.map(({ id }) => id));
  for (const question of story.questions) {
    assert.ok(question.evidenceSentenceIds.every((id) => byId.has(id)));
    assert.ok(question.explanation.en && question.explanation.fr);
  }
  const exercises = await readJson("data/exercises.json");
  for (const [number, point, surface] of [
    [3, "koto-ga-dekiru", "ことができません"],
    [5, "te-miru", "てみません"],
    [5, "masen-ka-invitation", "ませんか"],
    [6, "kata-how-to", "使い方"],
    [8, "suru-change", "大きくし"],
    [9, "suru-change", "大きくする"],
    [9, "to-conditional", "と"],
    [10, "mashou-ka", "ましょうか"],
    [11, "hou-ga-ii-advice", "たほうがいい"],
    [11, "to-omou", "と思います"],
    [12, "nagara", "ながら"],
    [14, "te-shimau", "てしまいました"],
    [19, "koto-ga-dekiru", "ことができます"],
    [20, "ga-identification", "が"]
  ]) {
    const pair = exercises.filter(({ readingSentenceId }) => readingSentenceId === story.sentences[number - 1].id);
    assert.equal(pair.length, 2);
    for (const exercise of pair) {
      const highlight = exercise.grammarHighlights.find(({ grammarPointId }) => grammarPointId === point);
      assert.ok(highlight, `${exercise.id}: ${point}`);
      assert.equal(exercise.tokens.slice(highlight.tokenStart, highlight.tokenEnd)
        .map(({ surface }) => surface).join(""), surface);
    }
  }
  const invitation = story.sentences[4];
  const voice = createReadingVoiceItems(sources).find(({ id }) => id === invitation.id);
  assert.equal(voice.speechText,
    "わたしは、ひるごはんのあとで、いっしょにやってみませんか、といいました。");
  const compact = (value) => value.replace(/[\p{P}\s]/gu, "");
  assert.equal(compact(voice.speechText), compact(invitation.tokens
    .map(({ reading, surface }) => reading || surface).join("")),
  "the spoken invitation must include the narrator and quotation verb, not only the quoted words");
});

test("the N5 train story distinguishes plans from events, has correct readings, and broadens grammar coverage", async () => {
  const index = prepared.findIndex(({ id }) => id === "the-wrong-train");
  assert.ok(index >= 0);
  const story = prepared[index];
  assert.equal(story.level, "n5");
  assert.ok(story.sentences.length >= 18 && story.sentences.length <= 22);
  assert.equal(story.questions.length, 5);
  assert.equal(new Set(story.sentences.map(({ paragraph }) => paragraph)).size, 5);
  const earlier = prepared.slice(0, index).flatMap(({ sentences }) => sentences);
  const existingText = new Set(earlier.map(({ text }) => text));
  assert.ok(story.sentences.every(({ text }) => !existingText.has(text)));
  const earlierPoints = new Set(earlier.flatMap(({ grammarPointIds }) => grammarPointIds));
  for (const [number, point, surface] of [
    [2, "goro-approximate-time", "十二時ごろ"],
    [2, "tsumori", "着くつもりでした"],
    [4, "ka-alternatives", "右ですか、左ですか"],
    [9, "verb-masen-deshita", "見えませんでした"],
    [13, "mada", "まだ海の近くにいます"],
    [16, "kara-reason", "きれいだったから"],
    [16, "ageru", "友達にも一枚あげたい"],
    [17, "ka-dou-ka", "山へ行くかどうか"],
    [19, "naa-reflection", "行きたいなあ"]
  ]) {
    const sentence = story.sentences[number - 1];
    assert.ok(sentence.text.includes(surface));
    assert.ok(sentence.grammarPointIds.includes(point));
    assert.ok(!earlierPoints.has(point), point);
  }
  const reading = (number) => story.sentences[number - 1].tokens
    .map(({ reading, surface }) => reading || surface).join("");
  assert.match(reading(2), /^じゅうにじごろ/u);
  assert.match(reading(3), /にほん/u);
  assert.equal(story.sentences[2].text, "駅には電車が二本止まっていました。");
  assert.equal(story.sentences[6].text, "この電車は山へ行くだろうと思いました。");
  assert.ok(story.sentences[6].grammarPointIds.includes("darou"));
  assert.ok(!story.sentences[6].grammarPointIds.includes("deshou-darou"));
  assert.match(reading(8), /でんしゃのなかで、まどのそと/u);
  assert.match(reading(14), /ひるごはん/u);
  assert.match(reading(16), /いちまい/u);
  assert.match(reading(18), /^ごごいちじごろ/u);
  const answer = (id) => story.questions.find((question) => question.id === id).answerId;
  assert.equal(answer("plan"), "noon");
  assert.equal(answer("mistake"), "listening");
  assert.equal(answer("lunch"), "not-yet");
  assert.equal(answer("gift"), "sea-picture");
  assert.equal(answer("check"), "destination");
  const responses = Object.fromEntries(story.questions.map(({ id, answerId }) => [id, answerId]));
  assert.equal(gradeAnswers(story, responses).correct, 5);
  responses.plan = "one";
  responses.mistake = "advice";
  assert.equal(gradeAnswers(story, responses).correct, 3, "actual arrival differs from the plan, and the advice was correct");
  const byId = new Set(story.sentences.map(({ id }) => id));
  for (const question of story.questions) {
    assert.ok(question.evidenceSentenceIds.every((id) => byId.has(id)));
    assert.ok(question.explanation.en && question.explanation.fr);
  }
  const exercises = await readJson("data/exercises.json");
  for (const [number, point, surface] of [
    [3, "common-counters", "本"],
    [3, "te-iru-result-state", "ていました"],
    [6, "naide-without", "ないで"],
    [7, "darou", "だろう"],
    [8, "te-iru-progressive", "ていました"],
    [9, "verb-masen-deshita", "ませんでした"],
    [13, "mada", "まだ"],
    [13, "naru-ku-change", "遅くなります"],
    [16, "kara-reason", "から"],
    [17, "ka-dou-ka", "かどうか"],
    [19, "naa-reflection", "なあ"]
  ]) {
    const pair = exercises.filter(({ readingSentenceId }) => readingSentenceId === story.sentences[number - 1].id);
    assert.equal(pair.length, 2);
    for (const exercise of pair) {
      const highlight = exercise.grammarHighlights.find(({ grammarPointId }) => grammarPointId === point);
      assert.ok(highlight, `${exercise.id}: ${point}`);
      assert.equal(exercise.tokens.slice(highlight.tokenStart, highlight.tokenEnd)
        .map(({ surface }) => surface).join(""), surface);
    }
  }
});

test("the hungry-student story has a grounded joke, beginner vocabulary, and distinct grammar usages", async () => {
  const index = prepared.findIndex(({ id }) => id === "a-hungry-student");
  assert.ok(index >= 0);
  const story = prepared[index];
  assert.equal(story.level, "n5");
  assert.ok(story.sentences.length >= 18 && story.sentences.length <= 22);
  assert.equal(story.questions.length, 5);
  assert.equal(new Set(story.sentences.map(({ paragraph }) => paragraph)).size, 5);
  const earlier = prepared.slice(0, index).flatMap(({ sentences }) => sentences);
  const earlierText = new Set(earlier.map(({ text }) => text));
  assert.ok(story.sentences.every(({ text }) => !earlierText.has(text)));
  const earlierPoints = new Set(earlier.flatMap(({ grammarPointIds }) => grammarPointIds));
  for (const [number, point, surface] of [
    [1, "no-ga-suki", "勉強するのが好き"],
    [6, "dou-yatte", "どうやって"],
    [8, "location-of-topic", "箱の中にあります"],
    [10, "sou-appearance", "楽しそうでした"],
    [11, "tara-conditional", "言ったら"],
    [13, "onaji", "同じ言葉"],
    [13, "wa-contrast", "次は"],
    [16, "hou-ga-comparison", "食べ物のほうが"],
    [16, "yone-confirmation", "だよね"],
    [17, "kamoshirenai", "かもしれません"],
    [20, "mou", "もう一つ"],
    [20, "quantity-position", "お菓子をもう一つ"]
  ]) {
    const sentence = story.sentences[number - 1];
    assert.ok(sentence.text.includes(surface));
    assert.ok(sentence.grammarPointIds.includes(point));
    assert.ok(!earlierPoints.has(point), point);
  }
  const reading = (number) => story.sentences[number - 1].tokens
    .map(({ reading, surface }) => reading || surface).join("");
  assert.match(reading(3), /すぐにすわります/u);
  assert.match(reading(8), /だいどころのはこのなか/u);
  assert.match(reading(10), /たのしそうでした/u);
  assert.match(reading(15), /すぐにだいどころ/u);
  assert.match(reading(20), /おかしをもうひとつ/u);
  assert.ok(story.sentences.every((sentence) => !sentence.tokens
    .map(({ reading, surface }) => reading || surface).join("").includes("すぐにに")));
  const vocabulary = new Map((await readJson("data/jlpt-n5-vocabulary.json"))
    .map((entry) => [entry.id, entry]));
  for (const sentence of story.sentences) {
    assert.ok(sentence.vocabularyIds.every((id) => vocabulary.get(id).introducedAt === "n5"), sentence.id);
  }
  const answer = (id) => story.questions.find((question) => question.id === id).answerId;
  assert.equal(answer("study-habit"), "snacks");
  assert.equal(answer("known-command"), "sit");
  assert.equal(answer("teaching-order"), "show");
  assert.equal(answer("second-attempt"), "kitchen");
  assert.equal(answer("mothers-joke"), "snacks");
  const responses = Object.fromEntries(story.questions.map(({ id, answerId }) => [id, answerId]));
  assert.equal(gradeAnswers(story, responses).correct, 5);
  responses["known-command"] = "wait";
  responses["teaching-order"] = "feed";
  responses["mothers-joke"] = "same-food";
  assert.equal(gradeAnswers(story, responses).correct, 2);
  const exercises = await readJson("data/exercises.json");
  for (const [number, point, surface] of [
    [1, "no-ga-suki", "のが好き"],
    [6, "dou-yatte", "どうやって"],
    [8, "location-of-topic", "にあります"],
    [10, "sou-appearance", "そうでした"],
    [11, "tara-conditional", "たら"],
    [13, "onaji", "同じ"],
    [16, "hou-ga-comparison", "のほうが"],
    [16, "yone-confirmation", "よね"],
    [17, "kamoshirenai", "かもしれません"],
    [19, "onaji", "同じ"],
    [20, "mou", "もう"]
  ]) {
    const pair = exercises.filter(({ readingSentenceId }) => readingSentenceId === story.sentences[number - 1].id);
    assert.equal(pair.length, 2);
    for (const exercise of pair) {
      const highlight = exercise.grammarHighlights.find(({ grammarPointId }) => grammarPointId === point);
      assert.ok(highlight, `${exercise.id}: ${point}`);
      assert.equal(exercise.tokens.slice(highlight.tokenStart, highlight.tokenEnd)
        .map(({ surface }) => surface).join(""), surface);
    }
  }
});

test("the N4 red-box story mixes levels, preserves the gift's history, and has accurate readings", async () => {
  const story = prepared.find(({ id }) => id === "the-red-box");
  assert.ok(story);
  assert.equal(story.level, "n4");
  assert.ok(story.sentences.length >= 18 && story.sentences.length <= 22);
  assert.equal(story.questions.length, 5);
  assert.equal(new Set(story.sentences.map(({ paragraph }) => paragraph)).size, 5);
  const otherTexts = new Set(prepared.filter(({ id }) => id !== story.id)
    .flatMap(({ sentences }) => sentences.map(({ text }) => text)));
  assert.ok(story.sentences.every(({ text }) => !otherTexts.has(text)));
  const vocabulary = new Map((await readJson("data/jlpt-n5-vocabulary.json"))
    .map((entry) => [entry.id, entry]));
  const vocabularyLevels = new Set(story.sentences.flatMap(({ vocabularyIds }) =>
    vocabularyIds.map((id) => vocabulary.get(id).introducedAt)));
  assert.deepEqual([...vocabularyLevels].sort(), ["n4", "n5"]);
  const grammar = new Map((await readJson("data/jlpt-n5-grammar.json"))
    .map((point) => [point.id, point]));
  const grammarLevels = new Set(story.sentences.flatMap(({ grammarPointIds }) =>
    grammarPointIds.map((id) => grammar.get(id).introducedAt)));
  assert.deepEqual([...grammarLevels].sort(), ["n4", "n5"]);
  assert.ok(story.sentences.some(({ grammarPointIds }) =>
    grammarPointIds.every((id) => grammar.get(id).introducedAt === "n5")),
  "N4 stories may contain sentences using only N5 grammar");
  const reading = (number) => story.sentences[number - 1].tokens
    .map(({ reading, surface }) => reading || surface).join("");
  assert.match(reading(1), /ひっこしたばかり/u);
  assert.match(reading(3), /そうじしているあいだ/u);
  assert.match(reading(9), /^いちまいのかみ.*こどもがかいた/u);
  assert.match(reading(12), /それをかいたのは/u);
  assert.match(reading(13), /ごさい.*たんじょうび/u);
  assert.match(reading(18), /じょうずにかいてね.*たのまれました/u);
  assert.match(reading(20), /うれしそうに/u);
  const authoredStory = sources.find(({ id }) => id === story.id);
  for (const number of [9, 12, 18]) {
    assert.ok(authoredStory.sentences[number - 1].speechText.includes(number === 18 ? "かいて" : "かいた"));
  }
  const answers = Object.fromEntries(story.questions.map(({ id, answerId }) => [id, answerId]));
  assert.deepEqual(answers, {
    deadline: "three", "light-box": "papers", artist: "narrator-five",
    "precious-drawing": "gift", outcome: "kept"
  });
  assert.equal(gradeAnswers(story, answers).correct, 5);
  answers.artist = "sister-five";
  answers.outcome = "finished";
  assert.equal(gradeAnswers(story, answers).correct, 3);
  assert.match(story.sentences[12].text, /私が五歳.*姉の誕生日/u);
  assert.match(story.sentences[19].text, /三時には終わりませんでした/u);
});

test("both directions of the N4 story share narration and enter the N4 grammar pool without excluding N5 practice", async () => {
  const story = prepared.find(({ id }) => id === "the-red-box");
  const exercises = await readJson("data/exercises.json");
  const curriculum = globalThis.JlptN5Curriculum.createCurriculum(await readJson("data/curriculum.json"));
  const n5 = curriculum.filterAvailable(exercises, { through: "n5", levelField: "minimumLevel" });
  const n4 = curriculum.filterAvailable(exercises, { through: "n4", levelField: "minimumLevel" });
  const n4Ids = new Set(n4.map(({ id }) => id));
  assert.ok(n5.every(({ id }) => n4Ids.has(id)), "N4 keeps existing N5 grammar exercises");
  const voiceItems = new Map(createReadingVoiceItems(sources).map((item) => [item.id, item]));
  for (const sentence of story.sentences) {
    const pair = exercises.filter(({ readingSentenceId }) => readingSentenceId === sentence.id);
    assert.equal(pair.length, 2);
    assert.ok(pair.every(({ minimumLevel, audio }) => minimumLevel === "n4" && audio === sentence.audio));
    assert.ok(pair.every(({ id }) => n4Ids.has(id)));
    assert.ok(pair.every(({ id }) => !n5.some((exercise) => exercise.id === id)));
    assert.equal(voiceItems.get(sentence.id).introducedAt, "n4");
  }
  for (const [number, point, surface] of [
    [1, "ta-bakari", "たばかり"], [2, "made-ni", "までに"],
    [3, "aida", "間"], [5, "noni-concession", "のに"],
    [7, "you-to-suru", "捨てようとした"],
    [8, "you-ni-to-iu", "ように言われた"], [8, "koto-ni-suru", "ことにしました"],
    [9, "you-da-inference", "のようでした"], [12, "no-wa-da", "のは"],
    [15, "koto-ni-shiteiru", "ことにしている"], [16, "nakute-connective", "なくて"],
    [17, "te-yokatta", "てよかった"], [19, "te-oku", "ておきました"],
    [20, "sou-modifier", "そうに"]
  ]) {
    const pair = exercises.filter(({ readingSentenceId }) => readingSentenceId === story.sentences[number - 1].id);
    for (const exercise of pair) {
      const highlight = exercise.grammarHighlights.find(({ grammarPointId }) => grammarPointId === point);
      assert.ok(highlight, `${exercise.id}: ${point}`);
      assert.equal(exercise.tokens.slice(highlight.tokenStart, highlight.tokenEnd)
        .map(({ surface }) => surface).join(""), surface);
    }
  }
});

test("kana adverb variants keep their own reading rather than an extra dictionary particle", async () => {
  const exercises = await readJson("data/exercises.json");
  const tokens = [...exercises.flatMap(({ tokens }) => tokens),
    ...prepared.flatMap(({ sentences }) => sentences.flatMap(({ tokens }) => tokens))];
  const immediately = tokens.filter(({ surface, vocabularyId }) => surface === "すぐ" &&
    vocabularyId === "vocab-86f4d5b7a565");
  assert.ok(immediately.length > 0);
  assert.ok(immediately.every(({ reading }) => reading === "すぐ"));
});

test("story search is localized and accent-insensitive, level-aware, and paginated without changing content", () => {
  const original = JSON.stringify(prepared);
  assert.deepEqual(filterPassages(prepared, { query: "BIBLIOTHEQUE chats", locale: "fr" }).map(({ id }) => id), ["my-first-library-card"]);
  assert.equal(filterPassages(prepared, { query: "library", locale: "en" }).length, 1);
  assert.equal(filterPassages(prepared, { query: "not in any story" }).length, 0);
  assert.ok(filterPassages(prepared, { level: "n4" }).some(({ id }) => id === "the-red-box"));
  assert.ok(filterPassages(prepared, { level: "n4" }).every(({ level }) => level === "n4"));
  assert.ok(filterPassages(prepared, { level: "n5" }).every(({ level }) => level === "n5"));
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
        assert.ok(["n5", "n4"].indexOf(entry.introducedAt) >= 0, entry.id);
        assert.ok(["n5", "n4"].indexOf(entry.introducedAt) <= ["n5", "n4"].indexOf(reading.level),
          `${sentence.id}: ${entry.term} exceeds ${reading.level}`);
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

test("all story grammar cards have localized dictionary hints for the exact vocabulary in their Japanese answers", async () => {
  const [exercises, french] = await Promise.all([
    readJson("data/exercises.json"), readJson("data/locales/fr/exercises.json")
  ]);
  const productions = exercises.filter((exercise) => exercise.type === "production" &&
    exercise.readingSentenceId);
  assert.equal(productions.length, prepared.flatMap(({ sentences }) => sentences).length);
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
      assert.ok(["n5", "n4"].indexOf(grammarById.get(id)?.introducedAt) >= 0, id);
      assert.ok(["n5", "n4"].indexOf(grammarById.get(id).introducedAt) <=
        ["n5", "n4"].indexOf(exercise.minimumLevel), exercise.id);
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
  const excluded = voices.filter((item) => item.skipVoiceGeneration).map((item) => item.id);
  assert.deepEqual(excluded, sources.flatMap(({ sentences }) => sentences)
    .filter((sentence) => sentence.skipVoiceGeneration).map(({ id }) => id));
  for (const id of ["reading-sunday-park-07", "reading-sunday-park-14", "reading-birthday-cake-04",
    "reading-classroom-visitor-04", "reading-grandpa-email-14"]) {
    assert.ok(excluded.includes(id), "repeatedly rejected audio stays excluded");
  }
  assert.equal(new Set(voices.map((item) => item.id)).size, voices.length);
});
