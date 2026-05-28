import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Camera,
  CheckCircle2,
  Clock3,
  Download,
  Gauge,
  Headphones,
  HeartPulse,
  Lock,
  Music2,
  Pause,
  Play,
  Radio,
  RotateCcw,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Waves,
} from "lucide-react";
import musicCatalog from "./data/musicCatalog.json";
import {
  FACE_BASELINE_FRAMES,
  FACE_SAMPLE_INTERVAL_MS,
  createExpressionTrackerState,
  initialExpressionScores,
  summarizeExpressionSamples,
  updateExpressionTracker,
} from "./expressionModel.js";
import {
  PHYSIOLOGY_BASELINE_SECONDS,
  PHYSIOLOGY_WINDOW_MS,
  createPhysiologyBaseline,
  fuseEmotionSignals,
  parseHeartRateMeasurement,
  summarizePhysiologyMeasurements,
} from "./physiologyModel.js";

const TRACKS_PER_BLOCK = 5;
const LISTENING_WINDOW_SECONDS = 18;
const MEDIAPIPE_VERSION = "0.10.35";

const SPOTIFY_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? "";
const SPOTIFY_REDIRECT_URI =
  import.meta.env.VITE_SPOTIFY_REDIRECT_URI ??
  (typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}` : "");

const RATING_LABELS = {
  1: "Not at all",
  2: "Slightly",
  3: "Good match",
  4: "Very good",
};

const RATING_OPTIONS = [
  {
    description: "Did not fit my mood.",
    label: RATING_LABELS[1],
    score: 1,
  },
  {
    description: "Some parts fit.",
    label: RATING_LABELS[2],
    score: 2,
  },
  {
    description: "Mostly fit my mood.",
    label: RATING_LABELS[3],
    score: 3,
  },
  {
    description: "Matched very well.",
    label: RATING_LABELS[4],
    score: 4,
  },
];

const PROTOCOL_BLOCKS = [{ mode: "random" }, { mode: "vibe" }];

const SESSION_MODES = ["Deep Work", "Recharge", "Destress", "Unwind"];

const EMOTION_QUADRANTS = {
  happy: {
    label: "Happy",
    tag: "happy",
    accent: "#22c55e",
    valence: 0.82,
    energy: 0.78,
    description: "High valence, high arousal",
  },
  relaxed: {
    label: "Relaxed",
    tag: "relaxed",
    accent: "#14b8a6",
    valence: 0.72,
    energy: 0.28,
    description: "High valence, low arousal",
  },
  tense: {
    label: "Tense",
    tag: "tense",
    accent: "#f97316",
    valence: 0.28,
    energy: 0.74,
    description: "Low valence, high arousal",
  },
  sad_low: {
    label: "Sad-low",
    tag: "sad_low",
    accent: "#818cf8",
    valence: 0.3,
    energy: 0.26,
    description: "Low valence, low arousal",
  },
};

const FALLBACK_PALETTE = ["#f8fafc", "#dbeafe", "#0f766e"];

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function getCatalogTracks() {
  if (Array.isArray(musicCatalog)) return musicCatalog;
  return musicCatalog.tracks ?? [];
}

function normalizeSong(song, index) {
  const quadrant =
    song.quadrant in EMOTION_QUADRANTS
      ? song.quadrant
      : quadrantFromAxes(song.valence, song.energy);
  const style = EMOTION_QUADRANTS[quadrant] ?? EMOTION_QUADRANTS.relaxed;

  return {
    id: song.id ?? song.spotifyId ?? `track-${index}`,
    jamendoId: song.jamendoId ?? null,
    spotifyId: song.spotifyId ?? null,
    spotifyUri: song.spotifyUri ?? null,
    title: song.title ?? "Untitled track",
    artist: song.artist ?? "Unknown artist",
    album: song.album ?? "",
    albumImageUrl: song.albumImageUrl ?? null,
    audioUrl: song.audioUrl ?? song.previewUrl ?? null,
    downloadUrl: song.downloadUrl ?? null,
    externalUrl: song.externalUrl ?? null,
    licenseUrl: song.licenseUrl ?? null,
    durationMs: song.durationMs ?? null,
    valence: Number(song.valence ?? style.valence),
    energy: Number(song.energy ?? style.energy),
    instrumentalness: Number(song.instrumentalness ?? 0),
    speechiness: Number(song.speechiness ?? 0),
    danceability: Number(song.danceability ?? 0),
    tempo: Number(song.tempo ?? 0),
    quadrant,
    accent: song.accent ?? style.accent,
    palette: song.palette ?? FALLBACK_PALETTE,
    analysisConfidence: Number(song.analysisConfidence ?? 0),
    categorySource: song.categorySource ?? null,
    source: song.source ?? null,
  };
}

function quadrantFromAxes(valence, energy) {
  if (valence >= 0.5 && energy >= 0.5) return "happy";
  if (valence >= 0.5 && energy < 0.5) return "relaxed";
  if (valence < 0.5 && energy >= 0.5) return "tense";
  return "sad_low";
}

function createProtocolId() {
  const compactTimestamp = new Date()
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replaceAll(".", "")
    .replaceAll("T", "")
    .replaceAll("Z", "")
    .slice(0, 14);

  return `VS-${compactTimestamp}`;
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function ratingsToCsv(ratings) {
  const columns = [
    "protocol_id",
    "timestamp",
    "block_number",
    "block_mode",
    "track_number",
    "song_id",
    "song_source",
    "jamendo_id",
    "spotify_id",
    "spotify_uri",
    "song_title",
    "artist",
    "album",
    "song_quadrant",
    "song_valence",
    "song_arousal",
    "song_instrumentalness",
    "song_speechiness",
    "song_category_source",
    "song_analysis_confidence",
    "song_external_url",
    "song_license_url",
    "detected_expression",
    "detected_expression_label",
    "detected_valence",
    "detected_arousal",
    "expression_confidence",
    "face_present",
    "window_expression",
    "window_expression_confidence",
    "window_sample_count",
    "mean_happy",
    "mean_relaxed",
    "mean_tense",
    "mean_sad_low",
    "ecg_connected",
    "physiology_quality",
    "hr_bpm_mean",
    "rr_count",
    "rr_artifact_rate",
    "rmssd_ms",
    "sdnn_ms",
    "pnn20",
    "baseline_hr_bpm",
    "baseline_rmssd_ms",
    "z_hr",
    "z_rmssd",
    "z_sdnn",
    "physiology_arousal",
    "fusion_valence",
    "fusion_arousal",
    "selection_signal_source",
    "rating_1_to_4",
  ];

  const rows = ratings.map((rating) =>
    columns.map((column) => csvEscape(rating[column])).join(","),
  );

  return [columns.join(","), ...rows].join("\n");
}

function downloadCsv(ratings, protocolId) {
  if (!ratings.length) return;

  const blob = new Blob([ratingsToCsv(ratings)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${protocolId}_vibe_shuffle_validation.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatSeconds(seconds) {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  return `0:${String(safeSeconds).padStart(2, "0")}`;
}

function createSmoothPath(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  return points
    .map((point, index) => {
      if (index === 0) return `M ${point.x} ${point.y}`;
      const previous = points[index - 1];
      const controlX = (previous.x + point.x) / 2;
      return `C ${controlX} ${previous.y}, ${controlX} ${point.y}, ${point.x} ${point.y}`;
    })
    .join(" ");
}

function buildHeartRateCurve(samples, width = 320, height = 112) {
  const heartRates = samples
    .map((sample) => Number(sample.heartRateBpm))
    .filter((value) => Number.isFinite(value));
  const values = heartRates.length ? heartRates : [66, 67, 66, 68, 67, 69, 68, 70, 69, 70];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const paddedMin = min - 4;
  const paddedMax = max + 4;
  const range = Math.max(1, paddedMax - paddedMin);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((value, index) => ({
    value,
    x: Number((index * step).toFixed(2)),
    y: Number((height - ((value - paddedMin) / range) * height).toFixed(2)),
  }));

  return {
    areaPath: `${createSmoothPath(points)} L ${width} ${height} L 0 ${height} Z`,
    current: values.at(-1),
    max,
    min,
    path: createSmoothPath(points),
    points,
  };
}

function ProgressRing({ value, label }) {
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamp(value, 0, 100) / 100);

  return (
    <div className="relative size-28">
      <svg aria-hidden="true" className="size-full -rotate-90" viewBox="0 0 112 112">
        <circle cx="56" cy="56" fill="none" r={radius} stroke="rgba(255,255,255,0.12)" strokeWidth="9" />
        <circle
          cx="56"
          cy="56"
          fill="none"
          r={radius}
          stroke="url(#sessionProgressGradient)"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          strokeWidth="9"
        />
        <defs>
          <linearGradient id="sessionProgressGradient" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#14b8a6" />
            <stop offset="100%" stopColor="#f97316" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-xl font-semibold tracking-tight text-white">{Math.round(value)}%</span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8ca3b8]">
          {label}
        </span>
      </div>
    </div>
  );
}

function deterministicScore(id, seed) {
  let hash = seed * 97;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 9973;
  }
  return hash / 9973;
}

function rankSongs(songs, mode, mood, currentSongId, seed, recentIds) {
  const available = songs.filter((song) => song.id !== currentSongId);
  const vibePool = available.filter((song) => song.quadrant === mood.tag);
  const pool = mode === "vibe" && vibePool.length ? vibePool : available;

  return pool
    .map((song) => {
      const recentPenalty = recentIds.includes(song.id) ? 0.22 : 0;
      const distance = Math.hypot(song.valence - mood.valence, song.energy - mood.energy);
      const randomScore = deterministicScore(song.id, seed);
      const vibeScore = distance + recentPenalty + randomScore * 0.04;

      return {
        ...song,
        score: mode === "vibe" ? vibeScore : randomScore + recentPenalty,
        fit: Math.round(clamp(1 - distance, 0, 1) * 100),
      };
    })
    .sort((a, b) => a.score - b.score);
}

function expressionStateToMood(expressionState) {
  const tag =
    expressionState?.tag && expressionState.tag in EMOTION_QUADRANTS
      ? expressionState.tag
      : "relaxed";
  const style = EMOTION_QUADRANTS[tag];

  return {
    ...style,
    confidence: Number(expressionState?.confidence ?? 0),
    energy: Number(expressionState?.energy ?? style.energy),
    facePresent: Boolean(expressionState?.facePresent),
    sampleCount: Number(expressionState?.sampleCount ?? 0),
    scores: expressionState?.scores ?? initialExpressionScores(),
    valence: Number(expressionState?.valence ?? style.valence),
  };
}

function signalStateToMood(signalState) {
  return expressionStateToMood({
    confidence: signalState?.confidence ?? 0,
    energy: signalState?.energy,
    facePresent: true,
    scores: signalState?.scores ?? initialExpressionScores(),
    tag: signalState?.tag,
    valence: signalState?.valence,
  });
}

function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(length = 64) {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (value) => possible[value % possible.length]).join("");
}

async function createCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(digest);
}

function readStoredToken() {
  try {
    const raw = localStorage.getItem("vibe_shuffle_spotify_token");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStoredToken(tokenPayload) {
  localStorage.setItem("vibe_shuffle_spotify_token", JSON.stringify(tokenPayload));
}

function useSpotifyAuth() {
  const [token, setToken] = useState(() => readStoredToken());
  const [status, setStatus] = useState(token ? "authenticated" : "idle");
  const [error, setError] = useState("");
  const tokenRef = useRef(token);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const saveToken = useCallback((payload) => {
    const nextToken = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? tokenRef.current?.refreshToken ?? null,
      expiresAt: Date.now() + Number(payload.expires_in ?? 3600) * 1000,
    };
    writeStoredToken(nextToken);
    setToken(nextToken);
    setStatus("authenticated");
    setError("");
    return nextToken;
  }, []);

  const refreshToken = useCallback(async () => {
    const current = tokenRef.current;
    if (!current?.refreshToken || !SPOTIFY_CLIENT_ID) return current?.accessToken ?? null;

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: SPOTIFY_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: current.refreshToken,
      }),
    });

    if (!response.ok) {
      setError("Spotify session expired. Please connect again.");
      setStatus("idle");
      localStorage.removeItem("vibe_shuffle_spotify_token");
      setToken(null);
      return null;
    }

    const payload = await response.json();
    return saveToken(payload).accessToken;
  }, [saveToken]);

  const ensureToken = useCallback(async () => {
    const current = tokenRef.current;
    if (!current) return null;
    if (current.expiresAt - Date.now() > 60000) return current.accessToken;
    return refreshToken();
  }, [refreshToken]);

  const connect = useCallback(async () => {
    if (!SPOTIFY_CLIENT_ID) {
      setError("Missing VITE_SPOTIFY_CLIENT_ID.");
      return;
    }

    const verifier = randomString();
    const state = randomString(24);
    const challenge = await createCodeChallenge(verifier);
    localStorage.setItem("vibe_shuffle_spotify_verifier", verifier);
    localStorage.setItem("vibe_shuffle_spotify_state", state);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: SPOTIFY_CLIENT_ID,
      scope: [
        "streaming",
        "user-read-email",
        "user-read-private",
        "user-read-playback-state",
        "user-modify-playback-state",
      ].join(" "),
      redirect_uri: SPOTIFY_REDIRECT_URI,
      state,
      code_challenge_method: "S256",
      code_challenge: challenge,
    });

    window.location.assign(`https://accounts.spotify.com/authorize?${params.toString()}`);
  }, []);

  const disconnect = useCallback(() => {
    localStorage.removeItem("vibe_shuffle_spotify_token");
    setToken(null);
    setStatus("idle");
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const storedState = localStorage.getItem("vibe_shuffle_spotify_state");
    const verifier = localStorage.getItem("vibe_shuffle_spotify_verifier");

    if (!code) return;

    window.history.replaceState({}, document.title, SPOTIFY_REDIRECT_URI);

    if (!verifier || state !== storedState) {
      setError("Spotify login state could not be verified.");
      return;
    }

    setStatus("loading");
    fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: SPOTIFY_CLIENT_ID,
        grant_type: "authorization_code",
        code,
        redirect_uri: SPOTIFY_REDIRECT_URI,
        code_verifier: verifier,
      }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return response.json();
      })
      .then((payload) => {
        localStorage.removeItem("vibe_shuffle_spotify_verifier");
        localStorage.removeItem("vibe_shuffle_spotify_state");
        saveToken(payload);
      })
      .catch(() => {
        setStatus("idle");
        setError("Spotify login failed. Check the redirect URI and app settings.");
      });
  }, [saveToken]);

  return {
    accessToken: token?.accessToken ?? null,
    authenticated: Boolean(token?.accessToken),
    connect,
    disconnect,
    ensureToken,
    error,
    status,
  };
}

function loadSpotifySdk() {
  if (window.Spotify) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.querySelector("script[src='https://sdk.scdn.co/spotify-player.js']");
    window.onSpotifyWebPlaybackSDKReady = () => resolve();

    if (existing) return;

    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    script.onerror = () => reject(new Error("Spotify SDK failed to load."));
    document.body.append(script);
  });
}

function useSpotifyPlayer(accessToken, ensureToken) {
  const playerRef = useRef(null);
  const [state, setState] = useState({
    deviceId: null,
    error: "",
    ready: false,
    status: accessToken ? "loading" : "idle",
  });

  useEffect(() => {
    if (!accessToken || playerRef.current) return undefined;

    let cancelled = false;

    async function connectPlayer() {
      try {
        setState((current) => ({ ...current, status: "loading", error: "" }));
        await loadSpotifySdk();
        if (cancelled) return;

        const player = new window.Spotify.Player({
          name: "Vibe Shuffle Validation",
          getOAuthToken: async (callback) => {
            const token = await ensureToken();
            if (token) callback(token);
          },
          volume: 0.78,
        });

        player.addListener("ready", ({ device_id: deviceId }) => {
          setState({ deviceId, error: "", ready: true, status: "ready" });
        });
        player.addListener("not_ready", () => {
          setState((current) => ({ ...current, ready: false, status: "idle" }));
        });
        player.addListener("initialization_error", ({ message }) => {
          setState((current) => ({ ...current, error: message, status: "error" }));
        });
        player.addListener("authentication_error", ({ message }) => {
          setState((current) => ({ ...current, error: message, status: "error" }));
        });
        player.addListener("account_error", ({ message }) => {
          setState((current) => ({
            ...current,
            error: message || "Spotify Premium is required for web playback.",
            status: "error",
          }));
        });
        player.addListener("playback_error", ({ message }) => {
          setState((current) => ({ ...current, error: message, status: "error" }));
        });

        playerRef.current = player;
        await player.connect();
      } catch (error) {
        setState((current) => ({
          ...current,
          error: error.message ?? "Spotify playback failed to initialize.",
          status: "error",
        }));
      }
    }

    connectPlayer();

    return () => {
      cancelled = true;
    };
  }, [accessToken, ensureToken]);

  const playTrack = useCallback(
    async (spotifyUri) => {
      if (!spotifyUri || !state.deviceId) return false;
      const token = await ensureToken();
      if (!token) return false;

      const response = await fetch(
        `https://api.spotify.com/v1/me/player/play?device_id=${state.deviceId}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ uris: [spotifyUri] }),
        },
      );

      if (!response.ok) {
        const message =
          response.status === 404
            ? "Spotify playback device is not active yet."
            : "Spotify could not start this track.";
        setState((current) => ({ ...current, error: message }));
        return false;
      }

      setState((current) => ({ ...current, error: "" }));
      return true;
    },
    [ensureToken, state.deviceId],
  );

  const pause = useCallback(async () => {
    try {
      await playerRef.current?.pause();
    } catch {
      setState((current) => ({ ...current, error: "Spotify could not pause playback." }));
    }
  }, []);

  const resume = useCallback(async () => {
    try {
      await playerRef.current?.resume();
    } catch {
      setState((current) => ({ ...current, error: "Spotify could not resume playback." }));
    }
  }, []);

  return {
    ...state,
    pause,
    playTrack,
    resume,
  };
}

function useDemoAudio() {
  const contextRef = useRef(null);
  const nodesRef = useRef(null);
  const audioRef = useRef(null);
  const [error, setError] = useState("");

  const ensureContext = useCallback(async () => {
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) {
      setError("This browser does not support Web Audio playback.");
      return null;
    }

    if (!contextRef.current) {
      contextRef.current = new AudioContextClass();
    }

    if (contextRef.current.state === "suspended") {
      await contextRef.current.resume();
    }

    return contextRef.current;
  }, []);

  const stop = useCallback((fadeSeconds = 0.16) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current.load();
      audioRef.current = null;
    }

    const context = contextRef.current;
    const nodes = nodesRef.current;
    if (!context || !nodes) return;

    const now = context.currentTime;
    nodes.master.gain.cancelScheduledValues(now);
    nodes.master.gain.setValueAtTime(nodes.master.gain.value, now);
    nodes.master.gain.linearRampToValueAtTime(0, now + fadeSeconds);
    nodes.oscillators.forEach((oscillator) => {
      try {
        oscillator.stop(now + fadeSeconds + 0.04);
      } catch {
        // Oscillators can only be stopped once.
      }
    });
    nodesRef.current = null;
  }, []);

  const playSong = useCallback(
    async (song) => {
      if (song.audioUrl) {
        stop(0);

        const audio = new Audio(song.audioUrl);
        audio.loop = true;
        audio.preload = "auto";
        audio.volume = 0.78;
        audioRef.current = audio;

        try {
          await audio.play();
          setError("");
          return true;
        } catch {
          audioRef.current = null;
          setError("Browser blocked the instrumental audio. Press play once to resume it.");
          return false;
        }
      }

      const context = await ensureContext();
      if (!context) return false;

      stop(0.08);

      const now = context.currentTime;
      const baseFrequency = 138 + song.valence * 140 + song.energy * 130;
      const interval = song.valence >= 0.5 ? 1.5 : 1.2;
      const master = context.createGain();
      const filter = context.createBiquadFilter();
      const primary = context.createOscillator();
      const harmony = context.createOscillator();
      const low = context.createOscillator();
      const primaryGain = context.createGain();
      const harmonyGain = context.createGain();
      const lowGain = context.createGain();
      const lfo = context.createOscillator();
      const lfoGain = context.createGain();

      filter.type = song.energy >= 0.5 ? "bandpass" : "lowpass";
      filter.frequency.value = 520 + song.energy * 1800;
      filter.Q.value = 0.8 + song.instrumentalness * 1.6;

      primary.type = song.energy >= 0.62 ? "triangle" : "sine";
      harmony.type = song.quadrant === "tense" ? "sawtooth" : "sine";
      low.type = "sine";
      primary.frequency.value = baseFrequency;
      harmony.frequency.value = baseFrequency * interval;
      low.frequency.value = baseFrequency / 2;

      primaryGain.gain.value = 0.045 + song.energy * 0.03;
      harmonyGain.gain.value = 0.026 + song.valence * 0.024;
      lowGain.gain.value = 0.025;
      master.gain.value = 0;

      lfo.frequency.value = 0.12 + song.energy * 0.62;
      lfoGain.gain.value = 18 + song.energy * 48;
      lfo.connect(lfoGain).connect(filter.frequency);

      primary.connect(primaryGain).connect(filter);
      harmony.connect(harmonyGain).connect(filter);
      low.connect(lowGain).connect(filter);
      filter.connect(master).connect(context.destination);

      [primary, harmony, low, lfo].forEach((oscillator) => oscillator.start(now));
      master.gain.linearRampToValueAtTime(0.42, now + 0.6);

      nodesRef.current = {
        master,
        oscillators: [primary, harmony, low, lfo],
      };
      setError("");
      return true;
    },
    [ensureContext, stop],
  );

  const pause = useCallback(async () => {
    try {
      if (audioRef.current) {
        audioRef.current.pause();
        return;
      }

      await contextRef.current?.suspend();
    } catch {
      setError("Demo playback could not be paused.");
    }
  }, []);

  const resume = useCallback(async () => {
    try {
      if (audioRef.current) {
        await audioRef.current.play();
        return true;
      }

      await contextRef.current?.resume();
      return true;
    } catch {
      setError("Demo playback could not be resumed.");
      return false;
    }
  }, []);

  useEffect(
    () => () => {
      stop(0);
      contextRef.current?.close?.();
    },
    [stop],
  );

  return {
    error,
    pause,
    playSong,
    resume,
    stop,
  };
}

function cameraErrorMessage(error) {
  if (!navigator.mediaDevices?.getUserMedia) {
    return "Camera API is not available. Use current Chrome, Edge, Safari, or Firefox over HTTPS.";
  }

  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "Camera access needs HTTPS or localhost.";
  }

  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return "Camera permission was blocked. Allow camera access in the browser settings and reload.";
  }

  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
    return "No webcam was found. Connect a camera and try again.";
  }

  if (error?.name === "NotReadableError" || error?.name === "TrackStartError") {
    return "The camera is already in use by another app. Close video-call apps and try again.";
  }

  if (error?.name === "OverconstrainedError" || error?.name === "ConstraintNotSatisfiedError") {
    return "This webcam rejected the requested settings. Trying a simpler camera mode failed too.";
  }

  return "Camera expression detection could not start on this browser.";
}

async function getCameraStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new DOMException("mediaDevices.getUserMedia is unavailable.", "NotSupportedError");
  }

  const attempts = [
    {
      audio: false,
      video: {
        facingMode: { ideal: "user" },
        height: { ideal: 480 },
        width: { ideal: 640 },
      },
    },
    {
      audio: false,
      video: {
        height: { ideal: 480 },
        width: { ideal: 640 },
      },
    },
    {
      audio: false,
      video: true,
    },
  ];
  let lastError = null;

  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
      if (error?.name === "NotAllowedError" || error?.name === "SecurityError") throw error;
    }
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = devices.filter((device) => device.kind === "videoinput");

    for (const device of videoInputs) {
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            deviceId: { exact: device.deviceId },
            height: { ideal: 480 },
            width: { ideal: 640 },
          },
        });
      } catch (error) {
        lastError = error;
      }
    }
  } catch (error) {
    lastError = error;
  }

  throw lastError ?? new DOMException("No usable camera stream.", "NotFoundError");
}

function useFaceExpression() {
  const videoRef = useRef(null);
  const landmarkerRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(null);
  const trackerRef = useRef(createExpressionTrackerState());
  const lastUpdateRef = useRef(0);
  const sampleIdRef = useRef(0);
  const relaxedMood = expressionStateToMood({
    confidence: 0,
    facePresent: false,
    scores: initialExpressionScores(),
    tag: "relaxed",
  });
  const [state, setState] = useState({
    ...relaxedMood,
    error: "",
    sample: null,
    sampleId: 0,
    status: "idle",
  });

  const detect = useCallback(() => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;

    if (video && landmarker && video.readyState >= 2) {
      const now = performance.now();
      if (now - lastUpdateRef.current > FACE_SAMPLE_INTERVAL_MS) {
        lastUpdateRef.current = now;
        const result = landmarker.detectForVideo(video, now);
        const categories = result.faceBlendshapes?.[0]?.categories ?? null;

        if (categories?.length) {
          const update = updateExpressionTracker(trackerRef.current, categories);
          trackerRef.current = update.tracker;

          if (update.status === "calibrating") {
            setState((current) => ({
              ...expressionStateToMood(update.expression),
              confidence: trackerRef.current.baseline.samples / FACE_BASELINE_FRAMES,
              error: "",
              sample: null,
              sampleId: current.sampleId,
              status: "calibrating",
            }));
            frameRef.current = window.requestAnimationFrame(detect);
            return;
          }

          sampleIdRef.current += 1;
          setState({
            ...expressionStateToMood(update.expression),
            error: "",
            sample: update.sample,
            sampleId: sampleIdRef.current,
            status: "ready",
          });
        } else {
          setState((current) => ({
            ...current,
            confidence: current.confidence,
            error: "",
            facePresent: false,
            status: "searching",
          }));
        }
      }
    }

    frameRef.current = window.requestAnimationFrame(detect);
  }, []);

  const start = useCallback(async () => {
    if (streamRef.current || landmarkerRef.current) return;

    try {
      trackerRef.current = createExpressionTrackerState();
      sampleIdRef.current = 0;
      setState((current) => ({
        ...expressionStateToMood({
          confidence: 0,
          facePresent: false,
          scores: initialExpressionScores(),
          tag: "relaxed",
        }),
        error: "",
        sample: null,
        sampleId: 0,
        status: "loading",
      }));

      const stream = await getCameraStream();

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const vision = await FilesetResolver.forVisionTasks(
        `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`,
      );

      try {
        landmarkerRef.current = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            delegate: "GPU",
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
          },
          numFaces: 1,
          outputFaceBlendshapes: true,
          runningMode: "VIDEO",
        });
      } catch {
        landmarkerRef.current = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
          },
          numFaces: 1,
          outputFaceBlendshapes: true,
          runningMode: "VIDEO",
        });
      }

      setState((current) => ({ ...current, error: "", status: "ready" }));
      frameRef.current = window.requestAnimationFrame(detect);
    } catch (error) {
      setState((current) => ({
        ...current,
        error: cameraErrorMessage(error),
        status: "error",
      }));
    }
  }, [detect]);

  const stop = useCallback(() => {
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    landmarkerRef.current?.close?.();
    frameRef.current = null;
    streamRef.current = null;
    landmarkerRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  return {
    ...state,
    start,
    videoRef,
  };
}

function createMockHeartRateMeasurement(index) {
  const phase = index / 6;
  const heartRateBpm = Math.round(73 + Math.sin(phase) * 3 + Math.sin(index / 17) * 2);
  const baseRr = 60000 / heartRateBpm;
  const rrIntervalsMs = [baseRr + Math.sin(index / 3) * 22, baseRr - Math.cos(index / 4) * 18];

  return {
    heartRateBpm,
    rrIntervalsMs,
    timestamp: Date.now(),
  };
}

function createMockBaselineMeasurements() {
  return Array.from({ length: 80 }, (_, index) => {
    const rr = 820 + (index % 2 ? 32 : -28) + Math.sin(index / 5) * 12;
    return {
      heartRateBpm: Math.round(60000 / rr),
      rrIntervalsMs: [rr],
      timestamp: Date.now() - (80 - index) * 820,
    };
  });
}

function physiologyQualityMessage(summary) {
  if (!summary?.ecg_connected || summary.physiology_quality === "inactive") {
    return "No live heart-rate packets received yet.";
  }

  if (summary.physiology_quality === "bpm_only") {
    return "Receiving HR, but no RR intervals. HRV needs RR intervals from the sensor.";
  }

  if (summary.physiology_quality === "low") {
    return `Baseline not good enough: ${summary.rr_count}/20 valid RR intervals. Keep the strap on and wait for more RR data.`;
  }

  return "";
}

function usePhysiologySensor() {
  const deviceRef = useRef(null);
  const characteristicRef = useRef(null);
  const measurementsRef = useRef([]);
  const baselineMeasurementsRef = useRef([]);
  const baselineStartRef = useRef(null);
  const sampleIdRef = useRef(0);
  const mockIntervalRef = useRef(null);
  const mockIndexRef = useRef(0);
  const [state, setState] = useState(() => {
    const emptySummary = summarizePhysiologyMeasurements([]);

    return {
      baseline: null,
      baselineProgress: 0,
      connected: false,
      currentSummary: emptySummary,
      error: "",
      baselineIssue: "",
      heartRateHistory: [],
      latestHeartRate: null,
      latestSensorContact: null,
      notificationCount: 0,
      sample: null,
      sampleId: 0,
      source: "none",
      status: "idle",
    };
  });

  const stopMock = useCallback(() => {
    if (mockIntervalRef.current) {
      window.clearInterval(mockIntervalRef.current);
      mockIntervalRef.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    stopMock();
    if (characteristicRef.current?.__vibeShuffleHandler) {
      characteristicRef.current.removeEventListener(
        "characteristicvaluechanged",
        characteristicRef.current.__vibeShuffleHandler,
      );
    }
    try {
      deviceRef.current?.gatt?.disconnect?.();
    } catch {
      // Some browsers throw if the device is already disconnected.
    }
    deviceRef.current = null;
    characteristicRef.current = null;
    measurementsRef.current = [];
    baselineMeasurementsRef.current = [];
    baselineStartRef.current = null;
    sampleIdRef.current = 0;
    setState({
      baseline: null,
      baselineProgress: 0,
      connected: false,
      currentSummary: summarizePhysiologyMeasurements([]),
      error: "",
      baselineIssue: "",
      heartRateHistory: [],
      latestHeartRate: null,
      latestSensorContact: null,
      notificationCount: 0,
      sample: null,
      sampleId: 0,
      source: "none",
      status: "idle",
    });
  }, [stopMock]);

  const applyMeasurement = useCallback((measurement, source) => {
    const now = measurement.timestamp ?? Date.now();
    const nextMeasurement = { ...measurement, timestamp: now };
    const cutoff = now - PHYSIOLOGY_WINDOW_MS;

    measurementsRef.current = [...measurementsRef.current, nextMeasurement].filter(
      (item) => item.timestamp >= cutoff,
    );

    setState((current) => {
      const baseline = current.baseline;
      let nextBaseline = baseline;
      let baselineIssue = current.baselineIssue;
      let baselineProgress = current.baselineProgress;
      let status = current.status;

      if (!baseline) {
        baselineStartRef.current ??= now;
        baselineMeasurementsRef.current = [...baselineMeasurementsRef.current, nextMeasurement];
        baselineProgress = Math.min(
          1,
          (now - baselineStartRef.current) / (PHYSIOLOGY_BASELINE_SECONDS * 1000),
        );

        const baselineSummary = summarizePhysiologyMeasurements(baselineMeasurementsRef.current);
        if (baselineProgress >= 1) {
          nextBaseline =
            baselineSummary.physiology_quality === "good"
              ? createPhysiologyBaseline(baselineMeasurementsRef.current)
              : null;
          baselineIssue = nextBaseline ? "" : physiologyQualityMessage(baselineSummary);
          status = "ready";
          baselineProgress = 1;
        } else {
          baselineIssue = "";
          status = "baselining";
        }
      }

      const currentSummary = summarizePhysiologyMeasurements(
        measurementsRef.current,
        nextBaseline,
        current.currentSummary,
      );
      const nextHeartRateHistory = Number.isFinite(nextMeasurement.heartRateBpm)
        ? [...(current.heartRateHistory ?? []), nextMeasurement].slice(-48)
        : (current.heartRateHistory ?? []);
      sampleIdRef.current += 1;

      return {
        ...current,
        baseline: nextBaseline,
        baselineIssue,
        baselineProgress,
        connected: true,
        currentSummary,
        error: "",
        heartRateHistory: nextHeartRateHistory,
        latestHeartRate: nextMeasurement.heartRateBpm ?? current.latestHeartRate,
        latestSensorContact:
          nextMeasurement.sensorContactDetected ?? current.latestSensorContact,
        notificationCount: current.notificationCount + 1,
        sample: nextMeasurement,
        sampleId: sampleIdRef.current,
        source,
        status,
      };
    });
  }, []);

  const startMock = useCallback(() => {
    stopMock();
    const baselineMeasurements = createMockBaselineMeasurements();
    const baseline = createPhysiologyBaseline(baselineMeasurements);
    baselineMeasurementsRef.current = baselineMeasurements;
    measurementsRef.current = baselineMeasurements.slice(-20);
    baselineStartRef.current = Date.now() - PHYSIOLOGY_BASELINE_SECONDS * 1000;
    mockIndexRef.current = 0;
    sampleIdRef.current += 1;

    setState({
      baseline,
      baselineProgress: 1,
      connected: true,
      currentSummary: summarizePhysiologyMeasurements(measurementsRef.current, baseline),
      error: "",
      baselineIssue: "",
      heartRateHistory: baselineMeasurements.slice(-32),
      latestHeartRate: baseline.median_hr_bpm,
      latestSensorContact: true,
      notificationCount: baselineMeasurements.length,
      sample: measurementsRef.current.at(-1),
      sampleId: sampleIdRef.current,
      source: "mock",
      status: "ready",
    });

    mockIntervalRef.current = window.setInterval(() => {
      mockIndexRef.current += 1;
      applyMeasurement(createMockHeartRateMeasurement(mockIndexRef.current), "mock");
    }, 1000);
  }, [applyMeasurement, stopMock]);

  const connectBle = useCallback(async () => {
    if (!navigator.bluetooth) {
      setState((current) => ({
        ...current,
        error: "Web Bluetooth is not available in this browser.",
        status: "error",
      }));
      return;
    }

    try {
      disconnect();
      setState((current) => ({ ...current, error: "", source: "ble", status: "connecting" }));
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ["heart_rate"] }],
      });
      deviceRef.current = device;
      device.addEventListener("gattserverdisconnected", disconnect);
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService("heart_rate");
      const characteristic = await service.getCharacteristic("heart_rate_measurement");
      const handleMeasurement = (event) => {
        try {
          applyMeasurement(parseHeartRateMeasurement(event.target.value), "ble");
        } catch {
          setState((current) => ({
            ...current,
            error: "Heart-rate packet could not be parsed.",
          }));
        }
      };

      characteristic.__vibeShuffleHandler = handleMeasurement;
      characteristic.addEventListener("characteristicvaluechanged", handleMeasurement);
      await characteristic.startNotifications();
      characteristicRef.current = characteristic;
      baselineStartRef.current = Date.now();
      setState((current) => ({
        ...current,
        baseline: null,
        baselineIssue: "",
        baselineProgress: 0,
        connected: true,
        error: "",
        heartRateHistory: [],
        latestHeartRate: null,
        latestSensorContact: null,
        notificationCount: 0,
        source: "ble",
        status: "waiting",
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        connected: false,
        error:
          error?.name === "NotFoundError"
            ? "No heart-rate sensor was selected."
            : "Heart-rate sensor could not connect.",
        source: "none",
        status: "error",
      }));
    }
  }, [applyMeasurement, disconnect]);

  useEffect(() => disconnect, [disconnect]);

  return {
    ...state,
    connectBle,
    disconnect,
    startMock,
  };
}

function SectionLabel({ children, icon: Icon }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#8ca3b8]">
      <span className="flex size-7 items-center justify-center rounded-full bg-[#10283a] text-[#32e6c8]">
        <Icon className="size-3.5" />
      </span>
      {children}
    </div>
  );
}

function MoodMap({ mood }) {
  const x = clamp(mood.valence * 100, 8, 92);
  const y = clamp(100 - mood.energy * 100, 8, 92);

  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-white/10 bg-[#071827]">
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(248,113,113,0.18),rgba(45,212,191,0.18)),linear-gradient(0deg,rgba(59,130,246,0.10),rgba(251,146,60,0.18))]" />
      <div className="absolute inset-6 rounded-lg border border-white/14 shadow-inner" />
      <div className="absolute left-6 right-6 top-1/2 h-px bg-white/18" />
      <div className="absolute bottom-6 top-6 left-1/2 w-px bg-white/18" />
      <div
        className="absolute size-6 rounded-full border-[4px] border-[#071827] shadow-[0_0_34px_currentColor] transition-all duration-500"
        style={{
          background: mood.accent,
          color: mood.accent,
          left: `${x}%`,
          top: `${y}%`,
          transform: "translate(-50%, -50%)",
        }}
      />
      <span className="absolute left-1/2 top-3 -translate-x-1/2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9db0c4]">
        High arousal
      </span>
      <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9db0c4]">
        Low arousal
      </span>
      <span className="absolute left-2 top-1/2 -translate-y-1/2 -rotate-90 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9db0c4]">
        Low valence
      </span>
      <span className="absolute right-2 top-1/2 -translate-y-1/2 rotate-90 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9db0c4]">
        High valence
      </span>
    </div>
  );
}

function CoverArt({ isPlaying, song }) {
  const coverClass =
    "relative mx-auto aspect-square w-full max-w-[260px] overflow-hidden rounded-lg border border-white/14 shadow-[0_34px_90px_rgba(0,0,0,0.45)] sm:max-w-[320px] xl:max-w-[360px]";

  if (song.albumImageUrl) {
    return (
      <div className={coverClass}>
        <img alt="" className="h-full w-full object-cover" src={song.albumImageUrl} />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(2,7,18,0.34))]" />
      </div>
    );
  }

  return (
    <div
      className={coverClass}
      style={{
        background: `linear-gradient(135deg, ${song.palette[0]} 0%, ${song.palette[1]} 52%, ${song.palette[2]} 100%)`,
      }}
    >
      <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.18),rgba(255,255,255,0.06)_42%,rgba(2,7,18,0.28))]" />
      <div className="absolute -left-1/4 top-0 h-full w-2/3 rotate-12 bg-[#32e6c8]/24 blur-2xl animate-sweep" />
      <div className="absolute inset-x-8 bottom-9">
        <div className="flex items-end gap-2">
          {[48, 82, 58, 104, 46, 86, 62].map((height, index) => (
            <span
              className="w-full rounded-full bg-white/70 shadow-sm"
              key={`${song.id}-${height}`}
              style={{
                animation: isPlaying
                  ? `soft-pulse ${2.2 + index * 0.16}s ease-in-out infinite`
                  : "none",
                height: `${height}px`,
                opacity: isPlaying ? 0.96 : 0.52,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SessionWaveform({ isPlaying, song }) {
  const heights = [34, 62, 44, 86, 54, 104, 66, 48, 78, 52, 96, 42, 70, 58, 88, 46];

  return (
    <div className="flex h-20 items-end justify-center gap-2 rounded-lg border border-white/12 bg-white/6 px-5 py-4 backdrop-blur sm:h-28">
      {heights.map((height, index) => (
        <span
          className="w-full max-w-4 rounded-full bg-[#ddf7ff]/70 shadow-sm"
          key={`${song.id}-session-${height}-${index}`}
          style={{
            animation: isPlaying
              ? `soft-pulse ${1.9 + index * 0.08}s ease-in-out infinite`
              : "none",
            height: `${height}%`,
            opacity: isPlaying ? 0.96 : 0.5,
          }}
        />
      ))}
    </div>
  );
}

function CameraPanel({ face }) {
  const statusLabel =
    face.status === "ready"
      ? "Camera ready"
      : face.status === "searching"
        ? "Looking for face"
        : face.status === "loading"
          ? "Starting camera"
          : face.status === "calibrating"
            ? "Calibrating"
            : face.status === "error"
              ? "Camera blocked"
              : "Camera not started";

  return (
    <section className="rounded-lg border border-white/10 bg-[#071827]/92 p-5 shadow-[0_22px_70px_rgba(0,0,0,0.28)] backdrop-blur">
      <div className="mb-4 flex items-center justify-between gap-3">
        <SectionLabel icon={Camera}>Expression signal</SectionLabel>
        <span className="rounded-full bg-white/8 px-3 py-1 text-xs font-semibold text-[#c7d7e6]">
          {statusLabel}
        </span>
      </div>
      <div className="overflow-hidden rounded-lg bg-slate-950 shadow-inner">
        <video
          aria-label="Local camera preview"
          className="aspect-video w-full scale-x-[-1] object-cover opacity-90"
          muted
          playsInline
          ref={face.videoRef}
        />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-white/7 p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8ca3b8]">
            Expression
          </div>
          <div className="mt-1 text-xl font-semibold text-white">{face.label}</div>
        </div>
        <div className="rounded-lg bg-white/7 p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8ca3b8]">
            Confidence
          </div>
          <div className="mt-1 text-xl font-semibold text-white">
            {Math.round(face.confidence * 100)}%
          </div>
        </div>
      </div>
      {face.error ? <p className="mt-3 text-sm text-rose-300">{face.error}</p> : null}
    </section>
  );
}

function HeartRateCurve({ physiology, summary }) {
  const samples = physiology.heartRateHistory ?? [];
  const curve = buildHeartRateCurve(samples);
  const hasLiveSamples = samples.length > 0;
  const latestLabel = Number.isFinite(summary.hr_bpm_mean)
    ? `${Math.round(summary.hr_bpm_mean)} bpm`
    : "Waiting";
  const lastPoint = curve.points.at(-1);

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-white/10 bg-[linear-gradient(135deg,#082033_0%,#071827_60%,#201426_100%)] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#32e6c8]">
            Heart-rate curve
          </div>
          <div className="mt-1 text-xs text-[#8ca3b8]">
            {hasLiveSamples ? `Last ${samples.length} packets` : "Waiting for live packets"}
          </div>
        </div>
        <div className="rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-white shadow-sm">
          {latestLabel}
        </div>
      </div>
      <div className="relative h-32">
        <svg
          aria-hidden="true"
          className="h-full w-full overflow-visible"
          preserveAspectRatio="none"
          viewBox="0 0 320 112"
        >
          <defs>
            <linearGradient id="hrCurveStroke" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#14b8a6" />
              <stop offset="52%" stopColor="#22c55e" />
              <stop offset="100%" stopColor="#f97316" />
            </linearGradient>
            <linearGradient id="hrCurveArea" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#14b8a6" stopOpacity="0" />
            </linearGradient>
            <filter id="hrCurveGlow" x="-10%" y="-30%" width="120%" height="160%">
              <feGaussianBlur stdDeviation="4" />
            </filter>
          </defs>
          {[28, 56, 84].map((y) => (
            <line key={y} stroke="#8ca3b8" strokeDasharray="4 8" strokeOpacity="0.22" x1="0" x2="320" y1={y} y2={y} />
          ))}
          <path d={curve.areaPath} fill="url(#hrCurveArea)" opacity={hasLiveSamples ? 1 : 0.36} />
          <path
            d={curve.path}
            fill="none"
            filter="url(#hrCurveGlow)"
            opacity={hasLiveSamples ? 0.38 : 0.16}
            stroke="#14b8a6"
            strokeLinecap="round"
            strokeWidth="7"
          />
          <path
            d={curve.path}
            fill="none"
            opacity={hasLiveSamples ? 1 : 0.34}
            stroke="url(#hrCurveStroke)"
            strokeDasharray={hasLiveSamples ? "0" : "8 10"}
            strokeLinecap="round"
            strokeWidth="3.5"
          />
          {hasLiveSamples && lastPoint ? (
            <>
              <circle cx={lastPoint.x} cy={lastPoint.y} fill="#f97316" opacity="0.18" r="11" />
              <circle className="animate-pulse" cx={lastPoint.x} cy={lastPoint.y} fill="#f97316" r="4.5" />
            </>
          ) : null}
        </svg>
        {!hasLiveSamples ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-semibold uppercase tracking-[0.14em] text-[#8ca3b8]">
            Connect sensor
          </div>
        ) : null}
      </div>
      <div className="mt-2 flex justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8ca3b8]">
        <span>Min {Math.round(curve.min)} bpm</span>
        <span>Max {Math.round(curve.max)} bpm</span>
      </div>
    </div>
  );
}

function PhysiologyPanel({ physiology }) {
  const summary = physiology.currentSummary;
  let statusLabel = "Optional";
  if (physiology.status === "ready") {
    if (physiology.source === "mock") {
      statusLabel = "Demo sensor ready";
    } else if (physiology.baseline) {
      statusLabel = "ECG + HRV ready";
    } else {
      statusLabel =
        summary.physiology_quality === "bpm_only" ? "HR only" : "Baseline not usable";
    }
  } else if (physiology.status === "baselining") {
    statusLabel = `Baseline ${Math.round(physiology.baselineProgress * 100)}%`;
  } else if (physiology.status === "connecting") {
    statusLabel = "Connecting";
  } else if (physiology.status === "waiting") {
    statusLabel = "Waiting for HR";
  } else if (physiology.status === "error") {
    statusLabel = "Sensor unavailable";
  }
  const rmssdLabel = Number.isFinite(summary.rmssd_ms)
    ? `${Math.round(summary.rmssd_ms)} ms`
    : "No RR";
  const arousalLabel = Number.isFinite(summary.physiology_arousal)
    ? `${Math.round(summary.physiology_arousal * 100)}%`
    : "Face only";
  let helpText = "HRV is used only when RR intervals are available and baseline quality is good.";
  if (physiology.status === "waiting") {
    helpText =
      "Sensor permission is granted. Waiting for live heart-rate packets. Wear the Polar strap firmly and wet the electrodes.";
  } else if (physiology.baselineIssue) {
    helpText = physiology.baselineIssue;
  } else if (physiology.latestSensorContact === false) {
    helpText = "Sensor reports poor skin contact. Wet the electrodes and wear the strap firmly.";
  } else if (summary.physiology_quality === "bpm_only") {
    helpText = "This connection is sending HR only. HRV needs RR intervals from the sensor.";
  } else if (summary.physiology_quality === "low") {
    helpText = "More RR intervals are needed before HRV can drive arousal.";
  }
  const qualityLabel =
    summary.physiology_quality === "good"
      ? "good"
      : summary.physiology_quality === "bpm_only"
        ? "HR only"
        : summary.physiology_quality === "low"
          ? "low RR"
          : "no data";

  return (
    <section className="rounded-lg border border-white/10 bg-[#071827]/92 p-5 shadow-[0_22px_70px_rgba(0,0,0,0.28)] backdrop-blur">
      <div className="mb-4 flex items-center justify-between gap-3">
        <SectionLabel icon={HeartPulse}>Physiology signal</SectionLabel>
        <span className="rounded-full bg-white/8 px-3 py-1 text-xs font-semibold text-[#c7d7e6]">
          {statusLabel}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-white/7 p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8ca3b8]">
            HR
          </div>
          <div className="mt-1 text-lg font-semibold text-white">
            {summary.hr_bpm_mean ? `${Math.round(summary.hr_bpm_mean)} bpm` : "-"}
          </div>
        </div>
        <div className="rounded-lg bg-white/7 p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8ca3b8]">
            RMSSD
          </div>
          <div className="mt-1 text-lg font-semibold text-white">{rmssdLabel}</div>
        </div>
        <div className="rounded-lg bg-white/7 p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8ca3b8]">
            Arousal
          </div>
          <div className="mt-1 text-lg font-semibold text-white">{arousalLabel}</div>
        </div>
      </div>
      <HeartRateCurve physiology={physiology} summary={summary} />
      <p className="mt-3 text-xs leading-5 text-[#8ca3b8]">{helpText}</p>
      <div className="mt-3 rounded-lg bg-white/7 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#8ca3b8]">
        Quality {qualityLabel} · Packets {physiology.notificationCount} · RR{" "}
        {summary.rr_count}/20
      </div>
      {physiology.error ? <p className="mt-3 text-sm text-rose-300">{physiology.error}</p> : null}
    </section>
  );
}

function SetupStep({ children, complete, icon: Icon, title }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/6 p-4 shadow-sm backdrop-blur">
      <div className="flex items-start gap-3">
        <div
          className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
            complete ? "bg-[#32e6c8]/18 text-[#32e6c8]" : "bg-white/8 text-[#8ca3b8]"
          }`}
        >
          {complete ? <CheckCircle2 className="size-5" /> : <Icon className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-white">{title}</div>
          <div className="mt-1 text-sm leading-5 text-[#9db0c4]">{children}</div>
        </div>
      </div>
    </div>
  );
}

function IntroModal({
  cameraReady,
  catalogRequiresSpotify,
  face,
  onConnectHeartSensor,
  onConnectSpotify,
  onDisconnectHeartSensor,
  onStart,
  onStartCamera,
  onStartMockHeartSensor,
  open,
  physiology,
  setupReady,
  spotifyAuth,
  spotifyPlayer,
  trackCount,
}) {
  if (!open) return null;

  const spotifyReady = !catalogRequiresSpotify || spotifyPlayer.ready;
  const physiologyReady = !physiology.connected || physiology.status === "ready";
  const physiologyStatusText =
    physiology.status === "ready"
      ? physiology.baseline
        ? physiology.source === "mock"
          ? "Demo ECG baseline is ready."
          : "Heart-rate baseline is ready."
        : physiology.baselineIssue ||
          "Heart-rate sensor is connected, but HRV is not driving selection."
      : physiology.status === "baselining"
        ? `Neutral baseline ${Math.round(physiology.baselineProgress * 100)}% complete.`
        : physiology.status === "connecting"
          ? "Connecting to heart-rate sensor."
          : physiology.status === "waiting"
            ? "Sensor is paired. Waiting for live heart-rate packets. Wear the strap and wet the electrodes."
            : physiology.error || "Optional: connect a BLE ECG/heart-rate sensor.";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#020712]/86 px-4 py-6 backdrop-blur-xl">
      <section
        aria-modal="true"
        className="w-full max-w-5xl overflow-hidden rounded-lg border border-white/10 bg-[#071827] shadow-[0_34px_120px_rgba(0,0,0,0.55)]"
        role="dialog"
      >
        <div className="grid lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div className="relative min-h-[430px] overflow-hidden bg-[#020712] p-6 text-white sm:p-8">
            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(49,46,129,0.70),rgba(7,24,39,0.82)_48%,rgba(249,115,22,0.48))]" />
            <div className="relative flex h-full min-h-[370px] flex-col gap-7">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/14 bg-white/8 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-white shadow-sm backdrop-blur">
                <Radio className="size-4" />
                Guided adaptive session
              </div>
              <div className="max-w-[460px]">
                <h2 className="text-4xl font-semibold leading-[1.02] tracking-tight sm:text-5xl xl:text-6xl">
                  Music made for your current state.
                </h2>
                <p className="mt-4 max-w-sm text-sm leading-6 text-white/72">
                  Music starts only after you press play. After each track, one short rating
                  appears before the next listening window.
                </p>
              </div>
              <div className="mt-auto flex h-24 items-end gap-3 opacity-85" aria-hidden="true">
                {[48, 82, 56, 106, 64, 92, 50, 76, 112, 62, 88, 54].map((height, index) => (
                  <span
                    className="w-full rounded-full bg-white/70"
                    key={`${height}-${index}`}
                    style={{
                      animation: `soft-pulse ${2 + index * 0.09}s ease-in-out infinite`,
                      height: `${height}px`,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="p-5 sm:p-8">
            <div className="max-w-xl">
              <SectionLabel icon={Headphones}>Vibe Shuffle</SectionLabel>
              <h2 className="mt-4 text-4xl font-semibold tracking-tight text-white">
                Your adaptive music session is ready.
              </h2>
              <p className="mt-3 text-sm leading-6 text-[#9db0c4]">
                Expression and optional ECG/HRV signals stay local in this browser. The session is
                blinded for the participant and exports only validation data after completion.
              </p>
            </div>

            <div className="mt-6 grid gap-3">
              <SetupStep complete={cameraReady} icon={Camera} title="Camera signal">
                <div className="flex items-center justify-between gap-3">
                  <span>
                    {cameraReady
                      ? "Expression detection is ready."
                      : face.error || "Optional: enable local expression detection."}
                  </span>
                  {!cameraReady ? (
                    <button
                      className="rounded-full bg-[#32e6c8] px-3 py-1.5 text-xs font-semibold text-[#020712] shadow-sm transition hover:bg-[#8fffea]"
                      onClick={onStartCamera}
                      type="button"
                    >
                      Enable
                    </button>
                  ) : null}
                </div>
              </SetupStep>
              <SetupStep complete={physiologyReady} icon={HeartPulse} title="Heart-rate sensor">
                <div className="flex flex-col gap-3">
                  <span>{physiologyStatusText}</span>
                  {physiology.status === "idle" || physiology.status === "error" ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="rounded-full bg-[#32e6c8] px-3 py-1.5 text-xs font-semibold text-[#020712] shadow-sm transition hover:bg-[#8fffea]"
                        onClick={onConnectHeartSensor}
                        type="button"
                      >
                        Connect
                      </button>
                      <button
                        className="rounded-full bg-white/8 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-white/14"
                        onClick={onStartMockHeartSensor}
                        type="button"
                      >
                        Demo
                      </button>
                    </div>
                  ) : physiology.connected ? (
                    <button
                      className="w-fit rounded-full bg-white/8 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-white/14"
                      onClick={onDisconnectHeartSensor}
                      type="button"
                    >
                      Skip ECG
                    </button>
                  ) : null}
                </div>
              </SetupStep>
              {catalogRequiresSpotify ? (
                <SetupStep complete={spotifyReady} icon={Lock} title="Spotify playback">
                  <div className="flex items-center justify-between gap-3">
                    <span>
                      {spotifyPlayer.ready
                        ? "Spotify playback device is connected."
                        : spotifyAuth.error || spotifyPlayer.error || "Connect Spotify Premium playback."}
                    </span>
                    {!spotifyAuth.authenticated ? (
                      <button
                        className="rounded-full bg-[#32e6c8] px-3 py-1.5 text-xs font-semibold text-[#020712] shadow-sm transition hover:bg-[#8fffea]"
                        onClick={onConnectSpotify}
                        type="button"
                      >
                        Connect
                      </button>
                    ) : null}
                  </div>
                </SetupStep>
              ) : null}
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                className="inline-flex h-14 items-center justify-center gap-2 rounded-full bg-[#32e6c8] px-6 py-3 text-sm font-semibold text-[#020712] shadow-[0_18px_44px_rgba(0,0,0,0.28)] transition hover:-translate-y-0.5 hover:bg-[#8fffea] disabled:cursor-not-allowed disabled:bg-white/18 disabled:text-white/45"
                disabled={!setupReady}
                onClick={onStart}
                type="button"
              >
                Continue to player
                <SkipForward className="size-4" />
              </button>
              <span className="rounded-full bg-white/8 px-4 py-2 text-sm font-semibold text-[#c7d7e6]">
                {trackCount} instrumental tracks
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function RatingModal({ currentRating, nextButtonLabel, onContinue, onRate, open, song }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#020712]/72 px-4 py-6 backdrop-blur-md">
      <section
        aria-modal="true"
        className="w-full max-w-2xl rounded-lg border border-white/10 bg-[#071827] p-6 shadow-[0_32px_110px_rgba(0,0,0,0.48)] sm:p-7"
        role="dialog"
      >
        <SectionLabel icon={BarChart3}>Rating required</SectionLabel>
        <h2 className="mt-4 text-4xl font-semibold tracking-tight text-white">
          How well did this track fit your mood?
        </h2>
        <p className="mt-2 text-sm text-[#9db0c4]">
          You just listened to <span className="font-semibold text-white">{song.title}</span>.
          Select one rating to continue.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {RATING_OPTIONS.map((option) => {
            const active = currentRating?.rating_1_to_4 === option.score;

            return (
              <button
                className={`min-h-32 rounded-lg border px-3 py-4 text-left transition ${
                  active
                    ? "border-[#32e6c8] bg-[#32e6c8] text-[#020712] shadow-[0_18px_44px_rgba(0,0,0,0.28)]"
                    : "border-white/10 bg-white/7 text-[#c7d7e6] hover:border-[#32e6c8]/50 hover:bg-white/10"
                }`}
                key={option.score}
                onClick={() => onRate(option.score)}
                type="button"
              >
                <span className="block text-3xl font-semibold">{option.score}</span>
                <span className="mt-3 block text-sm font-bold leading-tight">{option.label}</span>
                <span className={`mt-2 block text-xs leading-4 ${active ? "text-[#063333]" : "text-[#8ca3b8]"}`}>
                  {option.description}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[#9db0c4]">1 means no fit. 4 means a very good mood fit.</p>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[#32e6c8] px-5 py-3 text-sm font-semibold text-[#020712] shadow-[0_18px_44px_rgba(0,0,0,0.28)] transition hover:bg-[#8fffea] disabled:cursor-not-allowed disabled:bg-white/16 disabled:text-white/45"
            disabled={!currentRating}
            onClick={onContinue}
            type="button"
          >
            {nextButtonLabel}
            <SkipForward className="size-4" />
          </button>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const songs = useMemo(() => getCatalogTracks().map(normalizeSong), []);
  const catalogSource = Array.isArray(musicCatalog) ? "legacy" : musicCatalog.source;
  const catalogRequiresSpotify =
    catalogSource?.startsWith("spotify") && songs.some((song) => song.spotifyUri);
  const spotifyAuth = useSpotifyAuth();
  const spotifyPlayer = useSpotifyPlayer(spotifyAuth.accessToken, spotifyAuth.ensureToken);
  const spotifyPlayerReady = spotifyPlayer.ready;
  const spotifyPlayerError = spotifyPlayer.error;
  const pauseSpotify = spotifyPlayer.pause;
  const playSpotifyTrack = spotifyPlayer.playTrack;
  const resumeSpotify = spotifyPlayer.resume;
  const demoAudio = useDemoAudio();
  const demoAudioError = demoAudio.error;
  const pauseDemoAudio = demoAudio.pause;
  const playDemoSong = demoAudio.playSong;
  const resumeDemoAudio = demoAudio.resume;
  const stopDemoAudio = demoAudio.stop;
  const face = useFaceExpression();
  const physiology = usePhysiologySensor();
  const [sessionStarted, setSessionStarted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [protocolId, setProtocolId] = useState(() => createProtocolId());
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [currentSong, setCurrentSong] = useState(() => songs[0]);
  const [history, setHistory] = useState([]);
  const [queueSeed, setQueueSeed] = useState(24);
  const [trialId, setTrialId] = useState(1);
  const [ratings, setRatings] = useState([]);
  const [protocolComplete, setProtocolComplete] = useState(false);
  const [trackProgress, setTrackProgress] = useState(0);
  const [ratingPromptOpen, setRatingPromptOpen] = useState(false);
  const [playbackNotice, setPlaybackNotice] = useState("");
  const expressionWindowRef = useRef([]);
  const lastWindowSampleIdRef = useRef(0);
  const physiologyWindowRef = useRef([]);
  const lastPhysiologySampleIdRef = useRef(0);

  const mode = PROTOCOL_BLOCKS[currentBlockIndex].mode;
  const liveFusion = useMemo(
    () => fuseEmotionSignals(face, physiology.currentSummary),
    [
      face.confidence,
      face.energy,
      face.tag,
      face.valence,
      physiology.currentSummary.physiology_arousal,
      physiology.currentSummary.physiology_quality,
      physiology.currentSummary.rr_count,
    ],
  );
  const mood = signalStateToMood(liveFusion);
  const recentIds = useMemo(() => history.slice(-8).map((song) => song.id), [history]);
  const queue = useMemo(
    () => rankSongs(songs, mode, mood, currentSong.id, queueSeed, recentIds).slice(0, 4),
    [currentSong.id, mode, mood.energy, mood.tag, mood.valence, queueSeed, recentIds, songs],
  );
  const currentRating = ratings.find((rating) => rating.trial_id === trialId);
  const totalTrials = PROTOCOL_BLOCKS.length * TRACKS_PER_BLOCK;
  const completedTrials = ratings.length;
  const progressPercent = Math.round((completedTrials / totalTrials) * 100);
  const remainingSeconds =
    LISTENING_WINDOW_SECONDS * (1 - Math.min(trackProgress, 100) / 100);
  const cameraReady =
    face.status === "ready" || face.status === "searching" || face.status === "calibrating";
  const playbackReady = !catalogRequiresSpotify || spotifyPlayerReady;
  const physiologyReady = !physiology.connected || physiology.status === "ready";
  const setupReady = playbackReady && physiologyReady;
  const isFallbackCatalog = catalogSource === "real-instrumental-demo" || catalogSource === "legacy";

  function currentWindowSummary() {
    return summarizeExpressionSamples(expressionWindowRef.current, face);
  }

  function currentPhysiologySummary() {
    return summarizePhysiologyMeasurements(
      physiologyWindowRef.current,
      physiology.baseline,
      physiology.currentSummary,
    );
  }

  function resetExpressionWindow() {
    expressionWindowRef.current = [];
    lastWindowSampleIdRef.current = face.sampleId ?? 0;
  }

  function resetPhysiologyWindow() {
    physiologyWindowRef.current = [];
    lastPhysiologySampleIdRef.current = physiology.sampleId ?? 0;
  }

  function resetSignalWindows() {
    resetExpressionWindow();
    resetPhysiologyWindow();
  }

  useEffect(() => {
    if (!face.sampleId || face.sampleId === lastWindowSampleIdRef.current) return;

    lastWindowSampleIdRef.current = face.sampleId;

    if (
      !sessionStarted ||
      !isPlaying ||
      ratingPromptOpen ||
      protocolComplete ||
      !face.sample
    ) {
      return;
    }

    expressionWindowRef.current = [...expressionWindowRef.current.slice(-360), face.sample];
  }, [
    face.sample,
    face.sampleId,
    isPlaying,
    protocolComplete,
    ratingPromptOpen,
    sessionStarted,
  ]);

  useEffect(() => {
    if (
      !physiology.sampleId ||
      physiology.sampleId === lastPhysiologySampleIdRef.current
    ) {
      return;
    }

    lastPhysiologySampleIdRef.current = physiology.sampleId;

    if (
      !sessionStarted ||
      !isPlaying ||
      ratingPromptOpen ||
      protocolComplete ||
      !physiology.sample
    ) {
      return;
    }

    physiologyWindowRef.current = [...physiologyWindowRef.current.slice(-180), physiology.sample];
  }, [
    isPlaying,
    physiology.sample,
    physiology.sampleId,
    protocolComplete,
    ratingPromptOpen,
    sessionStarted,
  ]);

  useEffect(() => {
    if (!sessionStarted || !isPlaying || protocolComplete || ratingPromptOpen || currentRating) {
      return undefined;
    }

    const id = window.setInterval(() => {
      setTrackProgress((value) => {
        const nextValue = Math.min(value + 100 / (LISTENING_WINDOW_SECONDS * 4), 100);

        if (nextValue >= 100) {
          window.setTimeout(() => {
            setIsPlaying(false);
            setRatingPromptOpen(true);
          }, 0);
        }

        return nextValue;
      });
    }, 250);

    return () => window.clearInterval(id);
  }, [currentRating, isPlaying, protocolComplete, ratingPromptOpen, sessionStarted]);

  useEffect(() => {
    if (!sessionStarted || ratingPromptOpen) return;

    if (!isPlaying) {
      pauseSpotify();
      pauseDemoAudio();
      return;
    }

    if (!currentSong.spotifyUri) {
      playDemoSong(currentSong).then((played) => {
        setPlaybackNotice(
          played
            ? currentSong.audioUrl
              ? "Curated instrumental track is playing."
              : "Demo audio is generated locally until Spotify tracks are imported."
            : "Demo audio could not start in this browser.",
        );
      });
      return;
    }

    if (!spotifyPlayerReady) {
      setPlaybackNotice("Waiting for Spotify playback device.");
      return;
    }

    let cancelled = false;
    playSpotifyTrack(currentSong.spotifyUri).then((played) => {
      if (!cancelled) {
        setPlaybackNotice(played ? "" : "Spotify could not start this track.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    currentSong.id,
    currentSong.spotifyUri,
    isPlaying,
    pauseDemoAudio,
    pauseSpotify,
    playDemoSong,
    playSpotifyTrack,
    ratingPromptOpen,
    sessionStarted,
    spotifyPlayerReady,
  ]);

  useEffect(() => {
    if (ratingPromptOpen) {
      pauseSpotify();
      pauseDemoAudio();
    }
  }, [pauseDemoAudio, pauseSpotify, ratingPromptOpen]);

  function startSession() {
    if (!setupReady || !songs.length) return;
    resetSignalWindows();
    setSessionStarted(true);
    setIsPlaying(false);
    setTrackProgress(0);
    setPlaybackNotice("Press Start music when you are ready.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function moveToSong(song) {
    resetSignalWindows();
    setHistory((items) => [...items.slice(-8), currentSong]);
    setCurrentSong(song);
    setTrialId((value) => value + 1);
    setQueueSeed((value) => value + 19);
    setTrackProgress(0);
    setRatingPromptOpen(false);
    setIsPlaying(sessionStarted);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function advanceProtocol() {
    if (!currentRating || protocolComplete) return;

    const selectionFusion = fuseEmotionSignals(currentWindowSummary(), currentPhysiologySummary());
    const selectionMood = signalStateToMood(selectionFusion);
    const rankedSongs = rankSongs(songs, mode, selectionMood, currentSong.id, queueSeed, recentIds);
    const nextSong = rankedSongs[0] ?? queue[0] ?? songs[0];
    const isLastTrackInBlock = currentTrackIndex === TRACKS_PER_BLOCK - 1;
    const isLastBlock = currentBlockIndex === PROTOCOL_BLOCKS.length - 1;

    if (isLastTrackInBlock && isLastBlock) {
      setProtocolComplete(true);
      setRatingPromptOpen(false);
      setIsPlaying(false);
      stopDemoAudio();
      window.setTimeout(() => downloadCsv(ratings, protocolId), 0);
      return;
    }

    if (isLastTrackInBlock) {
      const nextBlock = PROTOCOL_BLOCKS[currentBlockIndex + 1];
      const transitionQueue = rankSongs(
        songs,
        nextBlock.mode,
        selectionMood,
        currentSong.id,
        queueSeed + 31,
        recentIds,
      );

      setCurrentBlockIndex((value) => value + 1);
      setCurrentTrackIndex(0);
      setQueueSeed((value) => value + 31);
      moveToSong(transitionQueue[0] ?? nextSong);
      return;
    }

    setCurrentTrackIndex((value) => value + 1);
    moveToSong(nextSong);
  }

  function rateCurrentSong(score) {
    if (protocolComplete || !ratingPromptOpen) return;

    setRatings((items) => {
      const expressionSummary = currentWindowSummary();
      const expressionMood = expressionStateToMood(expressionSummary);
      const physiologySummary = currentPhysiologySummary();
      const fusionSummary = fuseEmotionSignals(expressionSummary, physiologySummary);
      const nextRating = {
        protocol_id: protocolId,
        trial_id: trialId,
        timestamp: new Date().toISOString(),
        block_number: currentBlockIndex + 1,
        block_mode: mode,
        mode,
        track_number: currentTrackIndex + 1,
        song_id: currentSong.id,
        song_source: currentSong.source ?? catalogSource,
        jamendo_id: currentSong.jamendoId,
        spotify_id: currentSong.spotifyId,
        spotify_uri: currentSong.spotifyUri,
        song_title: currentSong.title,
        artist: currentSong.artist,
        album: currentSong.album,
        song_quadrant: currentSong.quadrant,
        song_valence: currentSong.valence,
        song_arousal: currentSong.energy,
        song_instrumentalness: currentSong.instrumentalness,
        song_speechiness: currentSong.speechiness,
        song_category_source: currentSong.categorySource,
        song_analysis_confidence: currentSong.analysisConfidence,
        song_external_url: currentSong.externalUrl,
        song_license_url: currentSong.licenseUrl,
        detected_expression: expressionMood.tag,
        detected_expression_label: expressionMood.label,
        detected_valence: Number(expressionMood.valence.toFixed(3)),
        detected_arousal: Number(expressionMood.energy.toFixed(3)),
        expression_confidence: Number(expressionMood.confidence.toFixed(3)),
        face_present: expressionMood.facePresent,
        window_expression: expressionSummary.tag,
        window_expression_confidence: Number(expressionSummary.confidence.toFixed(3)),
        window_sample_count: expressionSummary.sampleCount,
        mean_happy: Number(expressionSummary.mean_happy.toFixed(3)),
        mean_relaxed: Number(expressionSummary.mean_relaxed.toFixed(3)),
        mean_tense: Number(expressionSummary.mean_tense.toFixed(3)),
        mean_sad_low: Number(expressionSummary.mean_sad_low.toFixed(3)),
        ecg_connected: physiology.connected,
        physiology_quality: physiologySummary.physiology_quality,
        hr_bpm_mean: physiologySummary.hr_bpm_mean,
        rr_count: physiologySummary.rr_count,
        rr_artifact_rate: physiologySummary.artifact_rate,
        rmssd_ms: physiologySummary.rmssd_ms,
        sdnn_ms: physiologySummary.sdnn_ms,
        pnn20: physiologySummary.pnn20,
        baseline_hr_bpm: physiologySummary.baseline_hr_bpm,
        baseline_rmssd_ms: physiologySummary.baseline_rmssd_ms,
        z_hr: physiologySummary.z_hr,
        z_rmssd: physiologySummary.z_rmssd,
        z_sdnn: physiologySummary.z_sdnn,
        physiology_arousal: physiologySummary.physiology_arousal,
        fusion_valence: Number(fusionSummary.valence.toFixed(3)),
        fusion_arousal: Number(fusionSummary.energy.toFixed(3)),
        selection_signal_source: fusionSummary.selectionSignalSource,
        rating_1_to_4: score,
        score,
      };

      if (items.some((rating) => rating.trial_id === trialId)) {
        return items.map((rating) => (rating.trial_id === trialId ? nextRating : rating));
      }

      return [...items, nextRating];
    });
  }

  function resetProtocol() {
    resetSignalWindows();
    setProtocolId(createProtocolId());
    setCurrentBlockIndex(0);
    setCurrentTrackIndex(0);
    setCurrentSong(songs[0]);
    setHistory([]);
    setQueueSeed(24);
    setTrialId(1);
    setRatings([]);
    setProtocolComplete(false);
    setTrackProgress(0);
    setRatingPromptOpen(false);
    setSessionStarted(false);
    setIsPlaying(false);
    setPlaybackNotice("");
    stopDemoAudio();
  }

  async function togglePlayback() {
    if (!sessionStarted || protocolComplete || ratingPromptOpen) return;

    if (isPlaying) {
      setIsPlaying(false);
      await pauseSpotify();
      await pauseDemoAudio();
      return;
    }

    setIsPlaying(true);
    if (currentSong.spotifyUri && spotifyPlayerReady) {
      await resumeSpotify();
    } else if (!currentSong.spotifyUri) {
      const resumed = await resumeDemoAudio();
      if (!resumed) await playDemoSong(currentSong);
    }
  }

  const nextButtonLabel = protocolComplete
    ? "Protocol complete"
    : !currentRating
      ? "Rate to continue"
      : currentBlockIndex === PROTOCOL_BLOCKS.length - 1 &&
          currentTrackIndex === TRACKS_PER_BLOCK - 1
        ? "Finish session"
        : currentTrackIndex === TRACKS_PER_BLOCK - 1
          ? "Continue"
          : "Next track";

  if (!songs.length) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#020712] px-4 text-white">
        <section className="max-w-lg rounded-lg border border-white/10 bg-[#071827] p-6 text-center shadow-sm">
          <SectionLabel icon={Waves}>Catalog missing</SectionLabel>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
            No tracks are available.
          </h1>
          <p className="mt-2 text-sm text-[#9db0c4]">
            Run <span className="font-mono">npm run spotify:catalog</span> with Spotify credentials
            or <span className="font-mono">npm run jamendo:catalog</span> with a Jamendo Client ID
            to generate the track catalog.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#020712] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(160deg,#020712_0%,#071827_46%,#11122b_70%,#2a160d_100%)]" />
      <div className="pointer-events-none fixed inset-x-0 top-0 h-56 bg-[linear-gradient(180deg,rgba(45,212,191,0.16),rgba(2,7,18,0))]" />

      <div className="relative mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-4 sm:px-6 lg:px-8 lg:py-7">
        <header className="flex flex-col gap-4 rounded-lg border border-white/10 bg-[#071827]/82 px-4 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-[#32e6c8] text-[#020712] shadow-[0_0_38px_rgba(50,230,200,0.24)]">
              <Waves className="size-5" />
            </div>
            <div>
              <div className="text-lg font-semibold tracking-tight text-white">Vibe Shuffle</div>
              <p className="text-sm text-[#8ca3b8]">Music that adapts to your emotional state.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/8 px-4 py-2 text-sm font-semibold text-[#c7d7e6]">
              {completedTrials}/{totalTrials} rated
            </span>
            <span className="rounded-full bg-white/8 px-4 py-2 text-sm font-semibold text-[#c7d7e6]">
              {ratingPromptOpen ? "Rating required" : isPlaying ? "Listening" : "Ready"}
            </span>
            {protocolComplete ? (
              <>
                <button
                  className="inline-flex items-center gap-2 rounded-full bg-[#32e6c8] px-4 py-2 text-sm font-semibold text-[#020712] shadow-sm transition hover:bg-[#8fffea]"
                  onClick={() => downloadCsv(ratings, protocolId)}
                  type="button"
                >
                  <Download className="size-4" />
                  Save CSV
                </button>
                <button
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/8 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-white/14"
                  onClick={resetProtocol}
                  type="button"
                >
                  <RotateCcw className="size-4" />
                  Reset
                </button>
              </>
            ) : null}
          </div>
        </header>

        {isFallbackCatalog ? (
          <section className="rounded-lg border border-amber-300/20 bg-amber-300/10 px-5 py-3 text-sm text-amber-100">
            Real instrumental fallback loaded. Run{" "}
            <span className="font-mono">npm run jamendo:catalog</span> to replace it with a
            Jamendo-derived 100-track instrumental pool.
          </section>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="overflow-hidden rounded-lg border border-white/10 bg-[#020712] text-white shadow-[0_34px_120px_rgba(0,0,0,0.46)]">
            <div className="grid lg:grid-cols-[minmax(300px,0.86fr)_minmax(0,1.14fr)]">
              <div className="relative min-h-[360px] p-5 sm:min-h-[440px] sm:p-7 lg:min-h-[640px]">
                <div
                  className="absolute inset-0 opacity-80"
                  style={{
                    background: `linear-gradient(135deg, ${currentSong.palette[0]} 0%, ${currentSong.palette[1]} 48%, ${currentSong.palette[2]} 100%)`,
                  }}
                />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,7,18,0.18),rgba(2,7,18,0.84))]" />
                <div className="relative flex h-full min-h-[320px] flex-col justify-between gap-6 sm:min-h-[400px] sm:gap-8 lg:min-h-[586px]">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/14 bg-white/8 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-white shadow-sm backdrop-blur">
                      <Headphones className="size-4" />
                      Participant session
                    </span>
                    <span className="rounded-full border border-white/14 bg-[#020712]/34 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white/90 backdrop-blur">
                      Trial {completedTrials + 1}/{totalTrials}
                    </span>
                  </div>
                  <div className="flex flex-1 items-center justify-center">
                    <CoverArt isPlaying={isPlaying} song={currentSong} />
                  </div>
                  <SessionWaveform isPlaying={isPlaying} song={currentSong} />
                </div>
              </div>

              <div className="flex min-h-[520px] flex-col justify-between gap-8 bg-[#071827] p-5 text-white sm:p-7 lg:min-h-[640px] xl:p-9">
                <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <SectionLabel icon={Music2}>Now playing</SectionLabel>
                    <h2 className="mt-5 max-w-2xl break-words text-4xl font-semibold leading-[0.98] tracking-tight text-white sm:text-5xl 2xl:text-6xl">
                      {currentSong.title}
                    </h2>
                    <p className="mt-3 text-xl text-[#c7d7e6]">{currentSong.artist}</p>
                    {currentSong.album ? (
                      <p className="mt-1 text-sm font-medium text-[#8ca3b8]">{currentSong.album}</p>
                    ) : null}
                    <div className="mt-5 flex flex-wrap gap-2">
                      {SESSION_MODES.map((modeLabel) => (
                        <span
                          className="rounded-full border border-white/10 bg-white/7 px-3 py-1.5 text-xs font-semibold text-[#c7d7e6]"
                          key={modeLabel}
                        >
                          {modeLabel}
                        </span>
                      ))}
                    </div>
                  </div>
                  <ProgressRing label="rated" value={progressPercent} />
                </div>

                <div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <button
                      aria-label={isPlaying ? "Pause music" : "Start music"}
                      className="inline-flex h-16 items-center justify-center gap-3 rounded-full bg-[#32e6c8] px-8 text-base font-semibold text-[#020712] shadow-[0_22px_56px_rgba(0,0,0,0.34)] transition hover:-translate-y-0.5 hover:bg-[#8fffea] disabled:cursor-not-allowed disabled:bg-white/16 disabled:text-white/45"
                      disabled={!sessionStarted || protocolComplete || ratingPromptOpen}
                      onClick={togglePlayback}
                      type="button"
                    >
                      {isPlaying ? <Pause className="size-5" /> : <Play className="size-5" />}
                      {isPlaying ? "Pause" : trackProgress > 0 ? "Resume" : "Start music"}
                    </button>
                    <div className="flex items-center gap-2 rounded-full bg-white/8 px-4 py-2 text-sm font-semibold text-[#c7d7e6]">
                      <span
                        className={`size-2 rounded-full ${
                          isPlaying ? "animate-pulse bg-[#32e6c8]" : "bg-white/25"
                        }`}
                      />
                      {ratingPromptOpen
                        ? "Rating required"
                        : isPlaying
                          ? "Playing"
                          : sessionStarted
                            ? "Ready"
                            : "Waiting"}
                    </div>
                  </div>
                  {playbackNotice || spotifyPlayerError || demoAudioError ? (
                    <p className="mt-3 text-sm text-[#8ca3b8]">
                      {spotifyPlayerError || demoAudioError || playbackNotice}
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg bg-white/7 px-4 py-3">
                    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-[#8ca3b8]">
                      <Clock3 className="size-3.5 text-[#32e6c8]" />
                      Window
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-white">
                      {ratingPromptOpen ? "Rate" : formatSeconds(remainingSeconds)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/7 px-4 py-3">
                    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-[#8ca3b8]">
                      <Gauge className="size-3.5 text-[#32e6c8]" />
                      Mood
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-white">{mood.label}</div>
                  </div>
                  <div className="rounded-lg bg-white/7 px-4 py-3">
                    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-[#8ca3b8]">
                      <BarChart3 className="size-3.5 text-[#32e6c8]" />
                      Rated
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-white">
                      {completedTrials}/{totalTrials}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-white/10 bg-white/6 p-4">
                  <div className="mb-3 flex items-center justify-between text-sm font-semibold text-[#9db0c4]">
                    <span>Listening window</span>
                    <span>{ratingPromptOpen ? "Ready to rate" : `${Math.round(trackProgress)}%`}</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        background: `linear-gradient(90deg, ${currentSong.accent}, ${mood.accent})`,
                        width: `${trackProgress}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <aside className="grid gap-5 self-start">
            <section className="rounded-lg border border-white/10 bg-[#071827]/92 p-5 shadow-[0_22px_70px_rgba(0,0,0,0.28)] backdrop-blur">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <SectionLabel icon={Sparkles}>Current Mood</SectionLabel>
                  <div className="mt-2 flex items-center gap-3">
                    <h2 className="text-3xl font-semibold tracking-tight text-white">
                      {mood.label}
                    </h2>
                    <span className="rounded-full bg-white/8 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-[#c7d7e6]">
                      {mood.tag.replace("_", " ")}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-[#9db0c4]">{mood.description}</p>
                </div>
                <span
                  className="mt-2 size-4 rounded-full shadow-[0_0_24px_currentColor]"
                  style={{ background: mood.accent, color: mood.accent }}
                />
              </div>

              <MoodMap mood={mood} />
            </section>

            <CameraPanel face={face} />
            <PhysiologyPanel physiology={physiology} />
          </aside>
        </section>

        {protocolComplete ? (
          <section className="rounded-lg border border-[#32e6c8]/30 bg-[#32e6c8]/10 p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[#32e6c8]">
                  <ShieldCheck className="size-4" />
                  Session complete
                </div>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                  Thank you for rating all tracks.
                </h2>
                <p className="mt-1 text-sm text-[#9db0c4]">
                  The recorded session data is ready to save.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-[#32e6c8] px-4 py-2.5 text-sm font-semibold text-[#020712] shadow-sm transition hover:bg-[#8fffea]"
                  onClick={() => downloadCsv(ratings, protocolId)}
                  type="button"
                >
                  <Download className="size-4" />
                  Save session data
                </button>
                <button
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/8 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-white/14"
                  onClick={resetProtocol}
                  type="button"
                >
                  <RotateCcw className="size-4" />
                  Reset
                </button>
              </div>
            </div>
          </section>
        ) : null}
      </div>

      <IntroModal
        cameraReady={cameraReady}
        catalogRequiresSpotify={catalogRequiresSpotify}
        face={face}
        onConnectHeartSensor={physiology.connectBle}
        onConnectSpotify={spotifyAuth.connect}
        onDisconnectHeartSensor={physiology.disconnect}
        onStart={startSession}
        onStartCamera={face.start}
        onStartMockHeartSensor={physiology.startMock}
        open={!sessionStarted && !protocolComplete}
        physiology={physiology}
        setupReady={setupReady}
        spotifyAuth={spotifyAuth}
        spotifyPlayer={spotifyPlayer}
        trackCount={songs.length}
      />
      <RatingModal
        currentRating={currentRating}
        nextButtonLabel={nextButtonLabel}
        onContinue={advanceProtocol}
        onRate={rateCurrentSong}
        open={ratingPromptOpen}
        song={currentSong}
      />
    </main>
  );
}
