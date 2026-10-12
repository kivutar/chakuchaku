import "../reading.js";

const sharedSentenceFields = [
  "tokenOverrides", "vocabularyOverrides", "speechText", "skipVoiceGeneration"
];

// Grammar sources may borrow a reading sentence. The Japanese text, tokenizer
// overrides, and voice remain owned by the reading, not a second editable copy.
export function resolveReadingGrammarExercises(exercises, passages) {
  globalThis.JlptN5Reading.validatePassages(passages);
  const sentencesById = new Map(passages.flatMap((passage) => (
    passage.sentences.map((sentence) => [sentence.id, { sentence, level: passage.level }])
  )));

  return exercises.map((exercise) => {
    if (exercise.readingSentenceId === undefined) return exercise;
    const source = sentencesById.get(exercise.readingSentenceId);
    if (!source) {
      throw new Error(`${exercise.id}: unknown reading sentence ${exercise.readingSentenceId}.`);
    }
    if (exercise.type !== undefined && !["recognition", "production"].includes(exercise.type)) {
      throw new Error(`${exercise.id}: invalid reading grammar exercise type.`);
    }
    const japaneseField = exercise.type === "production" ? "solution" : "text";
    for (const field of [japaneseField, ...sharedSentenceFields, "audio", "minimumLevel"]) {
      if (Object.hasOwn(exercise, field)) {
        throw new Error(`${exercise.id}: ${field} must come from its reading sentence.`);
      }
    }
    const { sentence, level } = source;
    return {
      ...exercise,
      [japaneseField]: sentence.text,
      minimumLevel: level,
      audio: `assets/voices/reading/${sentence.id}.m4a`,
      ...Object.fromEntries(
        sharedSentenceFields
          .filter((field) => sentence[field] !== undefined)
          .map((field) => [field, sentence[field]])
      )
    };
  });
}
