import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as wanakana from "wanakana";

await import("../voice-paths.js");

const {
  createVocabularyReadingSlug,
  getConjugationVoicePath,
  getVocabularyVoicePath,
  validateConjugationVoicePaths,
  validateVocabularyVoiceSlugs
} = globalThis.JlptN5VoicePaths;

test("unique readings produce readable rōmaji voice paths", () => {
  assert.equal(createVocabularyReadingSlug("きんようび", wanakana), "kin-youbi");
  assert.equal(createVocabularyReadingSlug("～にん", wanakana), "nin");
  assert.equal(getVocabularyVoicePath({ reading: "あおい" }, wanakana), (
    "assets/voices/vocab/aoi.m4a"
  ));
});

test("reading collisions require explicit unique semantic slugs", () => {
  const rain = {
    id: "rain",
    reading: "あめ",
    voiceSlug: "ame-rain"
  };
  const candy = {
    id: "candy",
    reading: "あめ",
    voiceSlug: "ame-candy"
  };

  assert.doesNotThrow(() => validateVocabularyVoiceSlugs([rain, candy], wanakana));
  assert.equal(getVocabularyVoicePath(rain, wanakana), "assets/voices/vocab/ame-rain.m4a");
  assert.throws(
    () => validateVocabularyVoiceSlugs([rain, { id: "candy", reading: "あめ" }], wanakana),
    /needs a semantic voiceSlug/u
  );
  assert.throws(
    () => validateVocabularyVoiceSlugs([
      rain,
      { ...candy, voiceSlug: "ame-rain" }
    ], wanakana),
    /already used/u
  );
});

test("voice slugs reject unsafe and unnecessary overrides", () => {
  assert.throws(
    () => validateVocabularyVoiceSlugs([
      { id: "rain", reading: "あめ", voiceSlug: "../rain" }
    ], wanakana),
    /safe slug/u
  );
  assert.throws(
    () => validateVocabularyVoiceSlugs([
      { id: "rain", reading: "あめ", voiceSlug: "ame-rain" }
    ], wanakana),
    /unnecessary/u
  );
});

test("conjugation voice paths stay readable and distinguish homophones", () => {
  const hot = {
    id: "hot",
    reading: "あつい",
    voiceSlug: "atsui-hot",
    answerReading: "あつかったです"
  };
  const thick = {
    id: "thick",
    reading: "あつい",
    voiceSlug: "atsui-thick",
    answerReading: "あつかったです"
  };

  assert.equal(getConjugationVoicePath(hot, wanakana), (
    "assets/voices/conjugation/atsukattadesu-atsui-hot.m4a"
  ));
  assert.notEqual(getConjugationVoicePath(hot, wanakana), (
    getConjugationVoicePath(thick, wanakana)
  ));
  assert.equal(validateConjugationVoicePaths([hot, thick], wanakana).size, 2);
  assert.throws(
    () => validateConjugationVoicePaths([hot, { ...hot, id: "duplicate" }], wanakana),
    /already used/u
  );
});

test("the curated vocabulary has one stable readable voice path per entry", async () => {
  const vocabulary = JSON.parse(await readFile(
    new URL("../data/jlpt-n5-vocabulary.json", import.meta.url),
    "utf8"
  ));
  const voiceSlugs = validateVocabularyVoiceSlugs(vocabulary, wanakana);

  assert.equal(voiceSlugs.size, 840);
  assert.equal(vocabulary.filter(({ voiceSlug }) => voiceSlug).length, 59);
  assert.equal(
    getVocabularyVoicePath(vocabulary.find(({ term }) => term === "青い"), wanakana),
    "assets/voices/vocab/aoi.m4a"
  );
  assert.equal(
    getVocabularyVoicePath(vocabulary.find(({ term }) => term === "雨"), wanakana),
    "assets/voices/vocab/ame-rain.m4a"
  );
});
