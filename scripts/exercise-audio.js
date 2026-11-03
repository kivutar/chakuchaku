const safeExerciseId = /^[a-z0-9-]+$/u;

function japaneseText(exercise) {
  return exercise.type === "production" ? exercise.solution : exercise.text;
}

// Audio owners are explicit and independent of which files happen to exist.
export function resolveExerciseAudioSources(exercises) {
  const byId = new Map();

  for (const exercise of exercises) {
    if (typeof exercise?.id !== "string" ||
      !safeExerciseId.test(exercise.id) || byId.has(exercise.id)) {
      throw new Error(`${exercise?.id}: shared audio needs unique, safe exercise IDs.`);
    }
    byId.set(exercise.id, exercise);
  }

  return exercises.map((exercise) => {
    if (exercise.audioSourceId === undefined) return exercise;

    const source = byId.get(exercise.audioSourceId);

    if (typeof exercise.audioSourceId !== "string" ||
      !safeExerciseId.test(exercise.audioSourceId) || !source) {
      throw new Error(`${exercise.id}: unknown audio source ${exercise.audioSourceId}.`);
    }
    if (source === exercise || source.audioSourceId !== undefined) {
      throw new Error(`${exercise.id}: audioSourceId must refer directly to an audio owner.`);
    }
    if (exercise.readingSentenceId !== undefined || source.readingSentenceId !== undefined) {
      throw new Error(`${exercise.id}: use readingSentenceId to share a reading voice.`);
    }
    if (Object.hasOwn(exercise, "audio")) {
      throw new Error(`${exercise.id}: audio must come from its audio source.`);
    }

    const text = japaneseText(exercise);
    const sourceText = japaneseText(source);

    if (typeof text !== "string" || !text.trim() || text !== sourceText) {
      throw new Error(`${exercise.id}: shared audio requires identical Japanese text.`);
    }
    if ((exercise.speechText || text) !== (source.speechText || sourceText)) {
      throw new Error(`${exercise.id}: shared audio requires identical narration text.`);
    }

    return { ...exercise, audio: `assets/voices/grammar/${source.id}.m4a` };
  });
}
