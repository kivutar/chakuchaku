import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { TokenizerBuilder } from "lindera-wasm-ipadic-nodejs";
import {
  entryExpansions,
  excludedGrammar,
  mergeVocabulary,
  mergedDuplicateTerms,
  normalizeReading,
  parseArguments,
  parseCsv,
  prepareImport,
  sourceCommit,
  vocabularyId
} from "../scripts/import-n4-vocabulary.js";

async function readText(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("the pinned N4 source parser preserves quoted fields and stable identifiers", () => {
  assert.deepEqual(
    parseCsv('expression,reading,meaning,tags,guid\n"A, B",エー,"say ""A""",,id\n'),
    [
      ["expression", "reading", "meaning", "tags", "guid"],
      ["A, B", "エー", 'say "A"', "", "id"]
    ]
  );
  assert.equal(normalizeReading("コーヒー"), "こーひー");
  assert.equal(vocabularyId("大学生", "だいがくせい"), "vocab-4a1dc826a5bd");
  assert.deepEqual(parseArguments(["--check", "--limit=3"]), {
    check: true,
    limit: 3
  });
  assert.equal(sourceCommit, "1ad66734417aca9dbcca6b2d5ee440cb13ab3ba0");
  assert.deepEqual(
    mergeVocabulary(
      [{ id: "old-n5", introducedAt: "n5" }, { id: "old-n4", introducedAt: "n4" }],
      [{ id: "new-n4", introducedAt: "n4" }, { id: "new-n5", introducedAt: "n5" }]
    ).map(({ id }) => id),
    ["old-n5", "new-n5", "old-n4", "new-n4"]
  );
});

test("the complete pinned N4 source is either imported, merged, or deliberately excluded", async () => {
  const [source, vocabulary] = await Promise.all([
    readText("data/source/open-anki-jlpt-n4.csv"),
    readText("data/jlpt-n5-vocabulary.json").then(JSON.parse)
  ]);
  const tokenizerBuilder = new TokenizerBuilder();

  tokenizerBuilder.setDictionary("embedded://ipadic");
  tokenizerBuilder.setMode("normal");

  const tokenizer = tokenizerBuilder.build();
  const result = prepareImport(parseCsv(source), vocabulary, tokenizer);
  const preImportVocabulary = vocabulary.filter((entry) => {
    return !(
      entry.source === "open-anki-jlpt-decks" &&
      (entry.introducedAt === "n4" || entry.id === "vocab-f3881ce313e7")
    );
  });
  const freshImport = prepareImport(
    parseCsv(source),
    preImportVocabulary,
    tokenizer
  );

  assert.equal(result.sourceRows, 668);
  assert.equal(result.excluded.length, excludedGrammar.size);
  assert.equal(excludedGrammar.size, 14);
  assert.equal(mergedDuplicateTerms.size, 4);
  assert.equal(mergedDuplicateTerms.get("～員"), "vocab-9958661a47af");
  assert.equal(entryExpansions.size, 1);
  assert.equal(result.duplicates.length, 655);
  assert.equal(result.candidates.length, 0);
  assert.equal(freshImport.duplicates.length, 43);
  assert.equal(freshImport.candidates.length, 612);
  assert.ok(freshImport.candidates.some(({ term, reading }) => {
    return term === "月" && reading === "つき";
  }));
  assert.ok(freshImport.candidates.some(({ term, reading }) => {
    return term === "～月" && reading === "～つき";
  }));
  assert.equal(vocabulary.length, 1483);
  assert.equal(vocabulary.filter(({ introducedAt }) => introducedAt === "n4").length, 615);

  const byId = new Map(vocabulary.map((entry) => [entry.id, entry]));
  const importedFields = [
    "id",
    "term",
    "reading",
    "meaning",
    "variants",
    "alternateReadings",
    "scope",
    "introducedAt",
    "source",
    "partOfSpeech",
    "voiceSlug"
  ];

  for (const expected of freshImport.candidates) {
    const actual = byId.get(expected.id);

    assert.ok(actual, `${expected.id} is missing from the vocabulary inventory`);
    assert.deepEqual(
      Object.fromEntries(importedFields.map((field) => [field, actual[field]])),
      Object.fromEntries(importedFields.map((field) => [field, expected[field]])),
      expected.id
    );
  }

  assert.equal(byId.get("vocab-f3881ce313e7").introducedAt, "n5");
  assert.equal(byId.get("vocab-f3881ce313e7").voiceSlug, "hi-day");
  assert.equal(byId.get("vocab-64caa70ef0a7").partOfSpeech, "noun");
  assert.equal(byId.get("vocab-d31e008f6e8e").term, "回る");
  assert.equal(byId.get("vocab-0846bf5cc739").term, "回す");
  assert.equal(byId.has("vocab-bcde89c841b0"), false);
  assert.equal(byId.get("vocab-59631e105136").term, "引き出す");
  assert.equal(byId.get("vocab-c4dcc34f811a").term, "降り出す");
  for (const duplicateId of [
    "vocab-d3fd26035acb",
    "vocab-8cda46ae057c",
    "vocab-e507b462aa49",
    "vocab-5253b14bb791"
  ]) {
    assert.equal(byId.has(duplicateId), false);
  }
});
