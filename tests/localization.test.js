import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  hasPromptHint,
  splitPromptTokens,
  validateFrenchContent,
  validateUiCatalogs
} from "../scripts/localization.js";

const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (path) => readFile(join(rootDirectory, path), "utf8").then(JSON.parse);

test("French prompt hints support contractions without matching inside words", () => {
  assert.equal(hasPromptHint("Je vais à l’école aujourd’hui.", "école"), true);
  assert.equal(hasPromptHint("Je vais à l’école aujourd’hui.", "aujourd’hui"), true);
  assert.equal(hasPromptHint("Qu’est-ce que tu as acheté ?", "Qu’"), true);
  assert.equal(hasPromptHint("encore", "or"), false);
});

test("French prompt tokens handle apostrophes and punctuation", () => {
  assert.deepEqual(splitPromptTokens("J’étudie à l’école, aujourd’hui."), [
    "J",
    "étudie",
    "à",
    "l",
    "école",
    "aujourd",
    "hui"
  ]);
});

test("content localization validates exact ids, hints, and accepted answers", () => {
  const sources = {
    exercises: [{
      id: "production-school",
      text: "I go to school.",
      solution: "学校へ行きます。",
      type: "production",
      promptVocabularyHints: [{ word: "school", vocabularyIds: ["school"] }]
    }],
    grammar: [{ id: "e-direction" }],
    vocabulary: [{ id: "school" }],
    kanji: [{ id: "kanji-school" }],
    vocabularyExamples: [{ vocabularyId: "school" }]
  };
  const localizations = {
    exercises: {
      "production-school": {
        translation: "Je vais à l’école.",
        promptVocabularyHints: [{ word: "école", vocabularyIds: ["school"] }]
      }
    },
    grammar: { "e-direction": { name: "Direction avec へ", meaning: "Indique une direction." } },
    vocabulary: { school: { meaning: "école", acceptedAnswers: ["école"] } },
    kanji: { "kanji-school": { meaning: "école" } },
    "vocabulary-examples": { school: { translation: "Je vais à l’école." } }
  };

  assert.deepEqual(validateFrenchContent({ ...sources, localizations }), []);

  localizations.exercises["production-school"].promptVocabularyHints[0].word = "collège";
  assert.match(validateFrenchContent({ ...sources, localizations }).join("\n"), /not a prompt token/);
});

test("localized whole-word reading stories mirror canonical readings", () => {
  const sources = {
    exercises: [],
    grammar: [],
    vocabulary: [{
      id: "tomorrow",
      specialReadings: [{
        reading: "あした",
        type: "whole-word",
        category: "jukujikun",
        meaningStory: "Bright day ahead.",
        readingStory: "ASH plus TA."
      }]
    }],
    kanji: [],
    vocabularyExamples: []
  };
  const localizations = {
    exercises: {},
    grammar: {},
    vocabulary: {
      tomorrow: {
        meaning: "demain",
        acceptedAnswers: ["demain"],
        specialReadings: {
          "あした": {
            meaningStory: "Le jour clair qui vient.",
            readingStory: "ACHÈTE À manger."
          }
        }
      }
    },
    kanji: {},
    "vocabulary-examples": {}
  };

  assert.deepEqual(validateFrenchContent({ ...sources, localizations }), []);
  delete localizations.vocabulary.tomorrow.specialReadings["あした"].readingStory;
  assert.match(
    validateFrenchContent({ ...sources, localizations }).join("\n"),
    /special-reading stories are required/
  );
});

test("UI catalog validation requires matching keys, plurals, and placeholders", () => {
  assert.deepEqual(validateUiCatalogs(
    { greeting: "Hello {name}", count: { one: "{count} item", other: "{count} items" } },
    { greeting: "Bonjour {name}", count: { one: "{count} élément", other: "{count} éléments" } }
  ), []);

  assert.match(validateUiCatalogs(
    { greeting: "Hello {name}" },
    { greeting: "Bonjour" }
  ).join("\n"), /placeholders/);
});

test("committed French catalogs completely cover canonical content", async () => {
  const [
    exercises,
    grammar,
    vocabulary,
    kanji,
    kanjiComponents,
    kanjiMnemonics,
    vocabularyExamples,
    englishUi,
    frenchUi,
    localizedExercises,
    localizedGrammar,
    localizedVocabulary,
    localizedKanji,
    localizedKanjiComponents,
    localizedKanjiMnemonics,
    localizedVocabularyExamples
  ] = await Promise.all([
    readJson("data/source/exercises.json"),
    readJson("data/jlpt-n5-grammar.json"),
    readJson("data/jlpt-n5-vocabulary.json"),
    readJson("data/jlpt-n5-kanji.json"),
    readJson("data/source/kanji-components.json"),
    readJson("data/source/kanji-mnemonics.json"),
    readJson("data/source/vocabulary-examples.json"),
    readJson("locales/en.json"),
    readJson("locales/fr.json"),
    readJson("data/source/locales/fr/exercises.json"),
    readJson("data/source/locales/fr/grammar.json"),
    readJson("data/source/locales/fr/vocabulary.json"),
    readJson("data/source/locales/fr/kanji.json"),
    readJson("data/source/locales/fr/kanji-components.json"),
    readJson("data/source/locales/fr/kanji-mnemonics.json"),
    readJson("data/source/locales/fr/vocabulary-examples.json")
  ]);

  assert.deepEqual(validateUiCatalogs(englishUi, frenchUi), []);
  assert.deepEqual(validateFrenchContent({
    exercises,
    grammar,
    vocabulary,
    kanji,
    kanjiComponents,
    kanjiMnemonics,
    vocabularyExamples,
    localizations: {
      exercises: localizedExercises,
      grammar: localizedGrammar,
      vocabulary: localizedVocabulary,
      kanji: localizedKanji,
      "kanji-components": localizedKanjiComponents,
      "kanji-mnemonics": localizedKanjiMnemonics,
      "vocabulary-examples": localizedVocabularyExamples
    }
  }), []);
});
