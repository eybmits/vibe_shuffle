import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Camera,
  CheckCircle2,
  Clock3,
  Download,
  HeartPulse,
  Music2,
  Pause,
  Play,
  ArrowRight,
  RotateCcw,
  ScanFace,
  ShieldCheck,
  SkipForward,
  Sparkles,
} from "lucide-react";
import {
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
import { EMOTION_QUADRANTS, buildDemoLibrary } from "./spotifyLibrary.js";
import heroListener from "./assets/hero-listener.webp";

const TRACKS_PER_BLOCK = 5;
const LISTENING_WINDOW_SECONDS = 60;
const CALIBRATION_SECONDS = 14;
const MEDIAPIPE_VERSION = "0.10.35";

const SPOTIFY_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? "";
const SPOTIFY_REDIRECT_URI =
  import.meta.env.VITE_SPOTIFY_REDIRECT_URI ??
  (typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}` : "");
// Bump to force a fresh login whenever the requested OAuth scopes change, so
// stored tokens can never lack newly required permissions (e.g. library read).
const SPOTIFY_TOKEN_STORAGE_KEY = "vibe_shuffle_spotify_token_v3";

const RATING_SCORES = [1, 2, 3, 4, 5];

// Two separate 7-point Likert questions per track, asked in sequence.
const LIKING_QUESTION = {
  key: "rating_like_1_to_5",
  title: "How much do you like this song?",
  lowLabel: "Don't like it",
  highLabel: "Love it",
};
const FIT_QUESTION = {
  key: "rating_fit_1_to_5",
  title: "How well did it fit your current mood?",
  lowLabel: "Not at all",
  highLabel: "Perfect fit",
};

const BLOCK_COUNT = 2;

function randomBlockOrder() {
  return Math.random() < 0.5 ? ["random", "vibe"] : ["vibe", "random"];
}

const GLASS_CARD =
  "rounded-3xl border border-white/10 bg-white/[0.04] shadow-[0_30px_90px_rgba(0,0,0,0.45)] backdrop-blur-xl";
const ACCENT_GRADIENT = "bg-gradient-to-r from-cyan-400 to-violet-500";
const ACCENT_TEXT_GRADIENT =
  "bg-gradient-to-r from-cyan-300 via-sky-300 to-violet-400 bg-clip-text text-transparent";

// The four mood quadrants the hero headline cycles through.
const MOODS = [
  { key: "relaxed", label: "Calm", accent: "#22d3ee" },
  { key: "happy", label: "Energy", accent: "#34d399" },
  { key: "tense", label: "Tension", accent: "#fb923c" },
  { key: "sad_low", label: "Melancholy", accent: "#a78bfa" },
];

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// Fresh seed per session/restart so song selection never repeats an order.
const randomSeed = () => Math.floor(Math.random() * 1_000_000) + 1;

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

// Only the columns needed to validate Vibe vs Random mood-fit.
const CSV_COLUMNS = [
  "protocol_id",
  "timestamp",
  "block_order",
  "block_number",
  "block_mode",
  "track_number",
  "song_id",
  "spotify_id",
  "song_title",
  "artist",
  "song_quadrant",
  "song_valence",
  "song_arousal",
  "face_present",
  "ecg_connected",
  "physiology_quality",
  "detected_valence",
  "detected_arousal",
  "physiology_arousal",
  "rating_like_1_to_5",
  "rating_fit_1_to_5",
];

function ratingsToCsv(ratings) {
  const rows = ratings.map((rating) =>
    CSV_COLUMNS.map((column) => csvEscape(rating[column])).join(","),
  );

  return [CSV_COLUMNS.join(","), ...rows].join("\n");
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
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
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

function buildHeartRateCurve(samples, width = 320, height = 96) {
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

function deterministicScore(id, seed) {
  let hash = seed * 97;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 9973;
  }
  return hash / 9973;
}

function rankSongs(songs, mode, mood, currentSongId, seed, recentIds) {
  const available = songs.filter((song) => song.id !== currentSongId);
  const isAdaptiveMode = mode === "vibe";
  // Vibe = random draw restricted to the mood-congruent quadrant; Random = random
  // draw from the whole pool. Both are random; the only manipulated variable is
  // the sector constraint. A large recent penalty avoids near-term repeats.
  const vibePool = available.filter((song) => song.quadrant === mood.tag);
  const pool = isAdaptiveMode && vibePool.length ? vibePool : available;

  return pool
    .map((song) => {
      const recentPenalty = recentIds.includes(song.id) ? 10 : 0;
      const randomScore = deterministicScore(song.id, seed);
      const distance = Math.hypot(song.valence - mood.valence, song.energy - mood.energy);

      return {
        ...song,
        score: randomScore + recentPenalty,
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
  const facePresent = Boolean(expressionState?.facePresent);

  return {
    ...style,
    confidence: facePresent ? Number(expressionState?.confidence ?? 0) : 0,
    description: facePresent ? style.description : "Face not detected",
    energy: facePresent ? Number(expressionState?.energy ?? style.energy) : 0.5,
    facePresent,
    label: facePresent ? style.label : "Waiting",
    sampleCount: Number(expressionState?.sampleCount ?? 0),
    scores: expressionState?.scores ?? initialExpressionScores(),
    valence: facePresent ? Number(expressionState?.valence ?? style.valence) : 0.5,
  };
}

function signalStateToMood(signalState) {
  return expressionStateToMood({
    confidence: signalState?.confidence ?? 0,
    energy: signalState?.energy,
    facePresent: Boolean(signalState?.facePresent),
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
    const raw = localStorage.getItem(SPOTIFY_TOKEN_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStoredToken(tokenPayload) {
  localStorage.setItem(SPOTIFY_TOKEN_STORAGE_KEY, JSON.stringify(tokenPayload));
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
      localStorage.removeItem(SPOTIFY_TOKEN_STORAGE_KEY);
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
      // Always show the account dialog so a wrong account can be switched.
      show_dialog: "true",
      // Playback only — the app plays a fixed curated set, it does not read the
      // user's library.
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
    localStorage.removeItem(SPOTIFY_TOKEN_STORAGE_KEY);
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
    window.onSpotifyWebPlaybackSDKReady = () => {
      if (window.Spotify) {
        resolve();
      }
    };

    if (existing) {
      const fallback = window.setTimeout(() => {
        if (window.Spotify) {
          resolve();
          return;
        }
        reject(new Error("Spotify SDK did not initialize after script load."));
      }, 15000);

      existing.addEventListener(
        "load",
        () => {
          window.clearTimeout(fallback);
          resolve();
        },
        { once: true },
      );

      return;
    }

    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    script.onerror = () => reject(new Error("Spotify SDK failed to load."));
    const timeout = window.setTimeout(() => {
      reject(new Error("Spotify SDK did not initialize in time."));
    }, 15000);

    script.onload = () => {
      window.clearTimeout(timeout);
      if (window.Spotify) {
        resolve();
      }
    };
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
          setState((current) => ({ ...current, deviceId: null, ready: false, status: "idle" }));
        });
        player.addListener("initialization_error", ({ message }) => {
          setState((current) => ({ ...current, error: message, status: "error" }));
        });
        player.addListener("authentication_error", ({ message }) => {
          setState((current) => ({ ...current, error: message, status: "error" }));
        });
        player.addListener("account_error", () => {
          setState((current) => ({
            ...current,
            error:
              "Spotify playback was rejected. This account needs Spotify Premium AND must be added under User Management in the app's Spotify Developer Dashboard.",
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

  const transferToActiveDevice = useCallback(
    async (deviceId) => {
      const token = await ensureToken();
      if (!token) return false;

      const response = await fetch("https://api.spotify.com/v1/me/player", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          device_ids: [deviceId],
          play: false,
        }),
      });

      if (!response.ok) {
        const payload = await response.text().catch(() => "");
        if (response.status === 403) {
          setState((current) => ({
            ...current,
            error:
              "Spotify playback permission denied. Verify premium and playback scopes.",
          }));
        } else if (response.status === 404) {
          setState((current) => ({
            ...current,
            error: "Spotify player device not found. Reload Spotify or reconnect.",
          }));
        } else {
          setState((current) => ({
            ...current,
            error: payload || "Could not switch Spotify to this web playback device.",
          }));
        }
        return false;
      }

      return true;
    },
    [ensureToken],
  );

  // Poll the SDK until it reports the expected track actually playing (not
  // paused). Some browsers accept the play request (HTTP 204) but leave the
  // audio element suspended, so we must confirm and recover.
  const waitForStarted = useCallback(async (expectedUri, timeoutMs) => {
    const player = playerRef.current;
    if (!player) return false;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const current = await player.getCurrentState().catch(() => null);
      if (
        current &&
        !current.paused &&
        current.track_window?.current_track?.uri === expectedUri
      ) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return false;
  }, []);

  const playTrack = useCallback(
    async (spotifyUri) => {
      if (!spotifyUri || !state.deviceId) return false;
      const token = await ensureToken();
      if (!token) return false;

      // Unlock the SDK audio element (Safari/iOS need this; harmless elsewhere).
      try {
        await playerRef.current?.activateElement?.();
      } catch {
        // best effort
      }

      const playBody = JSON.stringify({ uris: [spotifyUri], position_ms: 0 });
      const tryPlay = () =>
        fetch(`https://api.spotify.com/v1/me/player/play?device_id=${state.deviceId}`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: playBody,
        });

      let response = await tryPlay();

      if (response.status === 404) {
        // The web player is not registered as the active device yet — claim it once, retry.
        const transferred = await transferToActiveDevice(state.deviceId);
        if (!transferred) return false;
        response = await tryPlay();
      }

      if (!response.ok) {
        const payload = await response.text().catch(() => "");
        const message =
          response.status === 403
            ? "Spotify playback permission denied. Premium is required for web playback."
            : response.status === 404
              ? "Spotify playback device not found. Reconnect Spotify and try again."
              : payload || "Spotify could not start this track.";
        setState((current) => ({ ...current, error: message }));
        return false;
      }

      // Confirm audio actually started; recover the silent-but-accepted case the
      // same way a manual pause→play would (resume, then re-issue play).
      let started = await waitForStarted(spotifyUri, 2500);
      if (!started) {
        try {
          await playerRef.current?.resume();
        } catch {
          // best effort
        }
        started = await waitForStarted(spotifyUri, 1200);
      }
      if (!started) {
        await tryPlay().catch(() => {});
        await waitForStarted(spotifyUri, 1200);
      }

      setState((current) => ({ ...current, error: "" }));
      return true;
    },
    [ensureToken, state.deviceId, transferToActiveDevice, waitForStarted],
  );

  const pause = useCallback(async () => {
    try {
      await playerRef.current?.pause();
      return true;
    } catch {
      setState((current) => ({ ...current, error: "Spotify could not pause playback." }));
      return false;
    }
  }, []);

  const resume = useCallback(async () => {
    try {
      await playerRef.current?.resume();
      return true;
    } catch {
      setState((current) => ({ ...current, error: "Spotify could not resume playback." }));
      return false;
    }
  }, []);

  return {
    ...state,
    pause,
    playTrack,
    resume,
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
  const motionCanvasRef = useRef(null);
  const previousLuminanceRef = useRef(null);
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

  // The preview <video> remounts between the setup and session screens, so the
  // ref re-attaches the active stream whenever a new node appears.
  const setVideoRef = useCallback((node) => {
    videoRef.current = node;
    if (node && streamRef.current) {
      node.srcObject = streamRef.current;
      node.play().catch(() => {});
    }
  }, []);

  // Mean luminance change across a downscaled frame: captures any movement in
  // the camera (body swaying, dancing, hands), not just facial landmarks.
  const measureFrameMotion = useCallback((video) => {
    try {
      const canvas = (motionCanvasRef.current ??= document.createElement("canvas"));
      if (!canvas.width) {
        canvas.width = 32;
        canvas.height = 24;
      }
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      const previous = previousLuminanceRef.current;
      const luminance = new Float32Array(canvas.width * canvas.height);
      let diffSum = 0;

      for (let index = 0; index < luminance.length; index += 1) {
        const offset = index * 4;
        luminance[index] = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
        if (previous) diffSum += Math.abs(luminance[index] - previous[index]);
      }

      previousLuminanceRef.current = luminance;
      return previous ? diffSum / luminance.length / 255 : 0;
    } catch {
      return 0;
    }
  }, []);

  const detect = useCallback(() => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;

    if (video && landmarker && video.readyState >= 2) {
      const now = performance.now();
      if (now - lastUpdateRef.current > FACE_SAMPLE_INTERVAL_MS) {
        lastUpdateRef.current = now;
        const result = landmarker.detectForVideo(video, now);
        const categories = result.faceBlendshapes?.[0]?.categories ?? null;
        // Nose-tip landmark feeds nodding detection; frame differencing feeds
        // the whole-body motion channel.
        const noseTip = result.faceLandmarks?.[0]?.[1] ?? null;
        const frameMotion = measureFrameMotion(video);

        if (categories?.length) {
          const update = updateExpressionTracker(
            trackerRef.current,
            categories,
            noseTip
              ? { intensity: frameMotion, timestamp: Date.now(), x: noseTip.x, y: noseTip.y }
              : null,
          );
          trackerRef.current = update.tracker;

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
            ...expressionStateToMood({
              confidence: 0,
              energy: 0.5,
              facePresent: false,
              scores: current.scores ?? initialExpressionScores(),
              tag: "relaxed",
              valence: 0.5,
            }),
            error: "",
            facePresent: false,
            sample: null,
            status: "searching",
          }));
        }
      }
    }

    frameRef.current = window.requestAnimationFrame(detect);
  }, [measureFrameMotion]);

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

  // Preview-only attach for secondary video elements (e.g. the calibration
  // card): shows the live stream without taking over the detection ref.
  const attachPreview = useCallback((node) => {
    if (node && streamRef.current) {
      node.srcObject = streamRef.current;
      node.play().catch(() => {});
    }
  }, []);

  // Lock the current (neutral) smoothed scores as the personal baseline so the
  // first trial already reads deviations from this participant's resting face.
  const snapshotBaseline = useCallback(() => {
    const tracker = trackerRef.current;
    if (!tracker?.smoothedScores) return;
    tracker.baselineScores = {
      happy: tracker.smoothedScores.happy ?? 0,
      sad_low: tracker.smoothedScores.sad_low ?? 0,
      tense: tracker.smoothedScores.tense ?? 0,
    };
  }, []);

  useEffect(() => stop, [stop]);

  return {
    ...state,
    attachPreview,
    setVideoRef,
    snapshotBaseline,
    start,
  };
}

function createMockHeartRateMeasurement(index) {
  // Slow ~31s wave swinging clearly above and below the ~73 bpm baseline, so the
  // demo arousal moves both up and down (not just up). Variability is coupled
  // inversely to heart rate (high HR → low RMSSD → high arousal, and vice versa).
  const wave = Math.sin(index / 5);
  const heartRateBpm = Math.round(73 + wave * 16);
  const baseRr = 60000 / heartRateBpm;
  const spread = 6 + 30 * (1 - wave); // small spread at high HR, large at low HR
  const rrIntervalsMs = [baseRr + spread, baseRr - spread];

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

function AuroraBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
      {/* faint grid for depth, masked to fade toward the edges */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          maskImage: "radial-gradient(ellipse at center, black 35%, transparent 80%)",
          WebkitMaskImage: "radial-gradient(ellipse at center, black 35%, transparent 80%)",
        }}
      />
      <div className="absolute -left-48 -top-48 size-[560px] rounded-full bg-cyan-400/12 blur-[150px] animate-aurora" />
      <div className="absolute -right-40 top-1/4 size-[520px] rounded-full bg-violet-500/14 blur-[150px] animate-aurora-slow" />
      <div className="absolute -bottom-56 left-1/3 size-[620px] rounded-full bg-indigo-500/10 blur-[160px] animate-aurora" />
    </div>
  );
}

// Five vertical bars whose relative heights give the mark its waveform shape;
// each bar breathes on its own timing so the logo feels alive.
const GLYPH_BARS = [0.52, 0.82, 0.36, 1, 0.62];

function WaveGlyph({ size = 40 }) {
  return (
    <span
      aria-hidden="true"
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ height: size, width: size }}
    >
      <span className="absolute inset-0 rounded-full bg-gradient-to-br from-cyan-400/35 to-violet-500/35 blur-md" />
      <svg className="relative" fill="none" style={{ height: size, width: size }} viewBox="0 0 40 40">
        <defs>
          <linearGradient id="vibeGlyphGrad" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="55%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#a78bfa" />
          </linearGradient>
        </defs>
        {GLYPH_BARS.map((scale, index) => {
          const barHeight = 9 + scale * 22;
          return (
            <rect
              className="animate-eq"
              fill="url(#vibeGlyphGrad)"
              height={barHeight}
              key={index}
              rx="1.8"
              style={{
                animationDelay: `${index * 0.13}s`,
                animationDuration: `${1.05 + index * 0.17}s`,
                transformBox: "fill-box",
                transformOrigin: "center",
              }}
              width="3.4"
              x={5 + index * 7.3}
              y={20 - barHeight / 2}
            />
          );
        })}
      </svg>
    </span>
  );
}

// Original hero illustration: a front-facing listener wearing headphones with
// sound waves radiating from each ear cup. Sits semi-transparent behind the
// headline as an atmospheric backdrop (the app reads your face + plays music).
// Hero backdrop: the listener artwork anchored to the right (brain.fm style),
// with dark gradients fading it into the page so the headline stays readable.
function HeroArtwork() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* large artwork bleeding off the right edge (brain.fm style), vertically
          centred and capped to its native size so it never upscales */}
      <div className="absolute inset-y-0 right-0 flex items-center justify-end">
        <img
          alt=""
          className="h-[44vh] w-auto max-h-[740px] max-w-none animate-fade-in opacity-30 sm:h-[66vh] sm:opacity-[0.55]"
          src={heroListener}
          style={{ animationDelay: "120ms" }}
        />
      </div>
      {/* sink the artwork back, especially behind the headline/text on the left */}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,#05060f_0%,rgba(5,6,15,0.95)_34%,rgba(5,6,15,0.55)_58%,transparent_84%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(52%_58%_at_38%_43%,rgba(5,6,15,0.78)_0%,rgba(5,6,15,0.3)_45%,transparent_72%)]" />
      <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-[#05060f] to-transparent" />
      <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-[#05060f] to-transparent" />
    </div>
  );
}

function BrandMark({ compact = false }) {
  return (
    <div className="flex items-center gap-3">
      <WaveGlyph size={compact ? 34 : 46} />
      <div className="leading-none">
        <div
          className={`font-bold lowercase tracking-tight text-white ${compact ? "text-xl" : "text-2xl"}`}
          style={{ letterSpacing: "-0.035em" }}
        >
          vibe
          <span className={ACCENT_TEXT_GRADIENT}> shuffle</span>
          <span className="ml-1 inline-block size-1.5 rounded-full bg-violet-400 align-middle shadow-[0_0_10px_rgba(167,139,250,0.9)] animate-pulse" />
        </div>
        {!compact ? (
          <p className="mt-2 text-sm text-slate-400">Music that adapts to your state of mind.</p>
        ) : null}
      </div>
    </div>
  );
}

function SectionLabel({ children, icon: Icon }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
      <Icon className="size-3.5 text-cyan-300" />
      {children}
    </div>
  );
}

function PrimaryButton({ children, className = "", ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2.5 rounded-full bg-white px-8 py-4 text-sm font-bold uppercase tracking-[0.12em] text-[#05060f] shadow-[0_16px_50px_rgba(255,255,255,0.18)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_60px_rgba(255,255,255,0.3)] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35 disabled:shadow-none disabled:hover:translate-y-0 ${className}`}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

function GhostButton({ children, className = "", ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-5 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-cyan-300/40 hover:bg-white/[0.09] hover:text-white disabled:cursor-not-allowed disabled:border-white/8 disabled:text-white/30 ${className}`}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

function MoodMap({ mood }) {
  const x = clamp(mood.valence * 100, 6, 94);
  const y = clamp(100 - mood.energy * 100, 6, 94);
  const axisLabelClass =
    "text-[8px] font-semibold uppercase tracking-[0.16em] text-slate-500";
  const quadrantLabelClass =
    "pointer-events-none absolute text-[9px] font-semibold uppercase tracking-[0.12em] text-white/45";

  return (
    <div className="w-full">
      <div className={`${axisLabelClass} mb-1.5 text-center`}>High energy (arousal)</div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5">
        <div className={`${axisLabelClass} rotate-180 text-center [writing-mode:vertical-rl]`}>
          Low valence
        </div>
        <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-white/10 bg-[#070a18]">
          <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
            <div className="border-b border-r border-white/8 bg-[radial-gradient(circle_at_30%_30%,rgba(251,146,60,0.10),transparent_70%)]" />
            <div className="border-b border-white/8 bg-[radial-gradient(circle_at_70%_30%,rgba(52,211,153,0.10),transparent_70%)]" />
            <div className="border-r border-white/8 bg-[radial-gradient(circle_at_30%_70%,rgba(167,139,250,0.12),transparent_70%)]" />
            <div className="bg-[radial-gradient(circle_at_70%_70%,rgba(34,211,238,0.10),transparent_70%)]" />
          </div>
          <span className={`${quadrantLabelClass} left-2.5 top-2.5`}>
            {EMOTION_QUADRANTS.tense.label}
          </span>
          <span className={`${quadrantLabelClass} right-2.5 top-2.5`}>
            {EMOTION_QUADRANTS.happy.label}
          </span>
          <span className={`${quadrantLabelClass} bottom-2.5 left-2.5`}>
            {EMOTION_QUADRANTS.sad_low.label}
          </span>
          <span className={`${quadrantLabelClass} bottom-2.5 right-2.5`}>
            {EMOTION_QUADRANTS.relaxed.label}
          </span>
          <div
            className="absolute size-4 rounded-full border-2 border-[#05060f] shadow-[0_0_24px_currentColor] transition-all duration-700"
            style={{
              background: mood.accent,
              color: mood.accent,
              left: `${x}%`,
              top: `${y}%`,
              transform: "translate(-50%, -50%)",
            }}
          />
        </div>
        <div className={`${axisLabelClass} text-center [writing-mode:vertical-rl]`}>
          High valence
        </div>
      </div>
      <div className={`${axisLabelClass} mt-1.5 text-center`}>Low energy (arousal)</div>
    </div>
  );
}

function HeartRateCurve({ physiology, summary }) {
  const samples = physiology.heartRateHistory ?? [];
  const curve = buildHeartRateCurve(samples);
  const hasLiveSamples = samples.length > 0;
  const lastPoint = curve.points.at(-1);

  return (
    <div className="relative h-24">
      <svg
        aria-hidden="true"
        className="h-full w-full overflow-visible"
        preserveAspectRatio="none"
        viewBox="0 0 320 96"
      >
        <defs>
          <linearGradient id="hrCurveStroke" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#a78bfa" />
          </linearGradient>
          <linearGradient id="hrCurveArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={curve.areaPath} fill="url(#hrCurveArea)" opacity={hasLiveSamples ? 1 : 0.3} />
        <path
          d={curve.path}
          fill="none"
          opacity={hasLiveSamples ? 1 : 0.3}
          stroke="url(#hrCurveStroke)"
          strokeDasharray={hasLiveSamples ? "0" : "7 9"}
          strokeLinecap="round"
          strokeWidth="2.5"
        />
        {hasLiveSamples && lastPoint ? (
          <circle className="animate-pulse" cx={lastPoint.x} cy={lastPoint.y} fill="#a78bfa" r="4" />
        ) : null}
      </svg>
      {!hasLiveSamples ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {summary?.ecg_connected ? "Waiting for packets" : "No sensor"}
        </div>
      ) : null}
    </div>
  );
}

function SignalCard({ children, label, icon, status }) {
  return (
    <div
      className={`${GLASS_CARD} flex flex-col gap-3 p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-white/20 hover:shadow-[0_30px_90px_rgba(34,211,238,0.12)]`}
    >
      <div className="flex items-center justify-between gap-2">
        <SectionLabel icon={icon}>{label}</SectionLabel>
        {status ? (
          <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-300">
            {status}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function SetupStep({ children, complete, index, title }) {
  return (
    <div
      className={`${GLASS_CARD} p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-white/20 hover:shadow-[0_30px_90px_rgba(139,92,246,0.12)]`}
    >
      <div className="flex items-start gap-4">
        <div
          className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
            complete
              ? `${ACCENT_GRADIENT} text-[#05060f]`
              : "border border-white/15 bg-white/[0.04] text-slate-300"
          }`}
        >
          {complete ? <CheckCircle2 className="size-5" /> : index}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-white">{title}</div>
          <div className="mt-1.5 text-sm leading-6 text-slate-400">{children}</div>
        </div>
      </div>
    </div>
  );
}

function SpotifyGlyph({ className = "" }) {
  return (
    <svg aria-hidden="true" className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424a.623.623 0 01-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.623.623 0 11-.277-1.215c3.808-.87 7.076-.495 9.712 1.116a.623.623 0 01.207.856zm1.223-2.722a.78.78 0 01-1.072.257c-2.688-1.652-6.786-2.131-9.965-1.166a.78.78 0 11-.452-1.494c3.632-1.102 8.147-.568 11.232 1.327a.78.78 0 01.257 1.076zm.105-2.835c-3.223-1.914-8.54-2.09-11.618-1.156a.935.935 0 11-.542-1.79c3.533-1.072 9.405-.865 13.116 1.338a.936.936 0 01.319 1.283.934.934 0 01-1.275.325z" />
    </svg>
  );
}

// Accent "Enable" pill used to sell the physiological signals. `pulse` adds a
// living heartbeat to the icon (used for the heart-rate sensor).
function EnableButton({ accent, children, className = "", icon: Icon, pulse = false, ...props }) {
  return (
    <button
      className={`group inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-[#05060f] transition hover:-translate-y-0.5 active:scale-95 ${className}`}
      style={{
        background: `linear-gradient(135deg, ${accent}, ${accent}bb)`,
        boxShadow: `0 12px 34px ${accent}44`,
      }}
      type="button"
      {...props}
    >
      {Icon ? <Icon className={`size-4 ${pulse ? "animate-heartbeat" : ""}`} /> : null}
      {children}
    </button>
  );
}

// A physiological-signal feature card (camera/expression, heart-rate). Sells the
// signal with a glowing icon + a live pulse ring when active.
function SignalFeatureCard({ accent, active, children, description, icon: Icon, statusText, tag, title }) {
  return (
    <div
      className={`${GLASS_CARD} relative overflow-hidden p-5 transition-all duration-300 hover:-translate-y-1`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-12 size-36 rounded-full blur-3xl transition-opacity duration-500"
        style={{ background: `${accent}33`, opacity: active ? 1 : 0.45 }}
      />
      <div className="relative flex items-start gap-4">
        <div className="relative size-12 shrink-0">
          {active ? (
            <span
              aria-hidden="true"
              className="absolute inset-0 animate-pulse-ring rounded-2xl"
              style={{ boxShadow: `0 0 0 2px ${accent}` }}
            />
          ) : null}
          <span
            className="relative flex size-12 items-center justify-center rounded-2xl border"
            style={{ background: `${accent}1f`, borderColor: `${accent}55`, color: accent }}
          >
            <Icon className="size-6" />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-white">{title}</span>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
              style={{ background: `${accent}1f`, color: accent }}
            >
              {tag}
            </span>
          </div>
          <p className="mt-1.5 text-sm leading-6 text-slate-400">
            {active ? statusText : description}
          </p>
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

// A single label/value row inside a signal preview card.
function SignalMetric({ badge, badgeStyle, label, value, valueClass = "text-white" }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`text-sm font-semibold ${valueClass}`}>{value}</span>
        {badge ? (
          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={badgeStyle}>
            {badge}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// A small static ECG/heartbeat sparkline.
function EcgLine({ color }) {
  return (
    <svg
      aria-hidden="true"
      className="my-1 h-8 w-full"
      fill="none"
      preserveAspectRatio="none"
      viewBox="0 0 200 40"
    >
      <polyline
        points="0,20 28,20 36,9 44,31 52,20 92,20 100,13 108,27 116,20 152,20 160,7 168,33 176,20 200,20"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

// brain.fm-style signal preview card: an eyebrow label + live/preview status, an
// icon+title header, a few sample metric rows (the children), and a connect
// action at the bottom.
function SignalPreviewCard({ accent, action, active, children, eyebrow, icon: Icon, title }) {
  return (
    <div
      className={`${GLASS_CARD} relative flex flex-col overflow-hidden p-5 transition-all duration-300 hover:-translate-y-1`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-12 size-36 rounded-full blur-3xl transition-opacity duration-500"
        style={{ background: `${accent}33`, opacity: active ? 1 : 0.5 }}
      />
      <div className="relative flex flex-1 flex-col">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            {eyebrow}
          </span>
          {active ? (
            <span
              className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: accent }}
            >
              <span
                className="size-1.5 rounded-full"
                style={{ background: accent, boxShadow: `0 0 8px ${accent}` }}
              />
              Live
            </span>
          ) : (
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
              Preview
            </span>
          )}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-2xl border"
            style={{ background: `${accent}1f`, borderColor: `${accent}55`, color: accent }}
          >
            <Icon className="size-5" />
          </span>
          <span className="text-lg font-semibold leading-tight text-white">{title}</span>
        </div>
        <div className="mt-4 space-y-1">{children}</div>
        {action ? <div className="mt-5">{action}</div> : null}
      </div>
    </div>
  );
}

// brain.fm-style top navigation: brand mark on the left, content links on the
// right. Links open the project docs/source in a new tab.
function TopNav() {
  const linkClass =
    "text-sm font-medium text-slate-300 transition hover:text-white";
  return (
    <header className="absolute inset-x-0 top-0 z-20 animate-rise-up">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-6 sm:px-6">
        <BrandMark compact />
        <div className="flex items-center gap-5 sm:gap-8">
          <a
            className={linkClass}
            href={`${import.meta.env.BASE_URL}paper.pdf`}
            rel="noreferrer"
            target="_blank"
          >
            Read the science
          </a>
          <a
            className={`hidden sm:inline ${linkClass}`}
            href="https://github.com/eybmits/vibe_shuffle/blob/main/docs/privacy_and_limitations.md"
            rel="noreferrer"
            target="_blank"
          >
            Privacy
          </a>
          <a
            className={`hidden sm:inline ${linkClass}`}
            href="https://github.com/eybmits/vibe_shuffle"
            rel="noreferrer"
            target="_blank"
          >
            GitHub
          </a>
        </div>
      </nav>
    </header>
  );
}

function SetupScreen({
  cameraReady,
  face,
  onConnectHeartSensor,
  onConnectSpotify,
  onDisconnectHeartSensor,
  onDisconnectSpotify,
  onStart,
  onStartCamera,
  onStartMockHeartSensor,
  physiology,
  setupReady,
  songCount,
  spotifyAuth,
  spotifyPlayer,
}) {
  const spotifyStepComplete = spotifyAuth.authenticated && spotifyPlayer.ready;
  const physiologyReady = !physiology.connected || physiology.status === "ready";

  // The hero headline cycles through the four moods on its own. It holds the
  // first word while the page builds in, then starts swapping — and swaps fast.
  const [cycleIndex, setCycleIndex] = useState(0);
  useEffect(() => {
    let intervalId;
    const startId = window.setTimeout(() => {
      intervalId = window.setInterval(
        () => setCycleIndex((value) => (value + 1) % MOODS.length),
        1700,
      );
    }, 1500);
    return () => {
      window.clearTimeout(startId);
      if (intervalId) window.clearInterval(intervalId);
    };
  }, []);
  const activeMood = MOODS[cycleIndex];

  const spotifyStatusText = !spotifyAuth.authenticated
    ? spotifyAuth.error || "Sign in with Spotify Premium. Your music plays right in this browser."
    : spotifyPlayer.ready
      ? "Spotify player is connected and ready."
      : spotifyPlayer.error || "Connecting the Spotify player…";

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
            ? "Sensor is paired. Waiting for live heart-rate packets."
            : physiology.error || "Optional: connect a BLE ECG/heart-rate sensor.";

  return (
    <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center gap-12 px-4 py-12 sm:px-6">
      {/* mood-tinted ambient glow that follows the active mood — two breathing
          layers so the hue keeps radiating outward behind the headline */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed left-1/2 top-1/3 -z-10 size-[860px] animate-radiate rounded-full blur-[170px]"
        style={{
          background: `radial-gradient(circle, ${activeMood.accent}55, transparent 60%)`,
          transition: "background 1.2s ease",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed left-1/2 top-1/3 -z-10 size-[440px] animate-radiate rounded-full blur-[120px]"
        style={{
          animationDelay: "1.4s",
          background: `radial-gradient(circle, ${activeMood.accent}66, transparent 65%)`,
          transition: "background 1.2s ease",
        }}
      />

      <TopNav />

      <HeroArtwork />

      <div className="relative z-10 flex flex-col items-center gap-8 text-center">
        <div>
          <h1 className="mx-auto max-w-4xl text-4xl font-bold leading-[1.04] tracking-tight text-white sm:text-7xl lg:text-8xl">
            <span className="block animate-rise-up" style={{ animationDelay: "150ms" }}>
              Music tuned
            </span>
            <span className="block animate-rise-up" style={{ animationDelay: "320ms" }}>
              to your{" "}
              <span className="relative inline-block align-bottom">
                <span
                  className="relative z-10 inline-block animate-word-in"
                  key={activeMood.key}
                  style={{
                    color: activeMood.accent,
                    textShadow: `0 0 24px ${activeMood.accent}aa, 0 0 60px ${activeMood.accent}55`,
                  }}
                >
                  {activeMood.label}
                </span>
                <span
                  aria-hidden="true"
                  className="absolute -bottom-1 left-0 right-0 h-3 origin-left animate-highlight-wipe rounded-full blur-[1px] sm:h-4 lg:h-5"
                  key={`${activeMood.key}-bar`}
                  style={{
                    background: `linear-gradient(90deg, ${activeMood.accent}, ${activeMood.accent}22)`,
                    boxShadow: `0 6px 30px ${activeMood.accent}66`,
                  }}
                />
              </span>
            </span>
          </h1>
        </div>
      </div>

      <div
        className="mx-auto flex w-full max-w-3xl animate-rise-up flex-col gap-5"
        style={{ animationDelay: "720ms" }}
      >
        {/* Two on-device signal previews — brain.fm style */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Physical signals — heart-rate variability */}
          <SignalPreviewCard
            accent="#fb7185"
            action={
              physiology.status === "idle" || physiology.status === "error" ? (
                <EnableButton
                  accent="#fb7185"
                  className="w-full"
                  icon={HeartPulse}
                  onClick={onConnectHeartSensor}
                  pulse
                >
                  Connect sensor
                </EnableButton>
              ) : physiology.connected ? (
                <button
                  className="text-sm font-semibold text-slate-400 underline-offset-4 transition hover:text-white hover:underline"
                  onClick={onDisconnectHeartSensor}
                  type="button"
                >
                  Disconnect sensor
                </button>
              ) : (
                <span className="inline-flex items-center gap-2 text-sm text-slate-400">
                  <span className="size-2 animate-pulse rounded-full bg-rose-300" />
                  Connecting…
                </span>
              )
            }
            active={physiology.connected}
            eyebrow="Physical signals"
            icon={HeartPulse}
            title="Heart Rate Variability"
          >
            {physiology.connected ? (
              <p className="text-sm leading-6 text-slate-300">{physiologyStatusText}</p>
            ) : (
              <>
                <SignalMetric
                  badge="Good"
                  badgeStyle={{ background: "rgba(16,185,129,0.16)", color: "#34d399" }}
                  label="Recovery"
                  value="72%"
                  valueClass="text-emerald-400"
                />
                <EcgLine color="#34d399" />
                <SignalMetric label="Stress Load" value="Low" valueClass="text-emerald-400" />
                <SignalMetric label="Breath Rhythm" value="Detected" valueClass="text-sky-300" />
              </>
            )}
          </SignalPreviewCard>

          {/* Emotional signals — facial expression */}
          <SignalPreviewCard
            accent="#22d3ee"
            action={
              cameraReady ? null : face.status === "loading" ? (
                <span className="inline-flex items-center gap-2 text-sm text-slate-400">
                  <span className="size-2 animate-pulse rounded-full bg-cyan-300" />
                  Starting camera…
                </span>
              ) : (
                <EnableButton accent="#22d3ee" className="w-full" icon={Camera} onClick={onStartCamera}>
                  Connect camera
                </EnableButton>
              )
            }
            active={cameraReady}
            eyebrow="Emotional signals"
            icon={ScanFace}
            title="Facial Expression"
          >
            {cameraReady ? (
              <div className="h-32 w-full overflow-hidden rounded-xl border border-white/10 bg-black/50">
                <video
                  aria-label="Local camera preview"
                  className="h-full w-full scale-x-[-1] object-cover opacity-90"
                  muted
                  playsInline
                  ref={face.setVideoRef}
                />
              </div>
            ) : (
              <>
                <SignalMetric
                  badge="Positive"
                  badgeStyle={{ background: "rgba(34,211,238,0.16)", color: "#67e8f9" }}
                  label="Mood"
                  value="Focused"
                  valueClass="text-sky-300"
                />
                <SignalMetric label="Tension" value="Medium" valueClass="text-amber-300" />
                <SignalMetric label="Fatigue" value="Rising" valueClass="text-rose-300" />
              </>
            )}
          </SignalPreviewCard>
        </div>

        {/* Spotify hub — connect + start the session */}
        <SignalFeatureCard
          accent="#1db954"
          active={spotifyStepComplete}
          description={spotifyStatusText}
          icon={SpotifyGlyph}
          statusText={spotifyStatusText}
          tag="Required"
          title="Connect Spotify"
        >
          <div className="space-y-4">
            {!spotifyAuth.authenticated ? (
              <EnableButton accent="#1db954" icon={SpotifyGlyph} onClick={onConnectSpotify}>
                Connect Spotify
              </EnableButton>
            ) : (
              <button
                className="text-sm font-semibold text-slate-400 underline-offset-4 transition hover:text-white hover:underline"
                onClick={onDisconnectSpotify}
                type="button"
              >
                Switch account
              </button>
            )}
            <PrimaryButton className="w-full" disabled={!setupReady} onClick={onStart}>
              Begin session
              <ArrowRight className="size-4" />
            </PrimaryButton>
          </div>
        </SignalFeatureCard>
      </div>
    </div>
  );
}

function LikertScale({ highLabel, lowLabel, onSelect, value }) {
  return (
    <div className="mt-6">
      <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
        {RATING_SCORES.map((score) => {
          const active = value === score;
          return (
            <button
              className={`flex aspect-square items-center justify-center rounded-xl border text-lg font-semibold transition duration-200 hover:-translate-y-0.5 active:scale-95 sm:text-xl ${
                active
                  ? "scale-105 border-transparent bg-gradient-to-br from-cyan-400 to-violet-500 text-[#05060f] shadow-[0_12px_34px_rgba(34,211,238,0.35)]"
                  : "border-white/10 bg-white/[0.04] text-slate-200 hover:border-cyan-300/40 hover:bg-white/[0.08]"
              }`}
              key={score}
              onClick={() => onSelect(score)}
              type="button"
            >
              {score}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs text-slate-500">
        <span>1 · {lowLabel}</span>
        <span>{highLabel} · 5</span>
      </div>
    </div>
  );
}

function RatingModal({ isLastTrial, onSubmit, open, song }) {
  const [step, setStep] = useState("like");
  const [likeScore, setLikeScore] = useState(null);
  const [fitScore, setFitScore] = useState(null);

  // Reset to step 1 whenever a new track's rating opens.
  useEffect(() => {
    if (open) {
      setStep("like");
      setLikeScore(null);
      setFitScore(null);
    }
  }, [open, song?.id]);

  if (!open || !song) return null;

  const onLike = step === "like";
  const question = onLike ? LIKING_QUESTION : FIT_QUESTION;
  const value = onLike ? likeScore : fitScore;

  const handleSelect = (score) => {
    if (onLike) setLikeScore(score);
    else setFitScore(score);
  };

  const handleNext = () => {
    if (onLike) {
      setStep("fit");
    } else if (likeScore && fitScore) {
      onSubmit(likeScore, fitScore);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#05060f]/80 px-3 py-4 backdrop-blur-md sm:px-4 sm:py-6">
      <section
        aria-modal="true"
        className={`${GLASS_CARD} max-h-[calc(100dvh-2rem)] w-full max-w-2xl animate-scale-in overflow-y-auto bg-[#0a0d1d]/90 p-6 sm:p-8`}
        role="dialog"
      >
        <div className="flex items-center justify-between">
          <SectionLabel icon={BarChart3}>Rating · step {onLike ? "1" : "2"} of 2</SectionLabel>
          <div className="flex gap-1.5">
            <span className={`h-1.5 w-8 rounded-full ${onLike ? ACCENT_GRADIENT : "bg-white/15"}`} />
            <span className={`h-1.5 w-8 rounded-full ${onLike ? "bg-white/15" : ACCENT_GRADIENT}`} />
          </div>
        </div>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          {question.title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          You just listened to <span className="font-semibold text-white">{song.title}</span> by{" "}
          {song.artist}.
        </p>

        <LikertScale
          highLabel={question.highLabel}
          lowLabel={question.lowLabel}
          onSelect={handleSelect}
          value={value}
        />

        <div className="mt-7 flex items-center justify-end">
          <PrimaryButton disabled={!value} onClick={handleNext}>
            {onLike ? "Next" : isLastTrial ? "Finish session" : "Next track"}
            <ArrowRight className="size-4" />
          </PrimaryButton>
        </div>
      </section>
    </div>
  );
}

function CoverArt({ isPlaying, song }) {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[280px] overflow-hidden rounded-3xl border border-white/12 shadow-[0_30px_90px_rgba(0,0,0,0.55)]">
      {song.albumImageUrl ? (
        <img alt="" className="h-full w-full object-cover" src={song.albumImageUrl} />
      ) : (
        <div
          className="h-full w-full"
          style={{
            background: `linear-gradient(140deg, ${song.palette[0]} 0%, ${song.palette[1]} 55%, ${song.palette[2]} 100%)`,
          }}
        />
      )}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(5,6,15,0.4))]" />
      <div className="absolute inset-x-6 bottom-5 flex items-end gap-1.5 opacity-90">
        {[34, 58, 42, 72, 38, 62, 46].map((height, index) => (
          <span
            className="w-full rounded-full bg-white/80"
            key={`${song.id}-${height}-${index}`}
            style={{
              animation: isPlaying
                ? `soft-pulse ${1.8 + index * 0.14}s ease-in-out infinite`
                : "none",
              height: `${height * 0.4}px`,
              opacity: isPlaying ? 0.9 : 0.35,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function mean(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

// Animate a number from 0 to target once on mount.
function useCountUp(target, duration = 900) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

function ResultsChart({ ratings }) {
  const byMode = (mode) => ratings.filter((rating) => rating.block_mode === mode);
  const vibe = byMode("vibe");
  const random = byMode("random");

  // Trigger the grow-in transition one frame after mount.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const stats = {
    vibe: {
      fit: mean(vibe.map((r) => r.rating_fit_1_to_5)),
      like: mean(vibe.map((r) => r.rating_like_1_to_5)),
    },
    random: {
      fit: mean(random.map((r) => r.rating_fit_1_to_5)),
      like: mean(random.map((r) => r.rating_like_1_to_5)),
    },
  };
  const fitDelta = stats.vibe.fit - stats.random.fit;
  const vibeCount = useCountUp(stats.vibe.fit);
  const randomCount = useCountUp(stats.random.fit);
  const deltaCount = useCountUp(fitDelta);

  // Grouped bars: Vibe vs Random, each with Mood-fit (primary) + Liking (control).
  const groups = [
    { label: "Vibe Shuffle", data: stats.vibe },
    { label: "Random", data: stats.random },
  ];
  const barFor = (value) => `${(clamp(value, 0, 5) / 5) * 100}%`;

  return (
    <div className="animate-fade-in">
      <p className="text-sm leading-6 text-slate-300">
        Mood-fit · Vibe{" "}
        <span className="font-semibold tabular-nums text-white">{vibeCount.toFixed(1)}</span> vs Random{" "}
        <span className="font-semibold tabular-nums text-white">{randomCount.toFixed(1)}</span>{" "}
        <span className={`tabular-nums ${fitDelta >= 0 ? "text-cyan-300" : "text-rose-300"}`}>
          ({fitDelta >= 0 ? "+" : ""}
          {deltaCount.toFixed(1)})
        </span>
      </p>

      <div className="mt-5 grid grid-cols-2 gap-5">
        {groups.map((group) => (
          <div key={group.label}>
            <div className="flex h-44 items-end justify-center gap-4 rounded-2xl border border-white/10 bg-[#070a18] p-4">
              {[
                { key: "fit", label: "Mood-fit", value: group.data.fit, gradient: "from-cyan-400 to-violet-500", glow: "rgba(34,211,238,0.45)" },
                { key: "like", label: "Liking", value: group.data.like, gradient: "from-slate-500 to-slate-400", glow: "rgba(148,163,184,0.3)" },
              ].map((bar) => (
                <div key={bar.key} className="flex h-full w-16 flex-col items-center justify-end">
                  <span className="mb-1 text-sm font-semibold text-white">
                    {bar.value ? bar.value.toFixed(1) : "—"}
                  </span>
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className={`w-full rounded-t-lg bg-gradient-to-t ${bar.gradient}`}
                      style={{
                        height: shown ? barFor(bar.value) : "0%",
                        boxShadow: `0 0 24px ${bar.glow}`,
                        transition: "height 1s cubic-bezier(0.22, 1, 0.36, 1)",
                      }}
                    />
                  </div>
                  <span className="mt-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                    {bar.label}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-2 text-center text-sm font-semibold text-slate-200">{group.label}</div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Mood-fit is the primary outcome; liking is the control (does Vibe just pick songs you like
        more?). Scale 1–5.
      </p>
    </div>
  );
}

function CalibrationOverlay({ face, onSkip, secondsRemaining, total }) {
  const progress = (total - secondsRemaining) / total;
  const radius = 78;
  const circumference = 2 * Math.PI * radius;
  const searching = face.status === "searching" || face.status === "loading";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#05060f]/85 px-4 py-6 backdrop-blur-2xl">
      <section
        className={`${GLASS_CARD} w-full max-w-lg animate-scale-in bg-[#0a0d1d]/80 p-8 text-center sm:p-10`}
      >
        <SectionLabel icon={Camera}>Calibration</SectionLabel>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-[2.6rem] sm:leading-[1.05]">
          Look neutrally at the camera
        </h2>
        <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-slate-400">
          Relax your face and sit still for a moment — we are learning your personal resting baseline
          so small changes are detected accurately during the session.
        </p>

        <div className="relative mx-auto mt-9 size-52">
          {/* breathing ambient glow */}
          <div className="absolute inset-0 animate-breathe rounded-full bg-gradient-to-br from-cyan-400/30 to-violet-500/30 blur-2xl" />
          <div className="absolute inset-3 overflow-hidden rounded-full border border-white/15 bg-black/60 shadow-[0_0_60px_rgba(34,211,238,0.18)]">
            <video
              aria-label="Calibration camera preview"
              className="h-full w-full scale-x-[-1] object-cover"
              muted
              playsInline
              ref={face.attachPreview}
            />
            {searching ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
                Looking for you…
              </div>
            ) : null}
          </div>
          <svg className="absolute inset-0 size-full -rotate-90" viewBox="0 0 208 208">
            <circle cx="104" cy="104" r={radius} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="4" />
            <circle
              cx="104"
              cy="104"
              r={radius}
              fill="none"
              stroke="url(#calibGradient)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - progress)}
              style={{ transition: "stroke-dashoffset 1s linear" }}
            />
            <defs>
              <linearGradient id="calibGradient" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0%" stopColor="#22d3ee" />
                <stop offset="100%" stopColor="#a78bfa" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        <div className="mt-6 text-3xl font-semibold tabular-nums text-white">{secondsRemaining}s</div>
        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">Hold still</p>

        <button
          className="mt-7 text-xs font-semibold text-slate-500 underline-offset-4 transition hover:text-slate-300 hover:underline"
          onClick={onSkip}
          type="button"
        >
          Skip calibration
        </button>
      </section>
    </div>
  );
}

export default function App() {
  const spotifyAuth = useSpotifyAuth();
  const spotifyPlayer = useSpotifyPlayer(spotifyAuth.accessToken, spotifyAuth.ensureToken);
  const spotifyPlayerReady = spotifyPlayer.ready;
  const spotifyPlayerError = spotifyPlayer.error;
  const pauseSpotify = spotifyPlayer.pause;
  const playSpotifyTrack = spotifyPlayer.playTrack;
  // Fixed curated pool of 100 real Spotify tracks (no library API → no rate
  // limit). Spotify login is only used for playback.
  const songs = useMemo(() => buildDemoLibrary(), []);
  const face = useFaceExpression();
  const physiology = usePhysiologySensor();
  const [sessionStarted, setSessionStarted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPlaybackActive, setIsPlaybackActive] = useState(false);
  const [protocolId, setProtocolId] = useState(() => createProtocolId());
  const [blockOrder, setBlockOrder] = useState(() => randomBlockOrder());
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [currentSong, setCurrentSong] = useState(null);
  const [history, setHistory] = useState([]);
  const [queueSeed, setQueueSeed] = useState(() => randomSeed());
  const [trialId, setTrialId] = useState(1);
  const [ratings, setRatings] = useState([]);
  const [protocolComplete, setProtocolComplete] = useState(false);
  const [trackProgress, setTrackProgress] = useState(0);
  const [ratingPromptOpen, setRatingPromptOpen] = useState(false);
  const [playbackNotice, setPlaybackNotice] = useState("");
  const [jumpedTrialIds, setJumpedTrialIds] = useState([]);
  const [calibrationRemaining, setCalibrationRemaining] = useState(0);
  const playbackRequestRef = useRef(0);
  const expressionWindowRef = useRef([]);
  const lastWindowSampleIdRef = useRef(0);
  const physiologyWindowRef = useRef([]);
  const lastPhysiologySampleIdRef = useRef(0);

  const mode = blockOrder[currentBlockIndex];
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
  const currentRating = ratings.find((rating) => rating.trial_id === trialId);
  const canJumpToRating =
    sessionStarted &&
    !protocolComplete &&
    !ratingPromptOpen &&
    !currentRating &&
    (isPlaybackActive || trackProgress > 0);
  const totalTrials = BLOCK_COUNT * TRACKS_PER_BLOCK;
  const completedTrials = ratings.length;
  const remainingSeconds =
    LISTENING_WINDOW_SECONDS * (1 - Math.min(trackProgress, 100) / 100);
  const cameraReady = face.status === "ready" || face.status === "searching";
  const physiologyReady = !physiology.connected || physiology.status === "ready";
  const setupReady = spotifyPlayerReady && physiologyReady;

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

  function resetSignalWindows() {
    expressionWindowRef.current = [];
    lastWindowSampleIdRef.current = face.sampleId ?? 0;
    physiologyWindowRef.current = [];
    lastPhysiologySampleIdRef.current = physiology.sampleId ?? 0;
  }

  async function startCurrentTrack(song) {
    if (!song?.spotifyUri) {
      return { started: false, message: "This track has no Spotify playback route." };
    }

    if (!spotifyPlayerReady) {
      return {
        started: false,
        message: "Waiting for the Spotify player. Reconnect Spotify if this persists.",
      };
    }

    try {
      const started = await playSpotifyTrack(song.spotifyUri);
      return {
        started,
        message: started
          ? ""
          : spotifyPlayerError || "Spotify could not start this track. Check premium playback.",
      };
    } catch {
      return {
        started: false,
        message:
          spotifyPlayerError || "Spotify could not start this track. Please reconnect and retry.",
      };
    }
  }

  async function startPlayback(song) {
    const requestId = playbackRequestRef.current + 1;
    playbackRequestRef.current = requestId;

    // Optimistic UI: the button flips immediately while the play request is in flight.
    setIsPlaying(true);
    setPlaybackNotice("");

    const result = await startCurrentTrack(song);
    if (playbackRequestRef.current !== requestId) return;

    setIsPlaying(result.started);
    setIsPlaybackActive(result.started);
    setPlaybackNotice(result.message || "");
  }

  function openRatingPrompt(jumped = false) {
    playbackRequestRef.current += 1;
    setIsPlaying(false);
    setIsPlaybackActive(false);
    pauseSpotify();
    setTrackProgress(100);
    setRatingPromptOpen(true);

    if (jumped) {
      setJumpedTrialIds((items) => (items.includes(trialId) ? items : [...items, trialId]));
    }
  }

  useEffect(() => {
    if (!face.sampleId || face.sampleId === lastWindowSampleIdRef.current) return;

    lastWindowSampleIdRef.current = face.sampleId;

    if (
      !sessionStarted ||
      !isPlaybackActive ||
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
    isPlaybackActive,
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
      !isPlaybackActive ||
      ratingPromptOpen ||
      protocolComplete ||
      !physiology.sample
    ) {
      return;
    }

    physiologyWindowRef.current = [...physiologyWindowRef.current.slice(-180), physiology.sample];
  }, [
    isPlaybackActive,
    physiology.sample,
    physiology.sampleId,
    protocolComplete,
    ratingPromptOpen,
    sessionStarted,
  ]);

  useEffect(() => {
    if (!sessionStarted || !isPlaybackActive || protocolComplete || ratingPromptOpen || currentRating) {
      return undefined;
    }

    const id = window.setInterval(() => {
      setTrackProgress((value) => {
        const nextValue = Math.min(value + 100 / (LISTENING_WINDOW_SECONDS * 4), 100);

        if (nextValue >= 100) {
          window.setTimeout(() => {
            openRatingPrompt(false);
          }, 0);
        }

        return nextValue;
      });
    }, 250);

    return () => window.clearInterval(id);
  }, [currentRating, isPlaybackActive, protocolComplete, ratingPromptOpen, sessionStarted]);

  useEffect(() => {
    if (ratingPromptOpen) {
      pauseSpotify();
    }
  }, [pauseSpotify, ratingPromptOpen]);

  function startSession() {
    if (!setupReady) return;

    const order = randomBlockOrder();
    const sessionSeed = randomSeed();
    const firstSong = rankSongs(songs, order[0], mood, null, sessionSeed, [])[0] ?? songs[0];
    resetSignalWindows();
    setBlockOrder(order);
    setCurrentSong(firstSong);
    setHistory([]);
    setCurrentBlockIndex(0);
    setCurrentTrackIndex(0);
    setQueueSeed(sessionSeed + 7);
    setSessionStarted(true);
    setIsPlaying(false);
    setIsPlaybackActive(false);
    setTrackProgress(0);
    setPlaybackNotice("Press play when you are ready.");
    // Short neutral-baseline calibration when the camera is active.
    if (cameraReady) setCalibrationRemaining(CALIBRATION_SECONDS);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function finishCalibration() {
    if (cameraReady) face.snapshotBaseline();
    resetSignalWindows();
    setCalibrationRemaining(0);
  }

  // `face` is a fresh object every frame, so it must NOT be a dependency here —
  // otherwise the 1 s timer is cleared and restarted before it can ever fire.
  const faceRef = useRef(face);
  faceRef.current = face;
  useEffect(() => {
    if (calibrationRemaining <= 0) return undefined;
    const id = window.setTimeout(() => {
      setCalibrationRemaining((value) => {
        if (value <= 1) {
          if (cameraReady) faceRef.current.snapshotBaseline();
          resetSignalWindows();
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearTimeout(id);
  }, [calibrationRemaining, cameraReady]);

  function moveToSong(song) {
    resetSignalWindows();
    setHistory((items) => [...items.slice(-8), currentSong]);
    setCurrentSong(song);
    setTrialId((value) => value + 1);
    setQueueSeed((value) => value + 19);
    setTrackProgress(0);
    setRatingPromptOpen(false);
    setIsPlaybackActive(false);
    setPlaybackNotice("");
    window.scrollTo({ top: 0, behavior: "smooth" });

    if (sessionStarted) {
      startPlayback(song);
    } else {
      setIsPlaying(false);
    }
  }

  function advanceProtocol(latestRatings) {
    if (protocolComplete) return;

    const selectionFusion = fuseEmotionSignals(currentWindowSummary(), currentPhysiologySummary());
    const selectionMood = signalStateToMood(selectionFusion);
    const rankedSongs = rankSongs(
      songs,
      mode,
      selectionMood,
      currentSong?.id ?? null,
      queueSeed,
      recentIds,
    );
    const nextSong = rankedSongs[0] ?? songs[0];
    const isLastTrackInBlock = currentTrackIndex === TRACKS_PER_BLOCK - 1;
    const isLastBlock = currentBlockIndex === BLOCK_COUNT - 1;

    if (isLastTrackInBlock && isLastBlock) {
      setProtocolComplete(true);
      setRatingPromptOpen(false);
      setIsPlaying(false);
      setIsPlaybackActive(false);
      pauseSpotify();
      window.setTimeout(() => downloadCsv(latestRatings ?? ratings, protocolId), 0);
      return;
    }

    if (isLastTrackInBlock) {
      const nextMode = blockOrder[currentBlockIndex + 1];
      const transitionQueue = rankSongs(
        songs,
        nextMode,
        selectionMood,
        currentSong?.id ?? null,
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

  // Two-step rating: liking + mood-fit are collected in the modal, then saved
  // and the protocol advances in one step.
  function submitRating(likeScore, fitScore) {
    if (protocolComplete || !ratingPromptOpen || !currentSong) return;

    const expressionSummary = currentWindowSummary();
    const expressionMood = expressionStateToMood(expressionSummary);
    const physiologySummary = currentPhysiologySummary();
    const fusionSummary = fuseEmotionSignals(expressionSummary, physiologySummary);
    const nextRating = {
      protocol_id: protocolId,
      trial_id: trialId,
      timestamp: new Date().toISOString(),
      block_order: blockOrder.join(">"),
      block_number: currentBlockIndex + 1,
      block_mode: mode,
      track_number: currentTrackIndex + 1,
      song_id: currentSong.id,
      spotify_id: currentSong.spotifyId,
      song_title: currentSong.title,
      artist: currentSong.artist,
      song_quadrant: currentSong.quadrant,
      song_valence: currentSong.valence,
      song_arousal: currentSong.energy,
      face_present: expressionMood.facePresent,
      ecg_connected: physiology.connected,
      physiology_quality: physiologySummary.physiology_quality,
      detected_valence: Number(fusionSummary.valence.toFixed(3)),
      detected_arousal: Number(fusionSummary.energy.toFixed(3)),
      physiology_arousal: physiologySummary.physiology_arousal,
      rating_like_1_to_5: likeScore,
      rating_fit_1_to_5: fitScore,
    };

    const nextRatings = ratings.some((rating) => rating.trial_id === trialId)
      ? ratings.map((rating) => (rating.trial_id === trialId ? nextRating : rating))
      : [...ratings, nextRating];
    setRatings(nextRatings);
    advanceProtocol(nextRatings);
  }

  function resetProtocol() {
    playbackRequestRef.current += 1;
    resetSignalWindows();
    setProtocolId(createProtocolId());
    setBlockOrder(randomBlockOrder());
    setCurrentBlockIndex(0);
    setCurrentTrackIndex(0);
    setCurrentSong(null);
    setHistory([]);
    setQueueSeed(randomSeed());
    setTrialId(1);
    setRatings([]);
    setProtocolComplete(false);
    setTrackProgress(0);
    setRatingPromptOpen(false);
    setSessionStarted(false);
    setIsPlaying(false);
    setIsPlaybackActive(false);
    setPlaybackNotice("");
    setJumpedTrialIds([]);
    setCalibrationRemaining(0);
    pauseSpotify();
  }

  function jumpToRating() {
    if (!canJumpToRating) return;
    openRatingPrompt(true);
  }

  async function togglePlayback() {
    if (!sessionStarted || protocolComplete || ratingPromptOpen || calibrationRemaining > 0 || !currentSong)
      return;

    if (isPlaying) {
      playbackRequestRef.current += 1;
      setIsPlaying(false);
      setIsPlaybackActive(false);
      setPlaybackNotice("");
      await pauseSpotify();
      return;
    }

    await startPlayback(currentSong);
  }

  const isLastTrial =
    currentBlockIndex === BLOCK_COUNT - 1 && currentTrackIndex === TRACKS_PER_BLOCK - 1;

  if (!sessionStarted) {
    return (
      <main className="relative min-h-screen bg-[#05060f] text-slate-100">
        <AuroraBackground />
        <SetupScreen
          cameraReady={cameraReady}
          face={face}
          onConnectHeartSensor={physiology.connectBle}
          onConnectSpotify={spotifyAuth.connect}
          onDisconnectHeartSensor={physiology.disconnect}
          onDisconnectSpotify={spotifyAuth.disconnect}
          onStart={startSession}
          onStartCamera={face.start}
          onStartMockHeartSensor={physiology.startMock}
          physiology={physiology}
          setupReady={setupReady}
          songCount={songs.length}
          spotifyAuth={spotifyAuth}
          spotifyPlayer={spotifyPlayer}
        />
      </main>
    );
  }

  const physiologySummary = physiology.currentSummary;
  const heartRateLabel = Number.isFinite(physiologySummary.hr_bpm_mean)
    ? `${Math.round(physiologySummary.hr_bpm_mean)} bpm`
    : "—";

  return (
    <main className="relative min-h-screen bg-[#05060f] text-slate-100">
      <AuroraBackground />

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <BrandMark compact />
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-1.5 text-xs font-semibold text-slate-300">
              Trial {Math.min(completedTrials + 1, totalTrials)}/{totalTrials}
            </span>
            <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-1.5 text-xs font-semibold text-slate-300">
              <span
                className={`size-1.5 rounded-full ${
                  isPlaying ? "animate-pulse bg-cyan-300" : "bg-white/25"
                }`}
              />
              {ratingPromptOpen ? "Rating" : isPlaying ? "Listening" : "Ready"}
            </span>
            {protocolComplete ? (
              <GhostButton onClick={() => downloadCsv(ratings, protocolId)}>
                <Download className="size-4" />
                CSV
              </GhostButton>
            ) : null}
          </div>
        </header>

        <section className={`${GLASS_CARD} relative animate-fade-in overflow-hidden`}>
          {/* ambient album-colour glow that drifts behind the player */}
          {currentSong ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-24 animate-ambient-drift opacity-60 blur-[90px]"
              style={{
                background: `radial-gradient(45% 55% at 28% 40%, ${currentSong.accent}55, transparent 70%)`,
              }}
            />
          ) : null}
          <div className="relative grid items-center gap-8 p-6 sm:p-10 lg:grid-cols-[300px_minmax(0,1fr)]">
            {currentSong ? (
              <div key={currentSong.id} className="animate-fade-in">
                <CoverArt isPlaying={isPlaying} song={currentSong} />
              </div>
            ) : null}

            <div className="flex min-w-0 flex-col gap-7">
              <div key={currentSong?.id} className="animate-fade-in">
                <SectionLabel icon={Music2}>Now playing</SectionLabel>
                <h1 className="mt-3 break-words text-3xl font-semibold leading-[1.05] tracking-tight text-white sm:text-5xl">
                  {currentSong?.title}
                </h1>
                <p className="mt-2.5 text-lg text-slate-300 sm:text-xl">{currentSong?.artist}</p>
                {currentSong?.album ? (
                  <p className="mt-1 text-sm text-slate-500">{currentSong.album}</p>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-7">
                {/* Play control with a circular listening-window progress ring */}
                <div className="relative grid size-28 shrink-0 place-items-center">
                  {isPlaying ? (
                    <span
                      aria-hidden="true"
                      className="absolute size-20 animate-breathe rounded-full bg-gradient-to-br from-cyan-400/40 to-violet-500/40 blur-lg"
                    />
                  ) : null}
                  <svg className="absolute inset-0 size-full -rotate-90" viewBox="0 0 112 112">
                    <circle cx="56" cy="56" r="52" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
                    <circle
                      cx="56"
                      cy="56"
                      r="52"
                      fill="none"
                      stroke="url(#windowRing)"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 52}
                      strokeDashoffset={2 * Math.PI * 52 * (1 - Math.min(trackProgress, 100) / 100)}
                      style={{ transition: "stroke-dashoffset 0.7s linear" }}
                    />
                    <defs>
                      <linearGradient id="windowRing" x1="0" x2="1" y1="0" y2="1">
                        <stop offset="0%" stopColor="#22d3ee" />
                        <stop offset="100%" stopColor="#a78bfa" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <button
                    aria-label={isPlaying ? "Pause music" : "Start music"}
                    className={`relative flex size-20 items-center justify-center rounded-full ${ACCENT_GRADIENT} text-[#05060f] shadow-[0_0_60px_rgba(34,211,238,0.35)] transition hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:bg-none disabled:bg-white/10 disabled:text-white/30 disabled:shadow-none disabled:hover:scale-100`}
                    disabled={protocolComplete || ratingPromptOpen}
                    onClick={togglePlayback}
                    type="button"
                  >
                    {isPlaying ? <Pause className="size-8" /> : <Play className="ml-1 size-8" />}
                  </button>
                </div>

                <div className="min-w-0">
                  <div className="text-4xl font-semibold tabular-nums text-white">
                    {ratingPromptOpen ? "Rate" : formatSeconds(remainingSeconds)}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    <Clock3 className="size-3.5" />
                    Listening window
                  </div>
                </div>

                <GhostButton className="ml-auto" disabled={!canJumpToRating} onClick={jumpToRating}>
                  <SkipForward className="size-4" />
                  Rate now
                </GhostButton>
              </div>

              {playbackNotice || spotifyPlayerError ? (
                <p className="text-sm text-slate-400">{spotifyPlayerError || playbackNotice}</p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="grid animate-fade-in gap-4 sm:grid-cols-3" style={{ animationDelay: "120ms" }}>
          <SignalCard
            icon={Sparkles}
            label="Mood"
            status={mood.facePresent ? mood.label : "Waiting"}
          >
            <MoodMap mood={mood} />
          </SignalCard>

          <SignalCard
            icon={Camera}
            label="Expression"
            status={
              face.status === "ready"
                ? `${Math.round(face.confidence * 100)}%`
                : face.status === "searching"
                  ? "Searching"
                  : "Off"
            }
          >
            <div className="aspect-square w-full overflow-hidden rounded-2xl border border-white/10 bg-black/60">
              <video
                aria-label="Local camera preview"
                className="h-full w-full scale-x-[-1] object-cover opacity-90"
                muted
                playsInline
                ref={face.setVideoRef}
              />
            </div>
          </SignalCard>

          <SignalCard icon={HeartPulse} label="Heart rate" status={heartRateLabel}>
            <div className="flex aspect-square w-full flex-col justify-between rounded-2xl border border-white/10 bg-[#070a18] p-4">
              <HeartRateCurve physiology={physiology} summary={physiologySummary} />
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-xl bg-white/[0.05] px-2 py-2.5">
                  <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    RMSSD
                  </div>
                  <div className="mt-1 text-sm font-semibold text-white">
                    {Number.isFinite(physiologySummary.rmssd_ms)
                      ? `${Math.round(physiologySummary.rmssd_ms)} ms`
                      : "—"}
                  </div>
                </div>
                <div className="rounded-xl bg-white/[0.05] px-2 py-2.5">
                  <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Arousal
                  </div>
                  <div className="mt-1 text-sm font-semibold text-white">
                    {Number.isFinite(physiologySummary.physiology_arousal)
                      ? `${Math.round(physiologySummary.physiology_arousal * 100)}%`
                      : "—"}
                  </div>
                </div>
              </div>
            </div>
          </SignalCard>
        </section>

        {protocolComplete ? (
          <section className={`${GLASS_CARD} p-6 sm:p-8`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-cyan-300">
                  <ShieldCheck className="size-4" />
                  Session complete
                </div>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                  Your result
                </h2>
              </div>
              <div className="flex gap-2">
                <PrimaryButton onClick={() => downloadCsv(ratings, protocolId)}>
                  <Download className="size-4" />
                  Save CSV
                </PrimaryButton>
                <GhostButton onClick={resetProtocol}>
                  <RotateCcw className="size-4" />
                  Reset
                </GhostButton>
              </div>
            </div>
            <div className="mt-6">
              <ResultsChart ratings={ratings} />
            </div>
          </section>
        ) : null}
      </div>

      <RatingModal
        isLastTrial={isLastTrial}
        onSubmit={submitRating}
        open={ratingPromptOpen}
        song={currentSong}
      />

      {calibrationRemaining > 0 ? (
        <CalibrationOverlay
          face={face}
          onSkip={finishCalibration}
          secondsRemaining={calibrationRemaining}
          total={CALIBRATION_SECONDS}
        />
      ) : null}
    </main>
  );
}
