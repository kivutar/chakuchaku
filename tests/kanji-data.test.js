import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");

test("kanji inventory exactly follows the Rikkyo 209-character curriculum", async () => {
  const [kanji, curriculum] = await Promise.all([
    readFile(join(rootDirectory, "data", "jlpt-n5-kanji.json"), "utf8").then(JSON.parse),
    readFile(
      join(rootDirectory, "data", "source", "rikkyo-n5-kanji.json"),
      "utf8"
    ).then(JSON.parse)
  ]);
  const ids = new Set();
  const characters = new Set();
  const expected = curriculum.flatMap(({ stage, characters: stageCharacters }) => {
    return [...stageCharacters].map((character) => ({ character, stage }));
  });

  assert.equal(kanji.length, 209);
  assert.equal(kanji.filter(({ stage }) => stage === "B6").length, 73);
  assert.equal(kanji.filter(({ stage }) => stage === "B5").length, 68);
  assert.equal(kanji.filter(({ stage }) => stage === "B4").length, 68);
  assert.deepEqual(
    kanji.map(({ character, stage }) => ({ character, stage })),
    expected
  );

  for (const entry of kanji) {
    const codePoint = entry.character.codePointAt(0).toString(16).padStart(4, "0");
    const readings = [...entry.onReadings, ...entry.kunReadings];

    assert.match(entry.character, /^\p{Script=Han}$/u);
    assert.equal(entry.id, `kanji-${codePoint}`);
    assert.ok(entry.meaning.length > 0);
    assert.ok(["B6", "B5", "B4"].includes(entry.stage));
    assert.ok(Array.isArray(entry.onReadings));
    assert.ok(Array.isArray(entry.kunReadings));
    assert.ok(readings.length > 0, `${entry.character} needs at least one N5 reading`);
    assert.equal(
      new Set(entry.onReadings).size,
      entry.onReadings.length,
      `${entry.character} repeats an on-reading`
    );
    assert.equal(
      new Set(entry.kunReadings).size,
      entry.kunReadings.length,
      `${entry.character} repeats a kun-reading`
    );
    assert.ok(readings.every((reading) => /^[ぁ-ゖ]+$/.test(reading)));
    assert.ok(!ids.has(entry.id), `Duplicate kanji id ${entry.id}`);
    assert.ok(!characters.has(entry.character), `Duplicate kanji ${entry.character}`);
    ids.add(entry.id);
    characters.add(entry.character);
  }

  assert.equal(kanji.find(({ character }) => character === "私").stage, "B6");
  assert.ok(kanji.find(({ character }) => character === "何").kunReadings.includes("なに"));
  assert.ok(kanji.find(({ character }) => character === "田").kunReadings.includes("た"));
  assert.deepEqual(kanji.find(({ character }) => character === "火").kunReadings, []);
  assert.ok(kanji.find(({ character }) => character === "明").onReadings.includes("めい"));
  assert.deepEqual(kanji.find(({ character }) => character === "事").kunReadings, ["こと"]);
  assert.ok(kanji.find(({ character }) => character === "要").onReadings.includes("よう"));
  assert.ok(!kanji.find(({ character }) => character === "作").onReadings.includes("さ"));
  assert.ok(!kanji.find(({ character }) => character === "誰").kunReadings.includes("た"));
  assert.ok(!kanji.find(({ character }) => character === "男").kunReadings.includes("お"));
  assert.ok(!kanji.find(({ character }) => character === "十").kunReadings.includes("と"));

  for (const character of ["兄", "姉", "弟", "妹"]) {
    assert.equal(kanji.find((entry) => entry.character === character).stage, "B5");
  }
});

test("kanji-only contexts have complete French display meanings", async () => {
  const [contexts, french] = await Promise.all([
    readFile(join(rootDirectory, "data", "kanji-contexts.json"), "utf8").then(JSON.parse),
    readFile(
      join(rootDirectory, "data", "locales", "fr", "kanji-contexts.json"),
      "utf8"
    ).then(JSON.parse)
  ]);
  const ids = contexts.map(({ id }) => id);

  assert.equal(contexts.length, 16);
  assert.equal(new Set(ids).size, contexts.length);
  assert.deepEqual(Object.keys(french), ids);

  for (const context of contexts) {
    assert.equal(context.scope, "kanji-context");
    assert.match(context.term, /\p{Script=Han}/u);
    assert.match(context.reading, /^[ぁ-ゖ]+$/u);
    assert.ok(context.meaning.length > 0);
    assert.ok(french[context.id].meaning.length > 0);
  }
});

test("kanji mnemonics cover the full curriculum in English and French", async () => {
  const [kanji, mnemonics, french, englishComponents, frenchComponents] = await Promise.all([
    readFile(join(rootDirectory, "data", "jlpt-n5-kanji.json"), "utf8").then(JSON.parse),
    readFile(join(rootDirectory, "data", "kanji-mnemonics.json"), "utf8").then(JSON.parse),
    readFile(
      join(rootDirectory, "data", "locales", "fr", "kanji.json"),
      "utf8"
    ).then(JSON.parse),
    readFile(
      join(rootDirectory, "data", "source", "kanji-components.json"),
      "utf8"
    ).then(JSON.parse),
    readFile(
      join(rootDirectory, "data", "source", "locales", "fr", "kanji-components.json"),
      "utf8"
    ).then(JSON.parse)
  ]);
  const kanjiById = new Map(kanji.map((entry) => [entry.id, entry]));
  const frenchMnemonics = await readFile(
    join(rootDirectory, "data", "locales", "fr", "kanji-mnemonics.json"),
    "utf8"
  ).then(JSON.parse);

  const mnemonicById = new Map(mnemonics.map((entry) => [entry.kanjiId, entry]));
  const englishMeaningBySymbol = new Map();
  const frenchMeaningBySymbol = new Map();

  assert.equal(mnemonics.length, kanji.length);
  assert.deepEqual(
    new Set(mnemonics.map(({ kanjiId }) => kanjiId)),
    new Set(kanji.map(({ id }) => id))
  );
  assert.deepEqual(
    new Set(Object.keys(frenchMnemonics)),
    new Set(kanji.map(({ id }) => id))
  );

  for (const mnemonic of mnemonics) {
    assert.ok(Array.isArray(mnemonic.components));
    assert.ok(mnemonic.components.length >= 1);
    assert.ok(mnemonic.components.every(({ symbol, meaning }) => symbol && meaning));
    assert.ok(mnemonic.meaningStory.length > 0);
    assert.ok(mnemonic.readings.every(({ reading, story }) => (
      /^[ぁ-ゖ]+$/u.test(reading) && story.includes(reading)
    )));
    assert.ok(mnemonic.readings.every(({ anchorId }) => anchorId.length > 0));

    for (const { symbol, meaning } of mnemonic.components) {
      assert.equal(meaning, englishComponents[symbol]);
      assert.equal(englishMeaningBySymbol.get(symbol) || meaning, meaning);
      englishMeaningBySymbol.set(symbol, meaning);
    }
  }

  for (const [kanjiId, localized] of Object.entries(frenchMnemonics)) {
    const mnemonic = mnemonicById.get(kanjiId);

    assert.ok(mnemonic);
    assert.deepEqual(
      localized.components.map(({ symbol }) => symbol),
      mnemonic.components.map(({ symbol }) => symbol)
    );
    assert.deepEqual(
      localized.readings.map(({ reading }) => reading),
      mnemonic.readings.map(({ reading }) => reading)
    );
    assert.deepEqual(
      localized.readings.map(({ anchorId, anchorReading }) => ({ anchorId, anchorReading })),
      mnemonic.readings.map(({ anchorId, anchorReading }) => ({ anchorId, anchorReading }))
    );
    for (const { symbol, meaning } of localized.components) {
      assert.equal(meaning, frenchComponents[symbol]);
      assert.equal(frenchMeaningBySymbol.get(symbol) || meaning, meaning);
      frenchMeaningBySymbol.set(symbol, meaning);
    }
    assert.ok(french[kanjiId].meaning.length > 0);
  }

  const fire = mnemonicById.get("kanji-706b");
  const matter = mnemonicById.get("kanji-4e8b");
  const quality = mnemonicById.get("kanji-8cea");

  assert.deepEqual(fire.readings.map(({ reading }) => reading), ["か"]);
  assert.deepEqual(matter.readings.map(({ reading }) => reading), ["こと"]);
  assert.equal(matter.readings[0].anchorReading, "ごと");
  assert.deepEqual(quality.components.map(({ symbol }) => symbol), ["斤", "斤", "貝"]);
});
