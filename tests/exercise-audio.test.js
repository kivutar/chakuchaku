import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { resolveExerciseAudioSources } from "../scripts/exercise-audio.js";

const owner = { id: "cat", text: "猫がいます。", solution: "There is a cat." };
const shared = {
  id: "production-cat", type: "production", text: "There is a cat.",
  solution: owner.text, audioSourceId: owner.id
};

test("matching exercises share an explicit audio owner without changing their content", () => {
  const sources = [shared, owner];
  const original = structuredClone(sources);
  const result = resolveExerciseAudioSources(sources);

  assert.equal(result[1], owner);
  assert.deepEqual(result[0], { ...shared, audio: "assets/voices/grammar/cat.m4a" });
  assert.deepEqual(sources, original);
  assert.equal(resolveExerciseAudioSources([
    { ...owner, speechText: "ねこがいます。" },
    { ...shared, speechText: "ねこがいます。" }
  ])[1].audio, "assets/voices/grammar/cat.m4a");
});

test("shared audio rejects drift in the Japanese sentence or its spoken reading", () => {
  assert.throws(() => resolveExerciseAudioSources([
    owner, { ...shared, solution: "犬がいます。" }
  ]), /identical Japanese text/u);
  assert.throws(() => resolveExerciseAudioSources([
    owner, { ...shared, speechText: "いぬがいます。" }
  ]), /identical narration text/u);
  assert.throws(() => resolveExerciseAudioSources([
    { ...owner, speechText: "ねこがいます。" }, shared
  ]), /identical narration text/u);
});

test("shared audio rejects invalid owners, chains and competing audio declarations", () => {
  for (const audioSourceId of [null, "", "unknown", "../cat"]) {
    assert.throws(() => resolveExerciseAudioSources([
      owner, { ...shared, audioSourceId }
    ]), /unknown audio source/u);
  }
  assert.throws(() => resolveExerciseAudioSources([
    { ...shared, audioSourceId: shared.id }
  ]), /directly to an audio owner/u);
  assert.throws(() => resolveExerciseAudioSources([
    owner, shared, { ...shared, id: "another", audioSourceId: shared.id }
  ]), /directly to an audio owner/u);
  assert.throws(() => resolveExerciseAudioSources([
    owner, { ...shared, audio: "assets/voices/grammar/other.m4a" }
  ]), /audio must come from/u);
  for (const sources of [
    [owner, { ...shared, readingSentenceId: "reading-cat" }],
    [{ ...owner, readingSentenceId: "reading-cat" }, shared]
  ]) {
    assert.throws(() => resolveExerciseAudioSources(sources), /use readingSentenceId/u);
  }
  assert.throws(() => resolveExerciseAudioSources([owner, owner]), /unique, safe exercise IDs/u);
});

test("every shared grammar card uses its owner's existing recording and preserves its identity", async () => {
  const readJson = path => readFile(new URL(`../${path}`, import.meta.url), "utf8").then(JSON.parse);
  const [sources, exercises] = await Promise.all([
    readJson("data/source/exercises.json"), readJson("data/exercises.json")
  ]);
  const sourcesById = new Map(sources.map(exercise => [exercise.id, exercise]));
  const preparedById = new Map(exercises.map(exercise => [exercise.id, exercise]));
  const aliases = sources.filter(exercise => exercise.audioSourceId);

  assert.ok(aliases.length > 0);
  assert.equal(exercises.filter(exercise => exercise.audioSourceId).length, aliases.length);
  for (const source of aliases) {
    const exercise = preparedById.get(source.id);
    const audioOwner = sourcesById.get(source.audioSourceId);

    assert.equal(exercise.id, source.id);
    assert.equal(exercise.text, source.text);
    assert.equal(exercise.solution, source.solution);
    assert.deepEqual(exercise.grammarPointIds, source.grammarPointIds);
    assert.equal(exercise.audio, preparedById.get(audioOwner.id).audio);
    await access(new URL(`../${exercise.audio}`, import.meta.url));
  }
});
