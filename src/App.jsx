import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Camera,
  CheckCircle2,
  Download,
  Lock,
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

const TRACKS_PER_BLOCK = 5;
const LISTENING_WINDOW_SECONDS = 18;
const MEDIAPIPE_VERSION = "0.10.35";
const FACE_BASELINE_FRAMES = 18;
const FACE_EMA_ALPHA = 0.34;
const FACE_SWITCH_MARGIN = 0.07;

const SPOTIFY_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? "";
const SPOTIFY_REDIRECT_URI =
  import.meta.env.VITE_SPOTIFY_REDIRECT_URI ??
  (typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}` : "");

const RATING_LABELS = {
  1: "Not a match",
  2: "Slight match",
  3: "Good match",
  4: "Very good match",
};

const PROTOCOL_BLOCKS = [{ mode: "random" }, { mode: "vibe" }];

const EMOTION_QUADRANTS = {
  happy: {
    label: "Happy",
    tag: "happy",
    accent: "#22c55e",
    valence: 0.82,
    energy: 0.78,
    description: "High valence, high energy",
  },
  relaxed: {
    label: "Relaxed",
    tag: "relaxed",
    accent: "#14b8a6",
    valence: 0.72,
    energy: 0.28,
    description: "High valence, low energy",
  },
  tense: {
    label: "Tense",
    tag: "tense",
    accent: "#f97316",
    valence: 0.28,
    energy: 0.74,
    description: "Low valence, high energy",
  },
  sad_low: {
    label: "Sad-low",
    tag: "sad_low",
    accent: "#818cf8",
    valence: 0.3,
    energy: 0.26,
    description: "Low valence, low energy",
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
    "song_energy",
    "song_instrumentalness",
    "song_speechiness",
    "song_category_source",
    "song_analysis_confidence",
    "song_external_url",
    "song_license_url",
    "detected_expression",
    "detected_expression_label",
    "detected_valence",
    "detected_energy",
    "expression_confidence",
    "face_present",
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

function expressionScore(categories, name) {
  return categories.find((category) => category.categoryName === name)?.score ?? 0;
}

function expressionFeatures(categories) {
  const smile =
    (expressionScore(categories, "mouthSmileLeft") +
      expressionScore(categories, "mouthSmileRight")) /
    2;
  const frown =
    (expressionScore(categories, "mouthFrownLeft") +
      expressionScore(categories, "mouthFrownRight")) /
    2;
  const browDown =
    (expressionScore(categories, "browDownLeft") + expressionScore(categories, "browDownRight")) /
    2;
  const cheekSquint =
    (expressionScore(categories, "cheekSquintLeft") +
      expressionScore(categories, "cheekSquintRight")) /
    2;
  const mouthPress =
    (expressionScore(categories, "mouthPressLeft") +
      expressionScore(categories, "mouthPressRight")) /
    2;
  const mouthPucker = expressionScore(categories, "mouthPucker");

  return {
    happyRaw: smile * 0.78 + cheekSquint * 0.22,
    sadRaw: frown * 0.66 + browDown * 0.2 + mouthPress * 0.08 + mouthPucker * 0.06,
  };
}

function moodFromExpressionScores(happyScore, sadScore, previousTag) {
  let tag = previousTag ?? "happy";

  if (happyScore >= sadScore + FACE_SWITCH_MARGIN) {
    tag = "happy";
  } else if (sadScore >= happyScore + FACE_SWITCH_MARGIN) {
    tag = "sad_low";
  }

  const confidence = clamp(Math.max(Math.abs(happyScore - sadScore), happyScore, sadScore), 0, 1);
  const valence =
    tag === "happy"
      ? clamp(0.62 + happyScore * 0.32, 0.55, 0.95)
      : clamp(0.38 - sadScore * 0.3, 0.05, 0.45);
  const energy =
    tag === "happy"
      ? clamp(0.58 + happyScore * 0.28, 0.52, 0.9)
      : clamp(0.36 - sadScore * 0.14, 0.12, 0.46);

  return {
    ...EMOTION_QUADRANTS[tag],
    valence,
    energy,
    confidence: clamp(confidence, 0, 1),
    facePresent: true,
  };
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

function useFaceExpression() {
  const videoRef = useRef(null);
  const landmarkerRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(null);
  const baselineRef = useRef({ happy: 0, sad: 0, samples: 0 });
  const smoothedScoresRef = useRef({ happy: 0, sad: 0 });
  const lastStableRef = useRef({
    ...EMOTION_QUADRANTS.happy,
    confidence: 0,
    facePresent: false,
  });
  const lastUpdateRef = useRef(0);
  const [state, setState] = useState({
    ...EMOTION_QUADRANTS.happy,
    confidence: 0,
    error: "",
    facePresent: false,
    status: "idle",
  });

  const detect = useCallback(() => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;

    if (video && landmarker && video.readyState >= 2) {
      const now = performance.now();
      if (now - lastUpdateRef.current > 360) {
        lastUpdateRef.current = now;
        const result = landmarker.detectForVideo(video, now);
        const categories = result.faceBlendshapes?.[0]?.categories ?? null;

        if (categories?.length) {
          const features = expressionFeatures(categories);
          const baseline = baselineRef.current;

          if (baseline.samples < FACE_BASELINE_FRAMES) {
            baseline.samples += 1;
            baseline.happy += features.happyRaw;
            baseline.sad += features.sadRaw;
            setState({
              ...lastStableRef.current,
              confidence: baseline.samples / FACE_BASELINE_FRAMES,
              error: "",
              facePresent: true,
              status: "calibrating",
            });
          } else {
            const baselineHappy = baseline.happy / baseline.samples;
            const baselineSad = baseline.sad / baseline.samples;
            const happyEvidence = clamp(
              (features.happyRaw - baselineHappy) * 2.8 + features.happyRaw * 0.65,
              0,
              1,
            );
            const sadEvidence = clamp(
              (features.sadRaw - baselineSad) * 3.1 +
                features.sadRaw * 0.8 -
                features.happyRaw * 0.25,
              0,
              1,
            );
            const smoothedScores = smoothedScoresRef.current;
            smoothedScores.happy =
              smoothedScores.happy * (1 - FACE_EMA_ALPHA) + happyEvidence * FACE_EMA_ALPHA;
            smoothedScores.sad =
              smoothedScores.sad * (1 - FACE_EMA_ALPHA) + sadEvidence * FACE_EMA_ALPHA;
            const nextMood = moodFromExpressionScores(
              smoothedScores.happy,
              smoothedScores.sad,
              lastStableRef.current.tag,
            );
            const stableMood = nextMood.confidence >= 0.12 ? nextMood : lastStableRef.current;
            lastStableRef.current = stableMood;
            setState({ ...stableMood, error: "", status: "ready" });
          }
        } else {
          setState((current) => ({
            ...lastStableRef.current,
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
      setState((current) => ({ ...current, error: "", status: "loading" }));

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          height: { ideal: 360 },
          width: { ideal: 480 },
        },
      });

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
        error:
          error?.name === "NotAllowedError"
            ? "Camera permission was blocked."
            : "Camera expression detection could not start.",
        status: "error",
      }));
    }
  }, [detect]);

  const stop = useCallback(() => {
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    landmarkerRef.current?.close?.();
  }, []);

  useEffect(() => stop, [stop]);

  return {
    ...state,
    start,
    videoRef,
  };
}

function SectionLabel({ children, icon: Icon }) {
  return (
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
      <Icon className="size-4 text-teal-600" />
      {children}
    </div>
  );
}

function MoodMap({ mood }) {
  const x = clamp(mood.valence * 100, 8, 92);
  const y = clamp(100 - mood.energy * 100, 8, 92);

  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(248,113,113,0.12),rgba(20,184,166,0.14)),linear-gradient(0deg,rgba(148,163,184,0.08),rgba(250,204,21,0.18))]" />
      <div className="absolute inset-5 rounded-lg border border-slate-200/70" />
      <div className="absolute left-5 right-5 top-1/2 h-px bg-slate-300/60" />
      <div className="absolute bottom-5 top-5 left-1/2 w-px bg-slate-300/60" />
      <div
        className="absolute size-5 rounded-full border-[3px] border-white shadow-[0_10px_32px_rgba(15,23,42,0.24)] transition-all duration-500"
        style={{
          background: mood.accent,
          left: `${x}%`,
          top: `${y}%`,
          transform: "translate(-50%, -50%)",
        }}
      />
      <span className="absolute left-1/2 top-3 -translate-x-1/2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        High energy
      </span>
      <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        Low energy
      </span>
      <span className="absolute left-2 top-1/2 -translate-y-1/2 -rotate-90 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        Low valence
      </span>
      <span className="absolute right-2 top-1/2 -translate-y-1/2 rotate-90 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        High valence
      </span>
    </div>
  );
}

function CoverArt({ isPlaying, song }) {
  if (song.albumImageUrl) {
    return (
      <div className="relative aspect-square overflow-hidden rounded-lg border border-white/70 shadow-[0_24px_70px_rgba(15,23,42,0.18)]">
        <img alt="" className="h-full w-full object-cover" src={song.albumImageUrl} />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/70 to-transparent p-5 text-white">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] opacity-80">
            {song.quadrant.replace("_", " ")}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative aspect-square overflow-hidden rounded-lg border border-white/70 shadow-[0_24px_70px_rgba(15,23,42,0.18)]"
      style={{
        background: `linear-gradient(135deg, ${song.palette[0]} 0%, ${song.palette[1]} 52%, ${song.palette[2]} 100%)`,
      }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(255,255,255,0.78),transparent_34%),linear-gradient(120deg,rgba(255,255,255,0.28),transparent_44%,rgba(15,23,42,0.18))]" />
      <div className="absolute -left-1/4 top-0 h-full w-2/3 rotate-12 bg-white/30 blur-2xl animate-sweep" />
      <div className="absolute bottom-8 left-8 right-8">
        <div className="mb-5 flex items-end gap-2">
          {[42, 68, 52, 82, 38, 72, 56].map((height, index) => (
            <span
              className="w-full rounded-full bg-white/75 shadow-sm"
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
        <div className="flex items-center justify-between border-t border-white/60 pt-4 text-white">
          <span className="text-xs font-bold uppercase tracking-[0.18em]">{song.quadrant}</span>
          <span className="text-xs font-bold uppercase tracking-[0.18em]">
            {Math.round(song.valence * 100)}V/{Math.round(song.energy * 100)}E
          </span>
        </div>
      </div>
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
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <SectionLabel icon={Camera}>Expression signal</SectionLabel>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          {statusLabel}
        </span>
      </div>
      <div className="overflow-hidden rounded-lg bg-slate-950">
        <video
          aria-label="Local camera preview"
          className="aspect-video w-full scale-x-[-1] object-cover opacity-90"
          muted
          playsInline
          ref={face.videoRef}
        />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Expression
          </div>
          <div className="mt-1 text-xl font-semibold text-slate-950">{face.label}</div>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Confidence
          </div>
          <div className="mt-1 text-xl font-semibold text-slate-950">
            {Math.round(face.confidence * 100)}%
          </div>
        </div>
      </div>
      {face.error ? <p className="mt-3 text-sm text-rose-600">{face.error}</p> : null}
    </section>
  );
}

function SetupStep({ children, complete, icon: Icon, title }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start gap-3">
        <div
          className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
            complete ? "bg-teal-100 text-teal-700" : "bg-white text-slate-500"
          }`}
        >
          {complete ? <CheckCircle2 className="size-5" /> : <Icon className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-slate-950">{title}</div>
          <div className="mt-1 text-sm leading-5 text-slate-600">{children}</div>
        </div>
      </div>
    </div>
  );
}

function IntroModal({
  cameraReady,
  catalogRequiresSpotify,
  face,
  onConnectSpotify,
  onStart,
  onStartCamera,
  open,
  setupReady,
  spotifyAuth,
  spotifyPlayer,
  trackCount,
}) {
  if (!open) return null;

  const spotifyReady = !catalogRequiresSpotify || spotifyPlayer.ready;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/75 px-4 py-6 backdrop-blur-md">
      <section
        aria-modal="true"
        className="w-full max-w-3xl rounded-lg border border-white/80 bg-white p-5 shadow-[0_28px_90px_rgba(15,23,42,0.18)]"
        role="dialog"
      >
        <div className="relative aspect-[16/7] overflow-hidden rounded-lg bg-[linear-gradient(135deg,#ecfeff_0%,#f0fdf4_48%,#fff7ed_100%)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_24%_24%,rgba(255,255,255,0.9),transparent_28%),radial-gradient(circle_at_74%_66%,rgba(255,255,255,0.68),transparent_34%)]" />
          <div className="absolute bottom-8 left-8 right-8 flex items-end gap-2">
            {[38, 76, 48, 88, 58, 72, 44, 66].map((height, index) => (
              <span
                className="w-full rounded-full bg-white/80 shadow-sm"
                key={height}
                style={{
                  animation: `soft-pulse ${2.1 + index * 0.13}s ease-in-out infinite`,
                  height: `${height}px`,
                }}
              />
            ))}
          </div>
          <div className="absolute left-6 top-6 rounded-full bg-white/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-teal-700 shadow-sm">
            Validation protocol
          </div>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_0.9fr]">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-slate-950">
              Listen first, rate after each track.
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              The camera estimates only a coarse expression signal locally in this browser. Images
              are not saved. The detector uses a short baseline calibration and then distinguishes
              only Happy versus Sad-low for the adaptive block.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                className="inline-flex items-center justify-center rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={!setupReady}
                onClick={onStart}
                type="button"
              >
                Start session
              </button>
              <span className="text-sm text-slate-500">{trackCount} tracks in catalog</span>
            </div>
          </div>

          <div className="grid gap-3">
            <SetupStep complete={cameraReady} icon={Camera} title="Camera signal">
              <div className="flex items-center justify-between gap-3">
                <span>
                  {cameraReady
                    ? "Expression detection is ready."
                    : face.error || "Optional: enable local expression detection."}
                </span>
                {!cameraReady ? (
                  <button
                    className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm transition hover:bg-slate-100"
                    onClick={onStartCamera}
                    type="button"
                  >
                    Enable
                  </button>
                ) : null}
              </div>
            </SetupStep>
            <SetupStep complete={spotifyReady} icon={Lock} title="Playback source">
              <div className="flex items-center justify-between gap-3">
                <span>
                  {!catalogRequiresSpotify
                    ? "Real instrumental playback is ready."
                    : spotifyPlayer.ready
                      ? "Spotify playback device is connected."
                      : spotifyAuth.error || spotifyPlayer.error || "Connect Spotify Premium playback."}
                </span>
                {catalogRequiresSpotify && !spotifyAuth.authenticated ? (
                  <button
                    className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm transition hover:bg-slate-100"
                    onClick={onConnectSpotify}
                    type="button"
                  >
                    Connect
                  </button>
                ) : null}
              </div>
            </SetupStep>
          </div>
        </div>
      </section>
    </div>
  );
}

function RatingModal({ currentRating, nextButtonLabel, onContinue, onRate, open, song }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-sm">
      <section
        aria-modal="true"
        className="w-full max-w-xl rounded-lg border border-slate-200 bg-white p-6 shadow-[0_28px_90px_rgba(15,23,42,0.24)]"
        role="dialog"
      >
        <SectionLabel icon={BarChart3}>Rating required</SectionLabel>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
          How well did this song match your mood?
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          You just listened to <span className="font-semibold text-slate-700">{song.title}</span>.
          Select one rating to continue.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[1, 2, 3, 4].map((score) => {
            const active = currentRating?.rating_1_to_4 === score;

            return (
              <button
                className={`rounded-lg border px-2 py-3 text-center transition ${
                  active
                    ? "border-slate-950 bg-slate-950 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white"
                }`}
                key={score}
                onClick={() => onRate(score)}
                type="button"
              >
                <span className="block text-xl font-bold">{score}</span>
                <span className="mt-1 block text-xs font-semibold leading-tight">
                  {RATING_LABELS[score]}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-500">1 = not a match, 4 = very good mood match.</p>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
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

  const mode = PROTOCOL_BLOCKS[currentBlockIndex].mode;
  const mood = face;
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
  const cameraReady = face.status === "ready" || face.status === "searching";
  const playbackReady = !catalogRequiresSpotify || spotifyPlayerReady;
  const setupReady = playbackReady;
  const isFallbackCatalog = catalogSource === "real-instrumental-demo" || catalogSource === "legacy";

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
              ? "Real instrumental demo track is playing."
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
    setSessionStarted(true);
    setIsPlaying(true);
    setTrackProgress(0);

    if (!currentSong.spotifyUri) {
      playDemoSong(currentSong).then((played) => {
        setPlaybackNotice(
          played
            ? currentSong.audioUrl
              ? "Real instrumental demo track is playing."
              : "Demo audio is generated locally until Spotify tracks are imported."
            : "Demo audio could not start in this browser.",
        );
      });
    }
  }

  function moveToSong(song) {
    setHistory((items) => [...items.slice(-8), currentSong]);
    setCurrentSong(song);
    setTrialId((value) => value + 1);
    setQueueSeed((value) => value + 19);
    setTrackProgress(0);
    setRatingPromptOpen(false);
    setIsPlaying(sessionStarted);
  }

  function advanceProtocol() {
    if (!currentRating || protocolComplete) return;

    const nextSong = queue[0] ?? songs[0];
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
        mood,
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
        song_energy: currentSong.energy,
        song_instrumentalness: currentSong.instrumentalness,
        song_speechiness: currentSong.speechiness,
        song_category_source: currentSong.categorySource,
        song_analysis_confidence: currentSong.analysisConfidence,
        song_external_url: currentSong.externalUrl,
        song_license_url: currentSong.licenseUrl,
        detected_expression: mood.tag,
        detected_expression_label: mood.label,
        detected_valence: mood.valence,
        detected_energy: mood.energy,
        expression_confidence: Number(mood.confidence.toFixed(3)),
        face_present: mood.facePresent,
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
      <main className="flex min-h-screen items-center justify-center bg-[#f7f8fb] px-4 text-slate-900">
        <section className="max-w-lg rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
          <SectionLabel icon={Waves}>Catalog missing</SectionLabel>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
            No tracks are available.
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Run <span className="font-mono">npm run spotify:catalog</span> with Spotify credentials
            or <span className="font-mono">npm run jamendo:catalog</span> with a Jamendo Client ID
            to generate the track catalog.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f8fb] text-slate-900">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(135deg,#ffffff_0%,#f8fbff_38%,#eef8f4_68%,#fff8ed_100%)]" />
      <div className="pointer-events-none fixed inset-x-0 top-0 h-56 bg-[linear-gradient(180deg,rgba(20,184,166,0.12),rgba(255,255,255,0))]" />

      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <header className="rounded-lg border border-white/80 bg-white/75 p-5 shadow-sm backdrop-blur-xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">
                <Radio className="size-3.5" />
                Blinded validation protocol
              </div>
              <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
                Vibe Shuffle
              </h1>
              <p className="mt-3 max-w-2xl text-base text-slate-600 sm:text-lg">
                Music that adapts to your emotional state.
              </p>
            </div>
            <div className="min-w-56 rounded-lg bg-slate-100 p-3">
              <div className="flex items-center justify-between text-sm font-semibold text-slate-600">
                <span>Session progress</span>
                <span>{completedTrials}/{totalTrials}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-teal-600 transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          </div>
        </header>

        {isFallbackCatalog ? (
          <section className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800">
            Real instrumental fallback loaded. Run{" "}
            <span className="font-mono">npm run jamendo:catalog</span> to replace it with a
            Jamendo-derived 100-track instrumental pool.
          </section>
        ) : null}

        <section className="grid gap-5 lg:grid-cols-[1.42fr_0.78fr]">
          <section className="overflow-hidden rounded-lg border border-white/80 bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.10)]">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <SectionLabel icon={Waves}>Listening</SectionLabel>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                  Stay with the music
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  The rating prompt appears automatically when the listening window ends.
                </p>
              </div>
              <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600">
                Track {completedTrials + 1}/{totalTrials}
              </div>
            </div>

            <div className="grid gap-7 xl:grid-cols-[0.74fr_1fr]">
              <CoverArt isPlaying={isPlaying} song={currentSong} />

              <div className="flex min-h-full flex-col justify-center gap-6">
                <div>
                  <div className="mb-4 inline-flex rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-teal-700">
                    Now playing
                  </div>
                  <h3 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
                    {currentSong.title}
                  </h3>
                  <p className="mt-2 text-lg text-slate-500">{currentSong.artist}</p>
                  {currentSong.album ? (
                    <p className="mt-1 text-sm text-slate-400">{currentSong.album}</p>
                  ) : null}
                </div>

                <div className="rounded-lg bg-slate-50 p-5">
                  <div className="mb-3 flex items-center justify-between text-sm font-semibold text-slate-500">
                    <span>Listening window</span>
                    <span>{ratingPromptOpen ? "Ready to rate" : formatSeconds(remainingSeconds)}</span>
                  </div>
                  <div className="mb-5 h-3 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        background: `linear-gradient(90deg, ${currentSong.accent}, ${mood.accent})`,
                        width: `${trackProgress}%`,
                      }}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      aria-label={isPlaying ? "Pause" : "Play"}
                      className="flex size-16 items-center justify-center rounded-full bg-slate-950 text-white shadow-lg transition hover:scale-[1.03] disabled:cursor-not-allowed disabled:bg-slate-300"
                      disabled={!sessionStarted || protocolComplete || ratingPromptOpen}
                      onClick={togglePlayback}
                      type="button"
                    >
                      {isPlaying ? <Pause className="size-7" /> : <Play className="size-7" />}
                    </button>
                    <div className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-500 shadow-sm">
                      {ratingPromptOpen ? "Please rate this track" : isPlaying ? "Playing" : "Paused"}
                    </div>
                  </div>
                  {playbackNotice || spotifyPlayerError || demoAudioError ? (
                    <p className="mt-3 text-sm text-slate-500">
                      {spotifyPlayerError || demoAudioError || playbackNotice}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </section>

          <div className="grid gap-5">
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <SectionLabel icon={Sparkles}>Current Mood</SectionLabel>
                  <div className="mt-2 flex items-center gap-3">
                    <h2 className="text-3xl font-semibold tracking-tight text-slate-950">
                      {mood.label}
                    </h2>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                      {mood.tag.replace("_", " ")}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-500">{mood.description}</p>
                </div>
                <span
                  className="mt-2 size-4 rounded-full shadow-[0_0_24px_currentColor]"
                  style={{ background: mood.accent, color: mood.accent }}
                />
              </div>

              <MoodMap mood={mood} />
            </section>

            <CameraPanel face={face} />
          </div>
        </section>

        {protocolComplete ? (
          <section className="rounded-lg border border-teal-200 bg-teal-50 p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-teal-700">
                  <ShieldCheck className="size-4" />
                  Session complete
                </div>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                  Thank you for rating all tracks.
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  The recorded session data is ready to save.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
                  onClick={() => downloadCsv(ratings, protocolId)}
                  type="button"
                >
                  <Download className="size-4" />
                  Save session data
                </button>
                <button
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
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
        onConnectSpotify={spotifyAuth.connect}
        onStart={startSession}
        onStartCamera={face.start}
        open={!sessionStarted && !protocolComplete}
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
