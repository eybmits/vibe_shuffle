export const FACE_BASELINE_FRAMES = 30;
export const FACE_SAMPLE_INTERVAL_MS = 120;
export const FACE_EMA_ALPHA = 0.34;
export const HAPPY_MIN_SCORE = 0.24;
export const SAD_MIN_SCORE = 0.24;
export const TENSE_MIN_SCORE = 0.32;
export const EXPRESSION_SWITCH_MARGIN = 0.1;
export const MIN_SUSTAINED_SAMPLES = 3;
export const SAD_FAST_SWITCH_SCORE = 0.42;
export const SAD_FAST_SWITCH_SAMPLES = 2;

export const EXPRESSION_TAGS = ["happy", "relaxed", "tense", "sad_low"];

const clamp = (value, min = 0, max = 1) => Math.min(Math.max(value, min), max);

export function expressionScore(categories, name) {
  return categories.find((category) => category.categoryName === name)?.score ?? 0;
}

export function expressionFeatures(categories) {
  const score = (name) => expressionScore(categories, name);
  const average = (...names) => names.reduce((total, name) => total + score(name), 0) / names.length;

  return {
    browDown: average("browDownLeft", "browDownRight"),
    browInnerUp: score("browInnerUp"),
    cheekSquint: average("cheekSquintLeft", "cheekSquintRight"),
    eyeSquint: average("eyeSquintLeft", "eyeSquintRight"),
    eyeWide: average("eyeWideLeft", "eyeWideRight"),
    frown: average("mouthFrownLeft", "mouthFrownRight"),
    jawOpen: score("jawOpen"),
    mouthLowerDown: average("mouthLowerDownLeft", "mouthLowerDownRight"),
    mouthPress: average("mouthPressLeft", "mouthPressRight"),
    mouthPucker: score("mouthPucker"),
    mouthRollLower: score("mouthRollLower"),
    mouthShrugLower: score("mouthShrugLower"),
    mouthStretch: average("mouthStretchLeft", "mouthStretchRight"),
    smile: average("mouthSmileLeft", "mouthSmileRight"),
  };
}

export function createExpressionBaseline() {
  return {
    samples: 0,
    sums: {
      browDown: 0,
      browInnerUp: 0,
      cheekSquint: 0,
      eyeSquint: 0,
      eyeWide: 0,
      frown: 0,
      jawOpen: 0,
      mouthLowerDown: 0,
      mouthPress: 0,
      mouthPucker: 0,
      mouthRollLower: 0,
      mouthShrugLower: 0,
      mouthStretch: 0,
      smile: 0,
    },
  };
}

export function addBaselineSample(baseline, features) {
  const nextBaseline = {
    samples: baseline.samples + 1,
    sums: { ...baseline.sums },
  };

  Object.keys(nextBaseline.sums).forEach((key) => {
    nextBaseline.sums[key] += features[key] ?? 0;
  });

  return nextBaseline;
}

export function baselineMeans(baseline) {
  const divisor = Math.max(1, baseline.samples);
  return Object.fromEntries(
    Object.entries(baseline.sums).map(([key, value]) => [key, value / divisor]),
  );
}

function positiveDelta(features, baseline, key) {
  return Math.max(0, (features[key] ?? 0) - (baseline[key] ?? 0));
}

export function initialExpressionScores() {
  return {
    happy: 0,
    relaxed: 1,
    tense: 0,
    sad_low: 0,
  };
}

export function scoreExpressionFeatures(features, baseline = {}) {
  const smileDelta = positiveDelta(features, baseline, "smile");
  const frownDelta = positiveDelta(features, baseline, "frown");
  const cheekDelta = positiveDelta(features, baseline, "cheekSquint");
  const browDownDelta = positiveDelta(features, baseline, "browDown");
  const browInnerUpDelta = positiveDelta(features, baseline, "browInnerUp");
  const mouthLowerDownDelta = positiveDelta(features, baseline, "mouthLowerDown");
  const mouthPressDelta = positiveDelta(features, baseline, "mouthPress");
  const mouthPuckerDelta = positiveDelta(features, baseline, "mouthPucker");
  const mouthRollLowerDelta = positiveDelta(features, baseline, "mouthRollLower");
  const mouthShrugLowerDelta = positiveDelta(features, baseline, "mouthShrugLower");
  const jawOpenDelta = positiveDelta(features, baseline, "jawOpen");
  const mouthStretchDelta = positiveDelta(features, baseline, "mouthStretch");
  const smile = features.smile ?? 0;
  const frown = features.frown ?? 0;
  const lowSmile = Math.max(0, 0.12 - smile);

  const happy = clamp(
    smileDelta * 2.7 +
      smile * 0.8 +
      cheekDelta * 1.2 +
      (features.cheekSquint ?? 0) * 0.32 -
      frown * 0.35,
  );

  const sadMouthCue = Math.max(
    frownDelta,
    mouthShrugLowerDelta * 0.82,
    mouthPuckerDelta * 0.72,
    mouthLowerDownDelta * 0.62,
  );
  const sadBrowCue = browInnerUpDelta + (features.browInnerUp ?? 0) * 0.22;
  const sadGate =
    frown >= 0.055 ||
    frownDelta >= 0.025 ||
    (sadBrowCue >= 0.045 && sadMouthCue >= 0.022);
  const sadBase =
    frownDelta * 3.8 +
    frown * 1.8 +
    browInnerUpDelta * 1.62 +
    (features.browInnerUp ?? 0) * 0.35 +
    mouthShrugLowerDelta * 1.35 +
    (features.mouthShrugLower ?? 0) * 0.35 +
    mouthPuckerDelta * 0.75 +
    (features.mouthPucker ?? 0) * 0.35 +
    mouthPressDelta * 0.58 +
    mouthLowerDownDelta * 0.62 +
    mouthRollLowerDelta * 0.45 +
    browDownDelta * 0.28 +
    lowSmile * 0.22 -
    smile * 0.58 -
    (features.cheekSquint ?? 0) * 0.18;
  const sadLow = clamp(sadGate ? sadBase : sadBase * 0.25);

  const tense = clamp(
    browDownDelta * 2.2 +
      (features.browDown ?? 0) * 0.55 +
      mouthPressDelta * 1.5 +
      (features.mouthPress ?? 0) * 0.45 +
      jawOpenDelta * 0.65 +
      mouthStretchDelta * 0.45 +
      (features.eyeWide ?? 0) * 0.2 -
      smile * 0.35,
  );

  const activeMax = Math.max(happy, sadLow, tense);
  const relaxed = clamp(1 - activeMax * 1.35 + Math.max(0, 0.11 - activeMax) * 1.5);

  return {
    happy,
    relaxed,
    tense,
    sad_low: sadLow,
  };
}

export function classifyExpressionScores(
  scores,
  previousTag = "relaxed",
  candidate = { tag: "relaxed", count: 0 },
) {
  const activeScores = [
    ["happy", scores.happy >= HAPPY_MIN_SCORE ? scores.happy : 0],
    ["tense", scores.tense >= TENSE_MIN_SCORE ? scores.tense : 0],
    ["sad_low", scores.sad_low >= SAD_MIN_SCORE ? scores.sad_low : 0],
  ].sort((a, b) => b[1] - a[1]);
  const [topTag, topScore] = activeScores[0];
  const secondScore = activeScores[1]?.[1] ?? 0;
  const proposedTag =
    topScore > 0 && topScore >= secondScore + EXPRESSION_SWITCH_MARGIN ? topTag : "relaxed";

  if (proposedTag === previousTag) {
    return {
      candidate: { tag: proposedTag, count: 0 },
      tag: previousTag,
    };
  }

  const nextCandidate =
    candidate.tag === proposedTag
      ? { tag: proposedTag, count: candidate.count + 1 }
      : { tag: proposedTag, count: 1 };

  const requiredSamples =
    proposedTag === "sad_low" && topScore >= SAD_FAST_SWITCH_SCORE
      ? SAD_FAST_SWITCH_SAMPLES
      : MIN_SUSTAINED_SAMPLES;

  return {
    candidate: nextCandidate,
    tag: nextCandidate.count >= requiredSamples ? proposedTag : previousTag,
  };
}

function dominantWindowTag(scores) {
  const activeScores = [
    ["happy", scores.happy >= HAPPY_MIN_SCORE ? scores.happy : 0],
    ["tense", scores.tense >= TENSE_MIN_SCORE ? scores.tense : 0],
    ["sad_low", scores.sad_low >= SAD_MIN_SCORE ? scores.sad_low : 0],
  ].sort((a, b) => b[1] - a[1]);
  const [topTag, topScore] = activeScores[0];

  return topScore > 0 ? topTag : "relaxed";
}

export function expressionStateFromTag(tag, scores, facePresent = true) {
  const confidence = clamp(scores[tag] ?? 0);

  if (tag === "happy") {
    return {
      confidence,
      energy: clamp(0.56 + confidence * 0.34, 0.52, 0.9),
      facePresent,
      scores,
      tag,
      valence: clamp(0.58 + confidence * 0.36, 0.55, 0.95),
    };
  }

  if (tag === "tense") {
    return {
      confidence,
      energy: clamp(0.58 + confidence * 0.34, 0.55, 0.92),
      facePresent,
      scores,
      tag,
      valence: clamp(0.38 - confidence * 0.18, 0.12, 0.45),
    };
  }

  if (tag === "sad_low") {
    return {
      confidence,
      energy: clamp(0.38 - confidence * 0.18, 0.12, 0.44),
      facePresent,
      scores,
      tag,
      valence: clamp(0.42 - confidence * 0.28, 0.06, 0.45),
    };
  }

  return {
    confidence,
    energy: clamp(0.28 + (1 - confidence) * 0.08, 0.24, 0.4),
    facePresent,
    scores,
    tag: "relaxed",
    valence: clamp(0.66 + confidence * 0.08, 0.58, 0.78),
  };
}

export function createExpressionTrackerState() {
  return {
    baseline: createExpressionBaseline(),
    candidate: { tag: "relaxed", count: 0 },
    smoothedScores: initialExpressionScores(),
    tag: "relaxed",
  };
}

export function updateExpressionTracker(tracker, categories) {
  const features = expressionFeatures(categories);

  if (tracker.baseline.samples < FACE_BASELINE_FRAMES) {
    const baseline = addBaselineSample(tracker.baseline, features);
    return {
      expression: expressionStateFromTag("relaxed", initialExpressionScores(), true),
      sample: null,
      status: "calibrating",
      tracker: {
        ...tracker,
        baseline,
        smoothedScores: initialExpressionScores(),
        tag: "relaxed",
      },
    };
  }

  const rawScores = scoreExpressionFeatures(features, baselineMeans(tracker.baseline));
  const smoothedScores = Object.fromEntries(
    EXPRESSION_TAGS.map((tag) => [
      tag,
      tracker.smoothedScores[tag] * (1 - FACE_EMA_ALPHA) + rawScores[tag] * FACE_EMA_ALPHA,
    ]),
  );
  const classification = classifyExpressionScores(
    smoothedScores,
    tracker.tag,
    tracker.candidate,
  );
  const expression = expressionStateFromTag(classification.tag, smoothedScores, true);

  return {
    expression,
    sample: {
      confidence: expression.confidence,
      energy: expression.energy,
      facePresent: true,
      scores: smoothedScores,
      tag: expression.tag,
      timestamp: Date.now(),
      valence: expression.valence,
    },
    status: "ready",
    tracker: {
      ...tracker,
      candidate: classification.candidate,
      smoothedScores,
      tag: classification.tag,
    },
  };
}

export function summarizeExpressionSamples(samples, fallbackExpression = null) {
  if (!samples.length) {
    const fallbackScores = fallbackExpression?.scores ?? initialExpressionScores();
    const fallbackTag = fallbackExpression?.tag ?? "relaxed";

    return {
      confidence: fallbackExpression?.confidence ?? fallbackScores[fallbackTag] ?? 0,
      energy: fallbackExpression?.energy ?? expressionStateFromTag(fallbackTag, fallbackScores).energy,
      facePresent: Boolean(fallbackExpression?.facePresent),
      mean_happy: fallbackScores.happy ?? 0,
      mean_relaxed: fallbackScores.relaxed ?? 1,
      mean_tense: fallbackScores.tense ?? 0,
      mean_sad_low: fallbackScores.sad_low ?? 0,
      sampleCount: 0,
      tag: fallbackTag,
      valence:
        fallbackExpression?.valence ?? expressionStateFromTag(fallbackTag, fallbackScores).valence,
    };
  }

  const meanScores = Object.fromEntries(
    EXPRESSION_TAGS.map((tag) => [
      tag,
      samples.reduce((total, sample) => total + (sample.scores?.[tag] ?? 0), 0) / samples.length,
    ]),
  );
  const tag = dominantWindowTag(meanScores);
  const windowState = expressionStateFromTag(
    tag,
    meanScores,
    samples.some((sample) => sample.facePresent),
  );
  const confidence = windowState.confidence;

  return {
    confidence,
    energy: windowState.energy,
    facePresent: windowState.facePresent,
    mean_happy: meanScores.happy,
    mean_relaxed: meanScores.relaxed,
    mean_tense: meanScores.tense,
    mean_sad_low: meanScores.sad_low,
    sampleCount: samples.length,
    tag,
    valence: windowState.valence,
  };
}
