import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyExpressionScores,
  createExpressionBaseline,
  createExpressionTrackerState,
  expressionStateFromTag,
  scoreExpressionFeatures,
  summarizeExpressionSamples,
  updateExpressionTracker,
} from "./expressionModel.js";

const neutral = {
  browDown: 0.02,
  browInnerUp: 0.01,
  cheekSquint: 0.01,
  eyeSquint: 0.02,
  eyeWide: 0.01,
  frown: 0.015,
  jawOpen: 0.01,
  mouthPress: 0.02,
  mouthPucker: 0.01,
  mouthLowerDown: 0.01,
  mouthRollLower: 0.01,
  mouthShrugLower: 0.01,
  mouthStretch: 0.01,
  smile: 0.02,
};

function classifySequence(scoreFrames, previousTag = "relaxed") {
  let tag = previousTag;
  let candidate = { tag: previousTag, count: 0 };

  for (const scores of scoreFrames) {
    const result = classifyExpressionScores(scores, tag, candidate);
    tag = result.tag;
    candidate = result.candidate;
  }

  return tag;
}

function categoriesFromFeatures(features) {
  const pairs = {
    browDownLeft: features.browDown,
    browDownRight: features.browDown,
    browInnerUp: features.browInnerUp,
    cheekSquintLeft: features.cheekSquint,
    cheekSquintRight: features.cheekSquint,
    eyeSquintLeft: features.eyeSquint,
    eyeSquintRight: features.eyeSquint,
    eyeWideLeft: features.eyeWide,
    eyeWideRight: features.eyeWide,
    jawOpen: features.jawOpen,
    mouthFrownLeft: features.frown,
    mouthFrownRight: features.frown,
    mouthLowerDownLeft: features.mouthLowerDown,
    mouthLowerDownRight: features.mouthLowerDown,
    mouthPressLeft: features.mouthPress,
    mouthPressRight: features.mouthPress,
    mouthPucker: features.mouthPucker,
    mouthRollLower: features.mouthRollLower,
    mouthShrugLower: features.mouthShrugLower,
    mouthSmileLeft: features.smile,
    mouthSmileRight: features.smile,
    mouthStretchLeft: features.mouthStretch,
    mouthStretchRight: features.mouthStretch,
  };

  return Object.entries(pairs).map(([categoryName, score]) => ({ categoryName, score }));
}

test("neutral baseline remains relaxed", () => {
  const scores = scoreExpressionFeatures(neutral, neutral);
  const tag = classifySequence([scores, scores, scores, scores]);

  assert.equal(tag, "relaxed");
  assert.ok(scores.relaxed > scores.sad_low);
});

test("smile sequence becomes happy", () => {
  const scores = scoreExpressionFeatures({ ...neutral, cheekSquint: 0.12, smile: 0.48 }, neutral);
  const tag = classifySequence([scores, scores, scores, scores]);

  assert.equal(tag, "happy");
});

test("brief one-frame frown does not become sad_low", () => {
  const frownScores = scoreExpressionFeatures(
    { ...neutral, browInnerUp: 0.12, frown: 0.42, mouthPress: 0.14 },
    neutral,
  );
  const relaxedScores = scoreExpressionFeatures(neutral, neutral);
  const tag = classifySequence([frownScores, relaxedScores, relaxedScores, relaxedScores]);

  assert.equal(tag, "relaxed");
});

test("sustained frown becomes sad_low", () => {
  const scores = scoreExpressionFeatures(
    { ...neutral, browInnerUp: 0.16, frown: 0.45, mouthPress: 0.16, smile: 0.01 },
    neutral,
  );
  const tag = classifySequence([scores, scores, scores, scores]);

  assert.equal(tag, "sad_low");
});

test("subtle sustained sad expression becomes sad_low", () => {
  const scores = scoreExpressionFeatures(
    {
      ...neutral,
      browInnerUp: 0.09,
      frown: 0.09,
      mouthPucker: 0.04,
      mouthShrugLower: 0.07,
      smile: 0.005,
    },
    neutral,
  );
  const tag = classifySequence([scores, scores, scores, scores]);

  assert.equal(tag, "sad_low");
  assert.ok(scores.sad_low >= 0.24);
});

test("raised inner brow without mouth cue stays relaxed", () => {
  const scores = scoreExpressionFeatures(
    { ...neutral, browInnerUp: 0.13, frown: 0.02, mouthShrugLower: 0.012, smile: 0.015 },
    neutral,
  );
  const tag = classifySequence([scores, scores, scores, scores]);

  assert.equal(tag, "relaxed");
});

test("tracker detects subtle sad expression after neutral baseline", () => {
  let tracker = createExpressionTrackerState();

  for (let index = 0; index < 30; index += 1) {
    tracker = updateExpressionTracker(tracker, categoriesFromFeatures(neutral)).tracker;
  }

  const subtleSad = {
    ...neutral,
    browInnerUp: 0.09,
    frown: 0.09,
    mouthPucker: 0.04,
    mouthShrugLower: 0.07,
    smile: 0.005,
  };
  let expression = null;
  for (let index = 0; index < 8; index += 1) {
    const update = updateExpressionTracker(tracker, categoriesFromFeatures(subtleSad));
    tracker = update.tracker;
    expression = update.expression;
  }

  assert.equal(expression.tag, "sad_low");
});

test("brow and mouth tension without smile becomes tense", () => {
  const scores = scoreExpressionFeatures(
    { ...neutral, browDown: 0.42, eyeWide: 0.13, jawOpen: 0.1, mouthPress: 0.34, smile: 0.01 },
    neutral,
  );
  const tag = classifySequence([scores, scores, scores, scores]);

  assert.equal(tag, "tense");
});

test("window average beats last-second noise", () => {
  const happy = expressionStateFromTag("happy", {
    happy: 0.72,
    relaxed: 0.1,
    tense: 0.04,
    sad_low: 0.02,
  });
  const sadNoise = expressionStateFromTag("sad_low", {
    happy: 0.05,
    relaxed: 0.08,
    tense: 0.04,
    sad_low: 0.7,
  });
  const samples = [
    ...Array.from({ length: 8 }, () => happy),
    sadNoise,
  ];
  const summary = summarizeExpressionSamples(samples);

  assert.equal(summary.tag, "happy");
  assert.ok(summary.mean_happy > summary.mean_sad_low);
});

test("empty window falls back to relaxed when no camera samples exist", () => {
  const summary = summarizeExpressionSamples([], null);

  assert.equal(summary.tag, "relaxed");
  assert.equal(summary.sampleCount, 0);
});
