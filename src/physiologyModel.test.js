import test from "node:test";
import assert from "node:assert/strict";
import {
  computeHrvMetrics,
  createPhysiologyBaseline,
  filterRrIntervals,
  fuseEmotionSignals,
  parseHeartRateMeasurement,
  PHYSIOLOGY_AROUSAL_WEIGHT,
  summarizePhysiologyMeasurements,
} from "./physiologyModel.js";

const approx = (actual, expected, tolerance = 0.001) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

function measurementsFromRr(rrIntervalsMs, heartRateBpm = 75) {
  return rrIntervalsMs.map((rr, index) => ({
    heartRateBpm,
    rrIntervalsMs: [rr],
    timestamp: 1_700_000_000_000 + index * rr,
  }));
}

test("parses BLE heart-rate packet with uint8 bpm and multiple RR intervals", () => {
  const packet = new Uint8Array([0x10, 72, 0x00, 0x04, 0x00, 0x03]);
  const parsed = parseHeartRateMeasurement(packet, 123);

  assert.equal(parsed.heartRateBpm, 72);
  assert.equal(parsed.timestamp, 123);
  assert.deepEqual(parsed.rrIntervalsMs, [1000, 750]);
});

test("parses BLE heart-rate packet with uint16 bpm and RR intervals", () => {
  const packet = new Uint8Array([0x11, 0x2c, 0x01, 0x00, 0x04]);
  const parsed = parseHeartRateMeasurement(packet);

  assert.equal(parsed.heartRateBpm, 300);
  assert.deepEqual(parsed.rrIntervalsMs, [1000]);
});

test("computes HRV metrics from known RR sequence", () => {
  const metrics = computeHrvMetrics([800, 810, 790, 805], [74, 75, 76]);

  assert.equal(metrics.rr_count, 4);
  approx(metrics.mean_rr_ms, 801.25);
  approx(metrics.hr_bpm_mean, 75);
  approx(metrics.rmssd_ms, 15.546, 0.002);
  approx(metrics.sdnn_ms, 8.539, 0.002);
  assert.equal(metrics.pnn20, 0);
});

test("rejects implausible and ectopic RR intervals", () => {
  const filtered = filterRrIntervals([800, 810, 250, 2500, 812, 1300]);

  assert.deepEqual(filtered.accepted, [800, 810, 812]);
  assert.equal(filtered.rejectedCount, 3);
  assert.equal(filtered.artifactRate, 0.5);
});

test("marks HRV window low quality when RR count is too small", () => {
  const summary = summarizePhysiologyMeasurements(measurementsFromRr([800, 805, 795], 74));

  assert.equal(summary.physiology_quality, "low");
  assert.equal(summary.physiology_arousal, null);
});

test("normalizes arousal against personal baseline", () => {
  const baselineRr = Array.from({ length: 40 }, (_, index) => (index % 2 ? 840 : 800));
  const baseline = createPhysiologyBaseline(measurementsFromRr(baselineRr, 73));
  const activeRr = Array.from({ length: 40 }, (_, index) => 650 + (index % 2));
  const summary = summarizePhysiologyMeasurements(measurementsFromRr(activeRr, 94), baseline);

  assert.equal(summary.physiology_quality, "good");
  assert.ok(summary.z_hr > 4);
  assert.ok(summary.z_rmssd > 4);
  assert.ok(summary.physiology_arousal > 0.85);
});

test("arousal uses HR and RMSSD only, with SDNN still reported", () => {
  const baseline = {
    hr_mad: 10,
    median_hr_bpm: 70,
    median_rmssd_ms: 30,
    median_sdnn_ms: 20,
    rmssd_mad: 10,
    sdnn_mad: 10,
  };
  const rr = Array.from({ length: 40 }, (_, index) => (index % 2 ? 710 : 690));
  const summary = summarizePhysiologyMeasurements(measurementsFromRr(rr, 80), baseline);
  const expected = 0.5 + (summary.z_hr + summary.z_rmssd) * PHYSIOLOGY_AROUSAL_WEIGHT;

  approx(summary.z_hr, 1);
  approx(summary.physiology_arousal, expected);
  // SDNN is still computed and logged for analysis, just not fed into arousal.
  assert.ok(Number.isFinite(summary.z_sdnn));
});

test("neutral face plus high HR and low HRV maps to tense", () => {
  const fused = fuseEmotionSignals(
    { confidence: 0.2, energy: 0.5, facePresent: true, tag: "relaxed", valence: 0.48 },
    { physiology_arousal: 0.88, physiology_quality: "good", rr_count: 40 },
  );

  assert.equal(fused.tag, "tense");
  assert.equal(fused.selectionSignalSource, "face_window_plus_ecg_arousal");
});

test("happy face plus high arousal maps to happy", () => {
  const fused = fuseEmotionSignals(
    { confidence: 0.8, energy: 0.5, facePresent: true, tag: "happy", valence: 0.9 },
    { physiology_arousal: 0.88, physiology_quality: "good", rr_count: 40 },
  );

  assert.equal(fused.tag, "happy");
});

test("usable HRV arousal is not averaged with happy face arousal", () => {
  const fused = fuseEmotionSignals(
    { confidence: 0.8, energy: 0.5, facePresent: true, tag: "happy", valence: 0.9 },
    { physiology_arousal: 0.24, physiology_quality: "good", rr_count: 40 },
  );

  assert.equal(fused.energy, 0.24);
  assert.equal(fused.tag, "relaxed");
});

test("HRV changes only the arousal axis and preserves face valence", () => {
  const face = { confidence: 0.8, energy: 0.5, facePresent: true, tag: "happy", valence: 0.82 };
  const lowArousal = fuseEmotionSignals(face, {
    physiology_arousal: 0.22,
    physiology_quality: "good",
    rr_count: 40,
  });
  const highArousal = fuseEmotionSignals(face, {
    physiology_arousal: 0.88,
    physiology_quality: "good",
    rr_count: 40,
  });

  assert.equal(lowArousal.valence, 0.82);
  assert.equal(highArousal.valence, 0.82);
  assert.equal(lowArousal.energy, 0.22);
  assert.equal(highArousal.energy, 0.88);
});

test("neutral or happy face plus low arousal maps to relaxed", () => {
  const fused = fuseEmotionSignals(
    { confidence: 0.5, energy: 0.5, facePresent: true, tag: "happy", valence: 0.82 },
    { physiology_arousal: 0.25, physiology_quality: "good", rr_count: 40 },
  );

  assert.equal(fused.tag, "relaxed");
});

test("sad face plus low arousal maps to sad_low", () => {
  const fused = fuseEmotionSignals(
    { confidence: 0.7, energy: 0.5, facePresent: true, tag: "sad_low", valence: 0.24 },
    { physiology_arousal: 0.3, physiology_quality: "good", rr_count: 40 },
  );

  assert.equal(fused.tag, "sad_low");
});

test("missing RR intervals do not drive HRV-based selection", () => {
  const summary = summarizePhysiologyMeasurements([
    { heartRateBpm: 92, rrIntervalsMs: [], timestamp: 1 },
  ]);
  const fused = fuseEmotionSignals(
    { confidence: 0.8, energy: 0.5, facePresent: true, tag: "happy", valence: 0.88 },
    summary,
  );

  assert.equal(summary.physiology_quality, "bpm_only");
  assert.equal(fused.selectionSignalSource, "window_average");
  assert.equal(fused.energy, 0.5);
  assert.equal(fused.tag, "happy");
});

test("missing face centers valence but ECG still drives arousal", () => {
  const fused = fuseEmotionSignals(
    { confidence: 0.8, energy: 0.5, facePresent: false, tag: "happy", valence: 0.88 },
    { physiology_arousal: 0.9, physiology_quality: "good", rr_count: 40 },
  );

  assert.equal(fused.facePresent, false);
  assert.equal(fused.valence, 0.5);
  assert.equal(fused.energy, 0.9);
  assert.equal(fused.selectionSignalSource, "ecg_arousal_only");
});

test("usable ECG drives arousal even with no face present", () => {
  const baseline = {
    hr_mad: 10,
    median_hr_bpm: 70,
    median_rmssd_ms: 30,
    median_sdnn_ms: 20,
    rmssd_mad: 10,
    sdnn_mad: 10,
  };
  // Elevated HR + reduced RMSSD → arousal clearly above 0.5.
  const rr = Array.from({ length: 40 }, (_, index) => (index % 2 ? 710 : 690));
  const summary = summarizePhysiologyMeasurements(measurementsFromRr(rr, 80), baseline);
  assert.equal(summary.physiology_quality, "good");
  assert.ok(summary.physiology_arousal > 0.5);

  const fused = fuseEmotionSignals({ facePresent: false }, summary);
  // Energy follows the ECG arousal, not the neutral 0.5 fallback.
  approx(fused.energy, summary.physiology_arousal);
  assert.equal(fused.selectionSignalSource, "ecg_arousal_only");
  assert.equal(fused.valence, 0.5);
});

test("ECG arousal moves below 0.5 when HR drops and HRV rises", () => {
  const baseline = {
    hr_mad: 10,
    median_hr_bpm: 70,
    median_rmssd_ms: 30,
    median_sdnn_ms: 20,
    rmssd_mad: 10,
    sdnn_mad: 10,
  };
  // Low HR + high RMSSD → arousal below 0.5.
  const rr = Array.from({ length: 40 }, (_, index) => (index % 2 ? 980 : 900));
  const summary = summarizePhysiologyMeasurements(measurementsFromRr(rr, 60), baseline);
  assert.equal(summary.physiology_quality, "good");
  assert.ok(summary.physiology_arousal < 0.5, `arousal was ${summary.physiology_arousal}`);

  const fused = fuseEmotionSignals({ facePresent: false }, summary);
  assert.ok(fused.energy < 0.5);
});

test("no face and no usable ECG falls back to neutral centre", () => {
  const fused = fuseEmotionSignals(
    { facePresent: false },
    summarizePhysiologyMeasurements([]),
  );
  assert.equal(fused.energy, 0.5);
  assert.equal(fused.valence, 0.5);
  assert.equal(fused.selectionSignalSource, "no_signal_center");
});
