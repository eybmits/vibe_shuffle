import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  BrainCircuit,
  Gauge,
  HeartPulse,
  ListMusic,
  Pause,
  Play,
  Radio,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Trophy,
  Waves,
} from "lucide-react";

const SONGS = [
  {
    id: "glass-tide",
    title: "Glass Tide",
    artist: "Mira Vale",
    mood: "calm",
    valence: 0.66,
    energy: 0.24,
    accent: "#68e1fd",
    palette: ["#102338", "#256d85", "#78f0d7"],
    code: "VT-01",
  },
  {
    id: "night-logic",
    title: "Night Logic",
    artist: "Kaito North",
    mood: "focus",
    valence: 0.57,
    energy: 0.48,
    accent: "#f8c96a",
    palette: ["#0d1824", "#455a64", "#f2b84b"],
    code: "FS-04",
  },
  {
    id: "pulse-lane",
    title: "Pulse Lane",
    artist: "Neon Harbor",
    mood: "energetic",
    valence: 0.83,
    energy: 0.86,
    accent: "#4ade80",
    palette: ["#0d261c", "#208a5b", "#d8ff72"],
    code: "EN-08",
  },
  {
    id: "after-rain",
    title: "After Rain",
    artist: "Lena Iris",
    mood: "melancholic",
    valence: 0.34,
    energy: 0.34,
    accent: "#9aa9ff",
    palette: ["#171923", "#4b587f", "#c4b5fd"],
    code: "ML-02",
  },
  {
    id: "sun-cut",
    title: "Sun Cut",
    artist: "River Finch",
    mood: "happy",
    valence: 0.9,
    energy: 0.62,
    accent: "#fb923c",
    palette: ["#2a1209", "#c35a29", "#fde68a"],
    code: "HP-06",
  },
  {
    id: "low-orbit",
    title: "Low Orbit",
    artist: "Studio Sable",
    mood: "calm",
    valence: 0.52,
    energy: 0.18,
    accent: "#5eead4",
    palette: ["#071f22", "#276b66", "#a7f3d0"],
    code: "CL-03",
  },
  {
    id: "metro-kinetic",
    title: "Metro Kinetic",
    artist: "Signal House",
    mood: "energetic",
    valence: 0.7,
    energy: 0.78,
    accent: "#e879f9",
    palette: ["#1e1326", "#814b9b", "#f0abfc"],
    code: "EN-11",
  },
  {
    id: "steady-room",
    title: "Steady Room",
    artist: "Arden Cole",
    mood: "focus",
    valence: 0.61,
    energy: 0.42,
    accent: "#38bdf8",
    palette: ["#0b1724", "#1d4e89", "#a5f3fc"],
    code: "FS-09",
  },
  {
    id: "soft-reset",
    title: "Soft Reset",
    artist: "Celia Drum",
    mood: "stress relief",
    valence: 0.48,
    energy: 0.28,
    accent: "#c4b5fd",
    palette: ["#16151f", "#5b4b8a", "#d8b4fe"],
    code: "SR-05",
  },
];

const MODE_LABELS = {
  random: "Random Shuffle",
  vibe: "Vibe Shuffle",
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function inferMood(hr, hrv) {
  const stressIndex = clamp((hr - 62) / 42 + (72 - hrv) / 58, 0, 2) / 2;

  if (stressIndex > 0.72) {
    return {
      label: "Stressed",
      tag: "stress relief",
      valence: 0.32,
      energy: 0.78,
      accent: "#fb7185",
      description: "High arousal, lower recovery",
    };
  }

  if (hr > 82 && hrv > 48) {
    return {
      label: "Energetic",
      tag: "energetic",
      valence: 0.8,
      energy: 0.82,
      accent: "#4ade80",
      description: "Elevated rhythm, stable recovery",
    };
  }

  if (hr < 70 && hrv > 66) {
    return {
      label: "Calm",
      tag: "calm",
      valence: 0.68,
      energy: 0.24,
      accent: "#67e8f9",
      description: "Lower arousal, high regulation",
    };
  }

  return {
    label: "Focused",
    tag: "focus",
    valence: 0.58,
    energy: 0.48,
    accent: "#facc15",
    description: "Balanced arousal and control",
  };
}

function wavePath(phase, heartRate, hrv) {
  const points = [];
  const width = 420;
  const height = 118;
  const heartPulse = clamp((heartRate - 58) / 47, 0.18, 1);
  const variability = clamp(hrv / 90, 0.34, 1);

  for (let i = 0; i <= 70; i += 1) {
    const x = (i / 70) * width;
    const rhythm = Math.sin(i * 0.52 + phase) * 15 * heartPulse;
    const recovery = Math.sin(i * 0.16 + phase * 0.55) * 18 * variability;
    const micro = Math.sin(i * 1.45 + phase * 1.4) * 4;
    const y = height / 2 + rhythm + recovery + micro;
    points.push(`${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`);
  }

  return points.join(" ");
}

function deterministicScore(id, seed) {
  let hash = seed * 97;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 9973;
  }
  return hash / 9973;
}

function rankSongs(songs, mode, mood, currentSongId, seed, recentIds) {
  return songs
    .filter((song) => song.id !== currentSongId)
    .map((song) => {
      const recentPenalty = recentIds.includes(song.id) ? 0.14 : 0;
      const distance = Math.hypot(song.valence - mood.valence, song.energy - mood.energy);
      const tagBonus = song.mood === mood.tag ? -0.18 : 0;
      const randomScore = deterministicScore(song.id, seed);
      const vibeScore = distance + tagBonus + recentPenalty + randomScore * 0.035;

      return {
        ...song,
        score: mode === "vibe" ? vibeScore : randomScore + recentPenalty,
        fit: Math.round(clamp(1 - distance, 0, 1) * 100),
      };
    })
    .sort((a, b) => a.score - b.score);
}

function summarizeRatings(ratings, mode) {
  const rows = ratings.filter((rating) => rating.mode === mode);
  const count = rows.length;
  const average = count
    ? rows.reduce((sum, rating) => sum + rating.score, 0) / count
    : 0;

  return { count, average };
}

function StatPill({ label, value, detail, icon: Icon }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.055] p-4 shadow-panel backdrop-blur-xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
          {label}
        </span>
        <Icon className="size-4 text-slate-300" />
      </div>
      <div className="text-3xl font-semibold tracking-tight text-white">{value}</div>
      <div className="mt-1 text-sm text-slate-400">{detail}</div>
    </div>
  );
}

function MoodMap({ mood }) {
  const x = clamp(mood.valence * 100, 8, 92);
  const y = clamp(100 - mood.energy * 100, 8, 92);

  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-white/10 bg-slate-950/70 p-4">
      <div className="absolute inset-4 rounded-lg border border-white/10" />
      <div className="absolute left-4 right-4 top-1/2 h-px bg-white/10" />
      <div className="absolute bottom-4 top-4 left-1/2 w-px bg-white/10" />
      <div className="absolute inset-4 bg-[linear-gradient(90deg,rgba(248,113,113,0.16),rgba(45,212,191,0.16)),linear-gradient(0deg,rgba(148,163,184,0.08),rgba(250,204,21,0.16))]" />
      <div
        className="absolute size-5 rounded-full border-2 border-white shadow-[0_0_28px_rgba(255,255,255,0.48)] transition-all duration-700"
        style={{
          left: `${x}%`,
          top: `${y}%`,
          background: mood.accent,
          transform: "translate(-50%, -50%)",
        }}
      />
      <span className="absolute bottom-3 left-4 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
        Low valence
      </span>
      <span className="absolute bottom-3 right-4 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
        High valence
      </span>
      <span className="absolute right-4 top-3 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
        Energy
      </span>
    </div>
  );
}

function SignalWave({ phase, hr, hrv, accent }) {
  const mainPath = wavePath(phase, hr, hrv);
  const shadowPath = wavePath(phase + 0.9, hr - 5, hrv + 9);

  return (
    <div className="relative overflow-hidden rounded-lg border border-white/10 bg-slate-950/70 p-4">
      <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.08),transparent)] opacity-60 animate-sweep" />
      <svg className="relative h-32 w-full" viewBox="0 0 420 118" role="img">
        <defs>
          <linearGradient id="signal-gradient" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="52%" stopColor={accent} />
            <stop offset="100%" stopColor="#fb7185" />
          </linearGradient>
        </defs>
        <path
          d={shadowPath}
          fill="none"
          stroke="rgba(148, 163, 184, 0.22)"
          strokeLinecap="round"
          strokeWidth="5"
        />
        <path
          d={mainPath}
          fill="none"
          stroke="url(#signal-gradient)"
          strokeLinecap="round"
          strokeWidth="4"
        />
      </svg>
    </div>
  );
}

function CoverArt({ song, isPlaying }) {
  return (
    <div
      className="relative aspect-square overflow-hidden rounded-lg border border-white/10 shadow-glow"
      style={{
        background: `linear-gradient(135deg, ${song.palette[0]} 0%, ${song.palette[1]} 52%, ${song.palette[2]} 100%)`,
      }}
    >
      <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.18),transparent_42%,rgba(0,0,0,0.24))]" />
      <div className="absolute -left-1/4 top-0 h-full w-2/3 rotate-12 bg-white/12 blur-2xl animate-sweep" />
      <div className="absolute inset-x-8 top-10 h-px bg-white/50" />
      <div className="absolute bottom-8 left-8 right-8">
        <div className="mb-4 flex items-end gap-2">
          {[42, 68, 52, 82, 38, 72, 56].map((height, index) => (
            <span
              className="w-full rounded-full bg-white/70"
              key={`${song.id}-${height}`}
              style={{
                height: `${height}px`,
                opacity: isPlaying ? 0.92 : 0.46,
                animation: isPlaying
                  ? `soft-pulse ${2.2 + index * 0.16}s ease-in-out infinite`
                  : "none",
              }}
            />
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-white/35 pt-4 text-white">
          <span className="text-xs font-semibold uppercase tracking-[0.24em]">
            {song.code}
          </span>
          <span className="text-xs font-medium uppercase tracking-[0.18em]">
            {song.mood}
          </span>
        </div>
      </div>
    </div>
  );
}

function ModeToggle({ mode, setMode }) {
  return (
    <div className="grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-black/30 p-1">
      {[
        { id: "random", icon: Shuffle },
        { id: "vibe", icon: Sparkles },
      ].map(({ id, icon: Icon }) => {
        const active = mode === id;

        return (
          <button
            aria-pressed={active}
            className={`flex items-center justify-center gap-2 rounded-md px-3 py-3 text-sm font-semibold transition ${
              active
                ? "bg-white text-slate-950 shadow-lg"
                : "text-slate-300 hover:bg-white/10 hover:text-white"
            }`}
            key={id}
            onClick={() => setMode(id)}
            type="button"
          >
            <Icon className="size-4" />
            <span>{MODE_LABELS[id]}</span>
          </button>
        );
      })}
    </div>
  );
}

function QueueList({ queue, mode }) {
  return (
    <div className="space-y-3">
      {queue.map((song, index) => (
        <div
          className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.045] p-3"
          key={song.id}
        >
          <div
            className="flex size-11 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white"
            style={{
              background: `linear-gradient(135deg, ${song.palette[1]}, ${song.palette[2]})`,
            }}
          >
            {index + 1}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-white">{song.title}</div>
            <div className="truncate text-xs text-slate-400">{song.artist}</div>
          </div>
          <div className="text-right">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">
              {song.mood}
            </div>
            <div className="text-xs text-slate-500">
              {mode === "vibe" ? `${song.fit}% fit` : "random"}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function RatingPanel({ currentRating, onRate, ratings, winner }) {
  const randomStats = summarizeRatings(ratings, "random");
  const vibeStats = summarizeRatings(ratings, "vibe");

  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.055] p-5 shadow-panel backdrop-blur-xl">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-teal-200">
            <BarChart3 className="size-4" />
            Validation
          </div>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">
            How well did this song match your mood?
          </h2>
        </div>
        <div className="hidden rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-right sm:block">
          <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Winner</div>
          <div className="text-sm font-semibold text-white">{winner}</div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {[1, 2, 3, 4].map((score) => {
          const active = currentRating?.score === score;

          return (
            <button
              className={`rounded-lg border px-2 py-4 text-center transition ${
                active
                  ? "border-teal-200 bg-teal-200 text-slate-950"
                  : "border-white/10 bg-white/[0.04] text-slate-300 hover:border-white/30 hover:bg-white/10"
              }`}
              key={score}
              onClick={() => onRate(score)}
              type="button"
            >
              <span className="block text-2xl font-bold">{score}</span>
              <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.14em]">
                {score === 1 ? "Low" : score === 4 ? "Strong" : "Match"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-white/10 bg-black/20 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Random avg
          </div>
          <div className="mt-2 text-2xl font-semibold text-white">
            {randomStats.count ? randomStats.average.toFixed(2) : "-"}
          </div>
          <div className="text-xs text-slate-400">{randomStats.count} ratings</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/20 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Vibe avg
          </div>
          <div className="mt-2 text-2xl font-semibold text-white">
            {vibeStats.count ? vibeStats.average.toFixed(2) : "-"}
          </div>
          <div className="text-xs text-slate-400">{vibeStats.count} ratings</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/20 p-4 sm:hidden">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Winner
          </div>
          <div className="mt-2 flex items-center gap-2 text-lg font-semibold text-white">
            <Trophy className="size-4 text-amber-300" />
            {winner}
          </div>
        </div>
        <div className="hidden rounded-lg border border-white/10 bg-black/20 p-4 sm:block">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Total
          </div>
          <div className="mt-2 text-2xl font-semibold text-white">{ratings.length}</div>
          <div className="text-xs text-slate-400">local state entries</div>
        </div>
      </div>
    </section>
  );
}

export default function App() {
  const [signals, setSignals] = useState({ hr: 76, hrv: 61, phase: 0, tick: 0 });
  const [mode, setMode] = useState("vibe");
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentSong, setCurrentSong] = useState(SONGS[1]);
  const [history, setHistory] = useState([]);
  const [queueSeed, setQueueSeed] = useState(24);
  const [playId, setPlayId] = useState(1);
  const [ratings, setRatings] = useState([]);

  const mood = useMemo(() => inferMood(signals.hr, signals.hrv), [signals.hr, signals.hrv]);
  const recentIds = useMemo(() => history.slice(-4).map((song) => song.id), [history]);
  const queue = useMemo(
    () => rankSongs(SONGS, mode, mood, currentSong.id, queueSeed, recentIds).slice(0, 4),
    [currentSong.id, mode, mood.energy, mood.tag, mood.valence, queueSeed, recentIds],
  );
  const currentRating = ratings.find((rating) => rating.playId === playId);
  const randomStats = summarizeRatings(ratings, "random");
  const vibeStats = summarizeRatings(ratings, "vibe");

  const winner = useMemo(() => {
    if (!randomStats.count && !vibeStats.count) return "No ratings yet";
    if (!randomStats.count) return "Vibe Shuffle";
    if (!vibeStats.count) return "Random Shuffle";
    if (Math.abs(randomStats.average - vibeStats.average) < 0.01) return "Tie";
    return vibeStats.average > randomStats.average ? "Vibe Shuffle" : "Random Shuffle";
  }, [randomStats.average, randomStats.count, vibeStats.average, vibeStats.count]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setSignals((current) => {
        const nextTick = current.tick + 1;
        const drift = Math.sin(nextTick / 8) * 8 + Math.sin(nextTick / 21) * 5;
        const hrTarget = 75 + drift;
        const hrvTarget = 62 - drift * 1.2 + Math.cos(nextTick / 12) * 6;

        return {
          tick: nextTick,
          phase: current.phase + 0.38,
          hr: clamp(current.hr + (hrTarget - current.hr) * 0.22 + (Math.random() - 0.5) * 2.8, 58, 104),
          hrv: clamp(current.hrv + (hrvTarget - current.hrv) * 0.2 + (Math.random() - 0.5) * 3.4, 28, 91),
        };
      });
    }, 1200);

    return () => window.clearInterval(id);
  }, []);

  function moveToSong(song) {
    setHistory((items) => [...items.slice(-7), currentSong]);
    setCurrentSong(song);
    setPlayId((value) => value + 1);
    setQueueSeed((value) => value + 19);
    setIsPlaying(true);
  }

  function goNext() {
    moveToSong(queue[0] ?? SONGS[0]);
  }

  function goPrevious() {
    const previous = history.at(-1);
    if (!previous) return;

    setHistory((items) => items.slice(0, -1));
    setCurrentSong(previous);
    setPlayId((value) => value + 1);
    setQueueSeed((value) => value + 11);
    setIsPlaying(true);
  }

  function rateCurrentSong(score) {
    setRatings((items) => {
      const nextRating = {
        playId,
        score,
        mode,
        songId: currentSong.id,
        songTitle: currentSong.title,
        detectedMood: mood.label,
        timestamp: Date.now(),
      };

      if (items.some((rating) => rating.playId === playId)) {
        return items.map((rating) => (rating.playId === playId ? nextRating : rating));
      }

      return [...items, nextRating];
    });
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[linear-gradient(145deg,#05070c_0%,#08120f_38%,#141018_100%)] text-slate-100">
      <div className="pointer-events-none absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] [background-size:48px_48px]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[linear-gradient(180deg,rgba(45,212,191,0.16),transparent)]" />

      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <header className="flex flex-col gap-4 rounded-lg border border-white/10 bg-white/[0.055] p-5 shadow-panel backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-teal-300/20 bg-teal-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-teal-100">
              <Radio className="size-3.5" />
              Live experiment
            </div>
            <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              Vibe Shuffle
            </h1>
            <p className="mt-3 max-w-2xl text-base text-slate-300 sm:text-lg">
              Music that adapts to your emotional state.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:w-[23rem]">
            <StatPill
              detail="current session"
              icon={ListMusic}
              label="Tracks"
              value={SONGS.length}
            />
            <StatPill detail="A/B metric" icon={Trophy} label="Winner" value={winner} />
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[0.92fr_1.25fr_0.93fr]">
          <div className="space-y-5">
            <section className="rounded-lg border border-white/10 bg-white/[0.055] p-5 shadow-panel backdrop-blur-xl">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-teal-200">
                    <BrainCircuit className="size-4" />
                    Current Mood
                  </div>
                  <div className="mt-2 flex items-end gap-3">
                    <h2 className="text-3xl font-semibold tracking-tight text-white">
                      {mood.label}
                    </h2>
                    <span className="mb-1 rounded-md bg-white/10 px-2 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">
                      {mood.tag}
                    </span>
                  </div>
                </div>
                <span
                  className="size-4 rounded-full shadow-[0_0_22px_currentColor]"
                  style={{ color: mood.accent, background: mood.accent }}
                />
              </div>
              <p className="mb-4 text-sm leading-6 text-slate-400">{mood.description}</p>
              <MoodMap mood={mood} />
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-500">
                    Valence
                  </div>
                  <div className="mt-1 text-xl font-semibold text-white">
                    {mood.valence.toFixed(2)}
                  </div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-500">
                    Energy
                  </div>
                  <div className="mt-1 text-xl font-semibold text-white">
                    {mood.energy.toFixed(2)}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-white/10 bg-white/[0.055] p-5 shadow-panel backdrop-blur-xl">
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-teal-200">
                <HeartPulse className="size-4" />
                Physiological Signals
              </div>
              <div className="grid grid-cols-2 gap-3">
                <StatPill
                  detail="heart rate"
                  icon={Activity}
                  label="BPM"
                  value={Math.round(signals.hr)}
                />
                <StatPill
                  detail="heart rate variability"
                  icon={Gauge}
                  label="HRV"
                  value={`${Math.round(signals.hrv)} ms`}
                />
              </div>
              <div className="mt-4">
                <SignalWave
                  accent={mood.accent}
                  hr={signals.hr}
                  hrv={signals.hrv}
                  phase={signals.phase}
                />
              </div>
            </section>
          </div>

          <section className="rounded-lg border border-white/10 bg-white/[0.06] p-5 shadow-panel backdrop-blur-xl">
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-teal-200">
                  <Waves className="size-4" />
                  Music Player
                </div>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                  {MODE_LABELS[mode]}
                </h2>
              </div>
              <ModeToggle mode={mode} setMode={setMode} />
            </div>

            <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
              <CoverArt isPlaying={isPlaying} song={currentSong} />
              <div className="flex min-h-full flex-col justify-between gap-5">
                <div>
                  <div className="mb-4 inline-flex rounded-md border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
                    {currentSong.mood}
                  </div>
                  <h3 className="text-4xl font-semibold tracking-tight text-white">
                    {currentSong.title}
                  </h3>
                  <p className="mt-2 text-lg text-slate-300">{currentSong.artist}</p>
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                      <div className="text-xs uppercase tracking-[0.16em] text-slate-500">
                        Track valence
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-white">
                        {currentSong.valence.toFixed(2)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                      <div className="text-xs uppercase tracking-[0.16em] text-slate-500">
                        Track energy
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-white">
                        {currentSong.energy.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                  <div className="mb-4 h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${isPlaying ? 68 : 34}%`,
                        background: `linear-gradient(90deg, ${currentSong.accent}, ${mood.accent})`,
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-center gap-3">
                    <button
                      aria-label="Previous song"
                      className="flex size-12 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-35"
                      disabled={!history.length}
                      onClick={goPrevious}
                      type="button"
                    >
                      <SkipBack className="size-5" />
                    </button>
                    <button
                      aria-label={isPlaying ? "Pause" : "Play"}
                      className="flex size-16 items-center justify-center rounded-full bg-white text-slate-950 shadow-lg transition hover:scale-[1.03]"
                      onClick={() => setIsPlaying((value) => !value)}
                      type="button"
                    >
                      {isPlaying ? <Pause className="size-7" /> : <Play className="size-7" />}
                    </button>
                    <button
                      aria-label="Next song"
                      className="flex size-12 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white transition hover:bg-white/20"
                      onClick={goNext}
                      type="button"
                    >
                      <SkipForward className="size-5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div className="space-y-5">
            <section className="rounded-lg border border-white/10 bg-white/[0.055] p-5 shadow-panel backdrop-blur-xl">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-teal-200">
                    <Shuffle className="size-4" />
                    Shuffle Mode
                  </div>
                  <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">
                    Selection engine
                  </h2>
                </div>
              </div>
              <ModeToggle mode={mode} setMode={setMode} />
              <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-4 text-sm leading-6 text-slate-300">
                {mode === "vibe"
                  ? `${mood.label} maps to ${mood.tag}; next track is ranked by Valence and Energy distance.`
                  : "Next track is sampled without mood matching, then evaluated against the same rating scale."}
              </div>
            </section>

            <section className="rounded-lg border border-white/10 bg-white/[0.055] p-5 shadow-panel backdrop-blur-xl">
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-teal-200">
                <ListMusic className="size-4" />
                Up Next
              </div>
              <QueueList mode={mode} queue={queue} />
            </section>
          </div>
        </section>

        <RatingPanel
          currentRating={currentRating}
          onRate={rateCurrentSong}
          ratings={ratings}
          winner={winner}
        />
      </div>
    </main>
  );
}
