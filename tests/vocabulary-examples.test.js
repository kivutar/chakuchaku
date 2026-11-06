import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { repairTargetSurface } from "../scripts/generate-vocabulary-examples.js";

const readJson = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")
  .then(JSON.parse);
const trailingHiraganaPattern = /[\p{Script=Hiragana}ー]+$/u;

test("generated examples repair dictionary-form targets to their visible inflection", () => {
  assert.deepEqual(
    repairTargetSurface(
      {
        vocabularyId: "ganbaru",
        japanese: "私は頑張ります。",
        targetSurface: "頑張る",
        english: "I will do my best.",
        french: "Je ferai de mon mieux."
      },
      { vocabularyId: "ganbaru", term: "頑張る", reading: "がんばる" }
    ),
    {
      vocabularyId: "ganbaru",
      japanese: "私は頑張ります。",
      targetSurface: "頑張り",
      english: "I will do my best.",
      french: "Je ferai de mon mieux."
    }
  );

  assert.equal(
    repairTargetSurface(
      { japanese: "子供が泣きます。", targetSurface: "泣く" },
      { term: "泣く", reading: "なく" }
    ).targetSurface,
    "泣き"
  );
});

test("reviewed N4 vocabulary has evidence, correct readings and familiar context", async () => {
  const [reviews, vocabulary, examples] = await Promise.all([
    Promise.all([
      readJson("data/source/n4-vocabulary-review.json"),
      readJson("data/source/frequency-vocabulary-review.json")
    ]),
    readJson("data/jlpt-n5-vocabulary.json"),
    readJson("data/vocabulary-examples.json")
  ]);
  const vocabularyById = new Map(vocabulary.map((entry) => [entry.id, entry]));
  const examplesById = new Map(examples.map((entry) => [entry.vocabularyId, entry]));
  for (const [index, review] of reviews.entries()) {
    const source = ["curated-n4-kaishi-review", "curated-n4-frequency-review"][index];
    const batchNumbers = new Set(review.batches.map(({ batch }) => batch));
    const imported = review.entries.filter(({ decision }) => decision === "imported");

    assert.deepEqual(
      imported.map(({ vocabularyId }) => vocabularyId).toSorted(),
      vocabulary.filter((entry) => entry.source === source)
        .map(({ id }) => id).toSorted()
    );

    for (const record of imported) {
      const entry = vocabularyById.get(record.vocabularyId);
      const example = examplesById.get(record.vocabularyId);

      assert.equal(entry.introducedAt, "n4");
      assert.equal(entry.scope, "supplemental");
      assert.ok(batchNumbers.has(record.batch), `${entry.term}: unknown review batch`);
      assert.ok(record.reason);
      assert.ok(record.evidence.length > 0);
      for (const evidence of record.evidence) {
        assert.ok(review.sources[evidence.source]?.url && evidence.location, entry.term);
        if (review.sources[evidence.source].url.endsWith(".pdf")) {
          assert.ok(Number.isInteger(evidence.page) && evidence.page > 0, entry.term);
        } else {
          assert.ok(["headword", "taught-expression"].includes(evidence.kind), entry.term);
          assert.equal(review.sources[evidence.source].curriculum,
            "N4 (publisher placement)", entry.term);
        }
      }
      assert.ok(example.tokens.slice(example.targetTokenStart, example.targetTokenEnd)
        .some(({ vocabularyId }) => vocabularyId === entry.id));

      for (const token of example.tokens) {
        if (token.vocabularyId && token.vocabularyId !== entry.id) {
          assert.equal(vocabularyById.get(token.vocabularyId)?.introducedAt, "n5",
            `${entry.term}: example context ${token.surface} must already be available at N5`);
        }
        if (["noun", "verb", "adjective", "adverb", "pronoun", "interjection"]
          .includes(token.category)) {
          assert.ok(token.vocabularyId, `${entry.term}: unknown context word ${token.surface}`);
        }
      }
    }
  }

  // Keep the modern kana spelling in the inflected example.
  const safekeepingExample = examplesById.get("vocab-66874224e11d");

  assert.equal(safekeepingExample.targetReading, "あずけ");
  assert.equal(safekeepingExample.tokens[safekeepingExample.targetTokenStart].reading, "あずけ");
});

test("frequency review keeps unverified levels unassigned and preserves distinct words", async () => {
  const [review, vocabulary] = await Promise.all([
    readJson("data/source/frequency-vocabulary-review.json"),
    readJson("data/jlpt-n5-vocabulary.json")
  ]);
  assert.equal(review.entries.length, 62);
  assert.equal(review.entries.filter(entry => entry.decision === "imported").length, 28);
  assert.deepEqual(review.entries.map(entry => entry.frequencyRank),
    review.entries.map(entry => entry.frequencyRank).toSorted((a, b) => a - b));
  for (const entry of review.entries) {
    assert.ok(entry.usageTags.length > 0 && entry.register && entry.reason, entry.word);
    if (entry.decision !== "imported") {
      assert.equal(entry.introducedAt, undefined, entry.word);
      assert.equal(entry.vocabularyId, undefined, entry.word);
    }
    if (["pending-review", "deferred"].includes(entry.decision)) {
      assert.equal(entry.levelConfidence, "unassigned", entry.word);
      assert.equal(entry.proposedIntroducedAt, undefined, entry.word);
    }
  }
  assert.equal(review.entries[0].word, "俺");
  assert.equal(review.entries[0].learningFocus, "receptive-first");
  const byTerm = new Map(vocabulary.map(entry => [entry.term, entry]));
  assert.equal(byTerm.get("感じ").voiceSlug, "kanji-feeling");
  assert.equal(byTerm.get("漢字").voiceSlug, undefined);
  assert.notEqual(byTerm.get("感じ").id, byTerm.get("感じる").id);
  assert.deepEqual(byTerm.get("すべて").variants, ["全て"]);
  assert.equal(byTerm.get("ただ").meaning, "however; but");
  assert.notEqual(byTerm.get("父親").id, byTerm.get("父").id);
  assert.notEqual(byTerm.get("冗談").id, byTerm.get("嘘").id);
  assert.equal(byTerm.get("実は").reading, "じつは");
  assert.equal(byTerm.get("実は").speechText, "ジツワ");
});

test("every vocabulary and kanji-context item has one short localized example", async () => {
  const [
    vocabulary,
    kanjiContexts,
    sources,
    examples,
    frenchSources,
    frenchExamples
  ] = await Promise.all([
    readJson("data/jlpt-n5-vocabulary.json"),
    readJson("data/kanji-contexts.json"),
    readJson("data/source/vocabulary-examples.json"),
    readJson("data/vocabulary-examples.json"),
    readJson("data/source/locales/fr/vocabulary-examples.json"),
    readJson("data/locales/fr/vocabulary-examples.json")
  ]);
  const vocabularyIds = [...vocabulary, ...kanjiContexts].map(({ id }) => id);
  const sourceIds = sources.map(({ vocabularyId }) => vocabularyId);
  const exampleIds = examples.map(({ vocabularyId }) => vocabularyId);

  assert.deepEqual(sourceIds, vocabularyIds);
  assert.deepEqual(exampleIds, vocabularyIds);
  assert.equal(new Set(exampleIds).size, vocabulary.length + kanjiContexts.length);
  assert.deepEqual(frenchExamples, frenchSources);
  assert.deepEqual(Object.keys(frenchExamples), vocabularyIds);

  for (const example of examples) {
    assert.match(example.text, /[。！？]$/u, example.vocabularyId);
    assert.ok(
      [...example.text.replace(/[\s。、！？!?]/gu, "")].length <= 18,
      example.vocabularyId
    );
    assert.equal(
      example.tokens.map(({ surface }) => surface).join(""),
      example.text,
      example.vocabularyId
    );
    assert.ok(example.text.includes(example.targetSurface), example.vocabularyId);
    assert.ok(Number.isInteger(example.targetTokenStart), example.vocabularyId);
    assert.ok(Number.isInteger(example.targetTokenEnd), example.vocabularyId);
    assert.ok(example.targetTokenStart >= 0, example.vocabularyId);
    assert.ok(example.targetTokenEnd > example.targetTokenStart, example.vocabularyId);
    assert.ok(example.targetTokenEnd <= example.tokens.length, example.vocabularyId);
    assert.ok(example.targetReading, example.vocabularyId);
    assert.ok(example.translation, example.vocabularyId);
    assert.ok(frenchExamples[example.vocabularyId]?.translation, example.vocabularyId);

    for (const token of example.tokens) {
      assert.doesNotMatch(
        token.reading || "",
        /[～〜]/u,
        `${example.vocabularyId}:${token.surface} must not expose an abstract affix marker`
      );

      if (!token.reading || !/\p{Script=Han}/u.test(token.surface)) {
        continue;
      }

      const trailingHiragana = token.surface.match(trailingHiraganaPattern)?.[0];

      if (trailingHiragana) {
        assert.ok(
          token.reading.endsWith(trailingHiragana),
          `${example.vocabularyId}:${token.surface} reading ${token.reading} must match its visible ending`
        );
      }
    }
  }
});
