import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { surfaceCarriesReading } from "../scripts/kanji-reading-evidence.js";

const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");

test("every active study level declares its kanji data and mnemonic sources", async () => {
  const [curriculum, sources] = await Promise.all([
    readFile(join(rootDirectory, "data", "curriculum.json"), "utf8").then(JSON.parse),
    readFile(
      join(rootDirectory, "data", "source", "kanji-curricula.json"),
      "utf8"
    ).then(JSON.parse)
  ]);

  assert.deepEqual(
    sources.map(({ level }) => level),
    curriculum.levels.filter(({ id }) => id !== "foundation").map(({ id }) => id)
  );
  assert.equal(new Set(sources.map(({ curriculumSource }) => curriculumSource)).size, sources.length);
  assert.equal(new Set(sources.map(({ mnemonicSource }) => mnemonicSource)).size, sources.length);
});

test("kanji inventory combines the Rikkyo foundation with the pinned N4 delta", async () => {
  const [kanji, curriculum, n4Curriculum, frenchKanji] = await Promise.all([
    readFile(join(rootDirectory, "data", "jlpt-n5-kanji.json"), "utf8").then(JSON.parse),
    readFile(
      join(rootDirectory, "data", "source", "rikkyo-n5-kanji.json"),
      "utf8"
    ).then(JSON.parse),
    readFile(
      join(rootDirectory, "data", "source", "jlpt-n4-kanji.json"),
      "utf8"
    ).then(JSON.parse),
    readFile(
      join(rootDirectory, "data", "source", "locales", "fr", "kanji.json"),
      "utf8"
    ).then(JSON.parse)
  ]);
  const ids = new Set();
  const characters = new Set();
  const n5Characters = new Set(curriculum.flatMap(({ characters }) => [...characters]));
  const n4ReferenceCharacters = [...n4Curriculum.characters];
  const n4DeltaCharacters = n4ReferenceCharacters
    .filter((character) => !n5Characters.has(character));
  const expected = [
    ...curriculum.flatMap(({ stage, characters: stageCharacters }) => {
      return [...stageCharacters].map((character) => ({ character, stage }));
    }),
    ...n4DeltaCharacters
      .map((character) => ({ character, stage: n4Curriculum.stage }))
  ];

  assert.equal(n4ReferenceCharacters.length, 170);
  assert.equal(new Set(n4ReferenceCharacters).size, 170);
  assert.equal(n4ReferenceCharacters.filter((character) => n5Characters.has(character)).length, 91);
  assert.equal(n4DeltaCharacters.length, 79);
  assert.deepEqual(new Set(Object.keys(n4Curriculum.meaningOverrides)), new Set(n4DeltaCharacters));
  assert.equal(kanji.length, 289);
  assert.equal(kanji.filter(({ stage }) => stage === "B6").length, 73);
  assert.equal(kanji.filter(({ stage }) => stage === "B5").length, 68);
  assert.equal(kanji.filter(({ stage }) => stage === "B4").length, 68);
  assert.equal(kanji.filter(({ stage }) => stage === "N4").length, 79);
  assert.deepEqual(kanji.filter(({ stage }) => stage === "Supplemental")
    .map(({ character }) => character), ["鳴"]);
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
    assert.ok(["B6", "B5", "B4", "Supplemental", "N4"].includes(entry.stage));
    assert.equal(entry.introducedAt, entry.stage === "N4" ? "n4" : "n5");
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
  assert.ok(!kanji.find(({ character }) => character === "道").onReadings.includes("とう"));
  assert.ok(!kanji.find(({ character }) => character === "験").onReadings.includes("げん"));
  assert.deepEqual(kanji.find(({ character }) => character === "写").onReadings, ["しゃ"]);
  assert.equal(kanji.find(({ character }) => character === "月").meaning, "moon; month");
  assert.equal(frenchKanji["kanji-6708"].meaning, "lune ; mois");
  assert.deepEqual(kanji.find(({ character }) => character === "代").kunReadings, ["か"]);
  assert.deepEqual(kanji.find(({ character }) => character === "終").kunReadings, ["お", "おわ"]);
  assert.deepEqual(kanji.find(({ character }) => character === "起").kunReadings, ["お"]);

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

  assert.equal(contexts.length, 21);
  assert.equal(new Set(ids).size, contexts.length);
  assert.deepEqual(Object.keys(french), ids);

  for (const context of contexts) {
    assert.equal(context.scope, "kanji-context");
    assert.match(context.term, /\p{Script=Han}/u);
    assert.match(context.reading, /^[ぁ-ゖ]+$/u);
    assert.ok(context.meaning.length > 0);
    assert.ok(french[context.id].meaning.length > 0);
  }
  assert.deepEqual(
    contexts.filter(({ introducedAt }) => introducedAt === "n4").map(({ id }) => id),
    [
      "kanji-context-shujin",
      "kanji-context-mokuteki",
      "kanji-context-kyouto",
      "kanji-context-shusshin",
      "kanji-context-kanou"
    ]
  );
});

test("kanji reading evidence respects visible okurigana boundaries", () => {
  assert.equal(surfaceCarriesReading("代わり", "かわり", "代", "か"), true);
  assert.equal(surfaceCarriesReading("代わり", "かわり", "代", "かわ"), false);
  assert.equal(surfaceCarriesReading("終る", "おわる", "終", "おわ"), true);
  assert.equal(surfaceCarriesReading("終る", "おわる", "終", "お"), false);
  assert.equal(surfaceCarriesReading("終わる", "おわる", "終", "お"), true);
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
  const sourceManifest = await readFile(
    join(rootDirectory, "data", "source", "kanji-curricula.json"),
    "utf8"
  ).then(JSON.parse);
  const sourceMnemonics = (await Promise.all(sourceManifest.map(({ mnemonicSource }) => (
    readFile(join(rootDirectory, "data", "source", mnemonicSource), "utf8").then(JSON.parse)
  )))).flat();
  const frenchSourceMnemonics = Object.assign({}, ...await Promise.all(
    sourceManifest.map(({ mnemonicSource }) => (
      readFile(
        join(rootDirectory, "data", "source", "locales", "fr", mnemonicSource),
        "utf8"
      ).then(JSON.parse)
    ))
  ));

  const mnemonicById = new Map(mnemonics.map((entry) => [entry.kanjiId, entry]));
  const sourceById = new Map(sourceMnemonics.map((entry) => [entry.kanjiId, entry]));

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
    const source = sourceById.get(mnemonic.kanjiId);

    assert.ok(source);
    assert.ok(Array.isArray(mnemonic.components));
    assert.ok(mnemonic.components.length >= 1);
    assert.ok(mnemonic.components.every(({ symbol, meaning }) => symbol && meaning));
    assert.ok(mnemonic.meaningStory.length > 0);
    assert.ok(mnemonic.readings.every(({ reading, story }) => (
      /^[ぁ-ゖ]+$/u.test(reading) && story.includes(reading)
    )));
    assert.ok(mnemonic.readings.every(({ anchorId }) => anchorId.length > 0));

    for (const { symbol, meaning } of mnemonic.components) {
      assert.equal(meaning, source.componentLabels?.[symbol] || englishComponents[symbol]);
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
    for (const { story } of localized.readings) {
      assert.ok(story.length > 20, `${kanjiId} needs a substantial French story`);
      assert.doesNotMatch(
        story,
        /Accrochez le son|rattachez cette variation/u,
        `${kanjiId} still has a template French story`
      );
    }
    for (const { symbol, meaning } of localized.components) {
      assert.equal(
        meaning,
        frenchSourceMnemonics[kanjiId].componentLabels?.[symbol] || frenchComponents[symbol]
      );
    }
    assert.ok(french[kanjiId].meaning.length > 0);
  }

  const component = (mnemonic, symbol) => mnemonic.components
    .find((entry) => entry.symbol === symbol)?.meaning;
  const english = (id) => mnemonicById.get(`kanji-${id}`);
  const frenchMnemonic = (id) => frenchMnemonics[`kanji-${id}`];

  assert.match(component(english("9752"), "月"), /not the moon/u);
  assert.match(component(frenchMnemonic("9752"), "月"), /pas la lune/u);
  assert.match(component(english("5357"), "羊"), /not a sheep/u);
  assert.match(component(frenchMnemonic("5357"), "羊"), /pas un mouton/u);
  assert.match(component(english("91d1"), "王"), /mineral/u);
  assert.match(component(frenchMnemonic("91d1"), "王"), /minerai/u);
  assert.match(component(english("5473"), "未"), /phonetic MI/u);
  assert.match(component(frenchMnemonic("5473"), "未"), /indice sonore MI/u);
  assert.equal(component(english("4e0a"), "卜"), "vertical mark");
  assert.equal(component(frenchMnemonic("4e0b"), "卜"), "trait vertical");
  assert.equal(component(english("5916"), "卜"), "divination mark");
  assert.equal(component(frenchMnemonic("5916"), "卜"), "trait de divination");

  for (const [id, name] of [
    ["4f55", "Nani"], ["56fd", "Kuni"], ["897f", "Nishi"],
    ["9759", "Shizu"], ["697d", "Gaku"], ["5148", "Saki"],
    ["9ad8", "Taka"], ["5b89", "Yasu"], ["8fd1", "Chika"],
    ["9577", "Naga"], ["5e30", "Kaede"], ["5e74", "Toshi"],
    ["4e2d", "Naka"], ["8d70", "Hashi"], ["5357", "Mina"]
  ]) {
    assert.ok(
      english(id).readings.every(({ story }) => !story.includes(`${name} gives`)),
      `${id} must not use its romanized reading as the only English cue`
    );
  }
  assert.doesNotMatch(
    mnemonics.flatMap(({ readings }) => readings.map(({ story }) => story)).join("\n"),
    /(?:his|her) name gives|Kyō gives|family starts with the sound か|zoo starts like ぞく|crowd begins like かい/u
  );
  assert.match(frenchMnemonic("9759").readings[0].story, /CHI-ZOU/u);

  const fire = mnemonicById.get("kanji-706b");
  const matter = mnemonicById.get("kanji-4e8b");
  const quality = mnemonicById.get("kanji-8cea");

  assert.deepEqual(fire.readings.map(({ reading }) => reading), ["か"]);
  assert.deepEqual(matter.readings.map(({ reading }) => reading), ["こと", "じ"]);
  assert.equal(matter.readings[0].anchorReading, "ごと");
  assert.deepEqual(quality.components.map(({ symbol }) => symbol), ["斤", "斤", "貝"]);
  assert.equal(
    sourceById.get("kanji-7d42").readings.find(({ reading }) => reading === "お").anchorSurface,
    "終わる"
  );
});
