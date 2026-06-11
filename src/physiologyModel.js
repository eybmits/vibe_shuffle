// 120 s neutral baseline: long enough for a stable RMSSD reference and to ride
// out the settling period, while staying practical for participants.
export const PHYSIOLOGY_BASELINE_SECONDS = 120;
export const PHYSIOLOGY_WINDOW_MS = 60_000;
export const MIN_HRV_RR_COUNT = 20;
export const VALID_RR_MIN_MS = 300;
export const VALID_RR_MAX_MS = 2000;
export const ECTOPIC_DELTA_RATIO = 0.3;
// Arousal is driven by HR (up) and RMSSD (down) only. SDNN needs ~5 min to be
// valid, so it is still logged but excluded from the short-window estimate.
export const PHYSIOLOGY_AROUSAL_WEIGHT = 0.22;
// How strongly head motion adds to arousal on top of a usable ECG.
export const ECG_MOTION_BOOST = 0.6;

const clamp = (value, min = 0, max = 1) => Math.min(Math.max(value, min), max);

const mean = (values) =>
  values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[midpoint]
    : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
};

const roundNullable = (value, digits = 3) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

function robustScale(values, floor) {
  const center = median(values);
  if (!Number.isFinite(center)) return floor;
  const deviations = values.map((value) => Math.abs(value - center));
  const mad = median(deviations);
  return Math.max((mad ?? 0) * 1.4826, floor);
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance =
    values.reduce((total, value) => total + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function rmssd(values) {
  if (values.length < 2) return null;
  const squaredDiffs = values.slice(1).map((value, index) => (value - values[index]) ** 2);
  return Math.sqrt(mean(squaredDiffs));
}

function pnn20(values) {
  if (values.length < 2) return null;
  const diffs = values.slice(1).map((value, index) => Math.abs(value - values[index]));
  return diffs.filter((diff) => diff > 20).length / diffs.length;
}

function toDataView(payload) {
  if (payload instanceof DataView) return payload;
  if (payload instanceof ArrayBuffer) return new DataView(payload);
  if (ArrayBuffer.isView(payload)) {
    return new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  }
  throw new TypeError("Heart-rate payload must be a DataView, ArrayBuffer, or typed array.");
}

export function parseHeartRateMeasurement(payload, timestamp = Date.now()) {
  const value = toDataView(payload);
  if (value.byteLength < 2) throw new Error("Heart-rate packet is too short.");

  const flags = value.getUint8(0);
  const heartRateIsUint16 = Boolean(flags & 0x01);
  const sensorContactSupported = Boolean(flags & 0x04);
  const energyExpendedPresent = Boolean(flags & 0x08);
  const rrPresent = Boolean(flags & 0x10);
  let offset = 1;

  const heartRateBpm = heartRateIsUint16
    ? value.getUint16(offset, true)
    : value.getUint8(offset);
  offset += heartRateIsUint16 ? 2 : 1;

  if (energyExpendedPresent) offset += 2;

  const rrIntervalsMs = [];
  if (rrPresent) {
    while (offset + 1 < value.byteLength) {
      rrIntervalsMs.push((value.getUint16(offset, true) / 1024) * 1000);
      offset += 2;
    }
  }

  return {
    heartRateBpm,
    rrIntervalsMs,
    sensorContactDetected: sensorContactSupported ? Boolean(flags & 0x02) : null,
    timestamp,
  };
}

export function filterRrIntervals(rrIntervalsMs) {
  const accepted = [];
  let rejectedCount = 0;

  rrIntervalsMs.forEach((rr) => {
    if (!Number.isFinite(rr) || rr < VALID_RR_MIN_MS || rr > VALID_RR_MAX_MS) {
      rejectedCount += 1;
      return;
    }

    const previous = accepted.at(-1);
    if (previous && Math.abs(rr - previous) / previous > ECTOPIC_DELTA_RATIO) {
      rejectedCount += 1;
      return;
    }

    accepted.push(rr);
  });

  return {
    accepted,
    artifactRate: rrIntervalsMs.length ? rejectedCount / rrIntervalsMs.length : 0,
    rejectedCount,
    totalCount: rrIntervalsMs.length,
  };
}

export function computeHrvMetrics(rrIntervalsMs, heartRateSamples = []) {
  const filtered = filterRrIntervals(rrIntervalsMs);
  const rr = filtered.accepted;
  const meanRrMs = mean(rr);
  const meanHeartRateFromRr = meanRrMs ? 60000 / meanRrMs : null;
  const meanHeartRateFromSamples = mean(heartRateSamples);

  return {
    artifact_rate: roundNullable(filtered.artifactRate),
    hr_bpm_mean: roundNullable(meanHeartRateFromSamples ?? meanHeartRateFromRr),
    mean_rr_ms: roundNullable(meanRrMs),
    pnn20: roundNullable(pnn20(rr)),
    rejected_rr_count: filtered.rejectedCount,
    rmssd_ms: roundNullable(rmssd(rr)),
    rr_count: rr.length,
    sdnn_ms: roundNullable(standardDeviation(rr)),
    total_rr_count: filtered.totalCount,
  };
}

function collectPhysiologyValues(measurements) {
  const heartRates = [];
  const rrIntervals = [];

  measurements.forEach((measurement) => {
    if (Number.isFinite(measurement?.heartRateBpm)) {
      heartRates.push(Number(measurement.heartRateBpm));
    }
    (measurement?.rrIntervalsMs ?? []).forEach((rr) => rrIntervals.push(Number(rr)));
  });

  return { heartRates, rrIntervals };
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index + size <= values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export function createPhysiologyBaseline(measurements) {
  const { heartRates, rrIntervals } = collectPhysiologyValues(measurements);
  const filtered = filterRrIntervals(rrIntervals);
  const rr = filtered.accepted;
  const metrics = computeHrvMetrics(rr, heartRates);
  const hrValues = heartRates.length ? heartRates : rr.map((interval) => 60000 / interval);
  const rrChunks = chunk(rr, MIN_HRV_RR_COUNT);
  const rmssdValues = rrChunks.map((items) => rmssd(items)).filter(Number.isFinite);
  const sdnnValues = rrChunks.map((items) => standardDeviation(items)).filter(Number.isFinite);

  return {
    artifact_rate: metrics.artifact_rate,
    created_at: new Date().toISOString(),
    hr_mad: roundNullable(robustScale(hrValues, 4)),
    median_hr_bpm: roundNullable(median(hrValues)),
    median_rmssd_ms: roundNullable(median(rmssdValues) ?? metrics.rmssd_ms),
    median_sdnn_ms: roundNullable(median(sdnnValues) ?? metrics.sdnn_ms),
    rmssd_mad: roundNullable(robustScale(rmssdValues.length ? rmssdValues : [metrics.rmssd_ms], 6)),
    rr_count: metrics.rr_count,
    sdnn_mad: roundNullable(robustScale(sdnnValues.length ? sdnnValues : [metrics.sdnn_ms], 6)),
  };
}

export function summarizePhysiologyMeasurements(
  measurements,
  baseline = null,
  fallbackSummary = null,
) {
  if (!measurements.length && fallbackSummary) return fallbackSummary;

  const { heartRates, rrIntervals } = collectPhysiologyValues(measurements);
  const metrics = computeHrvMetrics(rrIntervals, heartRates);
  const hasHeartRate = Number.isFinite(metrics.hr_bpm_mean);
  const hasUsableHrv = metrics.rr_count >= MIN_HRV_RR_COUNT;
  const quality = !hasHeartRate
    ? "inactive"
    : !metrics.rr_count
      ? "bpm_only"
      : hasUsableHrv
        ? "good"
        : "low";

  const zHr =
    baseline && Number.isFinite(metrics.hr_bpm_mean)
      ? (metrics.hr_bpm_mean - baseline.median_hr_bpm) / baseline.hr_mad
      : null;
  const zRmssd =
    baseline && Number.isFinite(metrics.rmssd_ms)
      ? (baseline.median_rmssd_ms - metrics.rmssd_ms) / baseline.rmssd_mad
      : null;
  const zSdnn =
    baseline && Number.isFinite(metrics.sdnn_ms)
      ? (baseline.median_sdnn_ms - metrics.sdnn_ms) / baseline.sdnn_mad
      : null;
  const physiologyArousal =
    quality === "good" && baseline
      ? clamp(0.5 + ((zHr ?? 0) + (zRmssd ?? 0)) * PHYSIOLOGY_AROUSAL_WEIGHT)
      : null;

  return {
    ...metrics,
    baseline_hr_bpm: baseline?.median_hr_bpm ?? null,
    baseline_rmssd_ms: baseline?.median_rmssd_ms ?? null,
    ecg_connected: hasHeartRate,
    physiology_arousal: roundNullable(physiologyArousal),
    physiology_quality: quality,
    z_hr: roundNullable(zHr),
    z_rmssd: roundNullable(zRmssd),
    z_sdnn: roundNullable(zSdnn),
  };
}

function quadrantFromAxes(valence, energy) {
  if (valence >= 0.5 && energy >= 0.5) return "happy";
  if (valence >= 0.5 && energy < 0.5) return "relaxed";
  if (valence < 0.5 && energy >= 0.5) return "tense";
  return "sad_low";
}

export function fuseEmotionSignals(faceSummary, physiologySummary) {
  const physiologyUsable =
    physiologySummary?.physiology_quality === "good" &&
    Number.isFinite(physiologySummary?.physiology_arousal);
  const facePresent = Boolean(faceSummary?.facePresent);
  const faceTag = faceSummary?.tag ?? "relaxed";
  const faceConfidence = Number(faceSummary?.confidence ?? 0);
  const physiologyArousal = physiologySummary?.physiology_arousal;

  // ECG owns the arousal axis and works independently of the camera: even with
  // no face, a usable ECG still drives energy up AND down. Only fall back to
  // the neutral centre when there is neither a face nor a usable ECG.
  if (!facePresent && !physiologyUsable) {
    return {
      confidence: 0,
      energy: 0.5,
      facePresent: false,
      physiologyArousal: physiologyArousal ?? null,
      physiologyQuality: physiologySummary?.physiology_quality ?? "inactive",
      selectionSignalSource: "no_signal_center",
      tag: "relaxed",
      valence: 0.5,
    };
  }

  // Face provides valence; without a face, valence stays neutral.
  const valence = facePresent ? clamp(Number(faceSummary?.valence ?? 0.5)) : 0.5;
  // Arousal: a usable ECG sets the base (both directions). Head motion (the
  // part of face energy above the neutral 0.5) adds on top — moving along with
  // the music raises arousal even when the ECG is connected. Without a usable
  // ECG, the face/motion channel carries arousal alone.
  const motionBoost = facePresent ? Math.max(0, Number(faceSummary?.energy ?? 0.5) - 0.5) : 0;
  const energy = physiologyUsable
    ? clamp(physiologyArousal + motionBoost * ECG_MOTION_BOOST)
    : clamp(Number(faceSummary?.energy ?? 0.5));
  const tag = physiologyUsable ? quadrantFromAxes(valence, energy) : faceTag;

  const selectionSignalSource = physiologyUsable
    ? facePresent
      ? "face_window_plus_ecg_arousal"
      : "ecg_arousal_only"
    : "window_average";

  return {
    confidence: physiologyUsable
      ? clamp(((facePresent ? faceConfidence : 0) + Math.min(1, physiologySummary.rr_count / 40)) / 2)
      : faceConfidence,
    energy,
    facePresent,
    physiologyArousal: physiologyArousal ?? null,
    physiologyQuality: physiologySummary?.physiology_quality ?? "inactive",
    selectionSignalSource,
    tag,
    valence,
  };
}
