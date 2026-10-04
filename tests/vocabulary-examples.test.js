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
