import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const selectionCode = await readFile(join(rootDirectory, "exercise-selection.js"), "utf8");
const curriculumExercises = JSON.parse(
  await readFile(join(rootDirectory, "data", "exercises.json"), "utf8")
);

function loadSelectionApi() {
  const context = {};

  context.globalThis = context;
  vm.runInNewContext(selectionCode, context);
  return context.JlptN5ExerciseSelection;
}

const exercises = [
  { id: "recognition-a", grammarPointIds: ["point-a", "point-b"] },
  { id: "recognition-b", grammarPointIds: ["point-a", "point-b"] },
  {
    id: "production-a",
    type: "production",
    grammarPointIds: ["point-a", "point-b"]
  }
];

function completedAttempt(exerciseId, grammarPointIds = ["point-a", "point-b"]) {
  return {
    exerciseId,
    grammarRatings: grammarPointIds.map((grammarPointId) => ({
      grammarPointId,
      outcome: "good"
    }))
  };
}

function selectType(exerciseHistory, overrides = {}) {
  return loadSelectionApi().selectExerciseTypePool({
    exercises,
    candidates: exercises,
    exerciseHistory,
    ...overrides
  }).map(({ id }) => id);
}

function selectTarget(exerciseHistory, targetGrammarPointId, overrides = {}) {
  return loadSelectionApi().selectTargetExercisePool({
    candidates: exercises,
    exerciseHistory,
    targetGrammarPointId,
    ...overrides
  }).map(({ id }) => id);
}

test("ordinary exercise positions use recognition exercises", () => {
  assert.deepEqual(selectType([]), ["recognition-a", "recognition-b"]);
  assert.deepEqual(selectType([
    completedAttempt("recognition-a"),
    completedAttempt("recognition-b")
  ]), ["recognition-a", "recognition-b"]);
});

test("recognition exercises introduce at most one new grammar point when possible", () => {
  const mixedExercises = [
    { id: "known", grammarPointIds: ["known-a", "known-b"] },
    { id: "one-new", grammarPointIds: ["known-a", "new-a"] },
    { id: "two-new", grammarPointIds: ["new-b", "new-c"] }
  ];
  const history = [{
    exerciseId: "known",
    grammarRatings: [
      { grammarPointId: "known-a", outcome: "good" },
      { grammarPointId: "known-b", outcome: "again" }
    ]
  }];

  assert.deepEqual(selectTarget(history, "known-a", {
    candidates: mixedExercises
  }), ["known", "one-new"]);
});

test("target selection prefers the fewest new points for a fresh learner", () => {
  const freshExercises = [
    { id: "one-new", grammarPointIds: ["target"] },
    { id: "two-new", grammarPointIds: ["target", "new-a"] }
  ];

  assert.deepEqual(selectTarget([], "target", {
    candidates: freshExercises
  }), ["one-new"]);
});

test("target selection allows the smallest unavoidable bundle of new points", () => {
  const bundledExercises = [
    { id: "two-new", grammarPointIds: ["target", "new-a"] },
    { id: "three-new", grammarPointIds: ["target", "new-b", "new-c"] }
  ];

  assert.deepEqual(selectTarget([], "target", {
    candidates: bundledExercises
  }), ["two-new"]);
});

test("a point that only appears in a three-point bundle remains selectable", () => {
  const bundledExercise = {
    id: "verb-groups",
    grammarPointIds: ["verb-groups", "ichidan-conjugation", "godan-conjugation"]
  };

  assert.deepEqual(selectTarget([], "verb-groups", {
    candidates: [bundledExercise]
  }), ["verb-groups"]);
});

test("the bundled verb-group curriculum points can all be introduced", () => {
  const selectionApi = loadSelectionApi();
  const recognitionPool = selectionApi.selectExerciseTypePool({
    exercises: curriculumExercises,
    candidates: curriculumExercises,
    exerciseHistory: []
  });

  for (const targetGrammarPointId of [
    "verb-groups",
    "ichidan-conjugation",
    "godan-conjugation"
  ]) {
    const targetPool = selectionApi.selectTargetExercisePool({
      candidates: recognitionPool,
      exerciseHistory: [],
      targetGrammarPointId
    });

    assert.ok(
      targetPool.length > 0,
      `${targetGrammarPointId} should have a selectable introduction exercise`
    );
  }
});

test("every fifth completed exercise prefers an eligible production exercise", () => {
  const history = [
    completedAttempt("recognition-a"),
    completedAttempt("recognition-b"),
    completedAttempt("recognition-a"),
    completedAttempt("recognition-b")
  ];

  assert.deepEqual(selectType(history), ["production-a"]);
});

test("production cadence considers every ready grammar point before SRS targeting", () => {
  const mixedExercises = [
    ...exercises,
    { id: "recognition-unready", grammarPointIds: ["point-unready"] }
  ];
  const history = [
    completedAttempt("recognition-a"),
    completedAttempt("recognition-b"),
    completedAttempt("recognition-a"),
    completedAttempt("recognition-b")
  ];

  assert.deepEqual(selectType(history, {
    exercises: mixedExercises,
    candidates: mixedExercises
  }), ["production-a"]);
});

test("production falls back when any assessed grammar point lacks recognition", () => {
  const history = [
    completedAttempt("recognition-a"),
    completedAttempt("recognition-b", ["point-a"]),
    completedAttempt("recognition-a", ["point-a"]),
    completedAttempt("recognition-b", ["point-a"])
  ];

  assert.deepEqual(selectType(history), ["recognition-a", "recognition-b"]);
});

test("repeating one recognition sentence does not satisfy the threshold", () => {
  const repeatedAttempt = completedAttempt("recognition-a");

  assert.deepEqual(selectType([
    repeatedAttempt,
    repeatedAttempt,
    repeatedAttempt,
    repeatedAttempt
  ]), ["recognition-a", "recognition-b"]);
});

test("unfinished attempts do not affect cadence or readiness", () => {
  const unfinishedAttempt = { exerciseId: "recognition-a", grammarRatings: [] };

  assert.deepEqual(selectType([
    completedAttempt("recognition-a"),
    completedAttempt("recognition-b"),
    completedAttempt("recognition-a"),
    unfinishedAttempt
  ]), ["recognition-a", "recognition-b"]);
});

test("the forced production mode bypasses cadence and readiness", () => {
  assert.deepEqual(selectType([], { forcedExerciseType: "production" }), ["production-a"]);
});

test("forced exercise modes also bypass the new-point limiter", () => {
  const bundledExercise = {
    id: "forced-bundle",
    grammarPointIds: ["target", "new-a", "new-b"]
  };

  assert.deepEqual(selectTarget([], "target", {
    candidates: [bundledExercise],
    forcedExerciseType: "recognition"
  }), ["forced-bundle"]);
});
