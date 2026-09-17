import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSonner } from "sonner";

export const THEME_OPTIONS = [
  { id: "aurora", label: "Aurora", description: "Mint and coral" },
  { id: "sapphire", label: "Sapphire", description: "Cobalt and sky" },
  { id: "terracotta", label: "Terracotta", description: "Clay and rose" },
  { id: "plum", label: "Plum", description: "Violet and orchid" },
  { id: "gold", label: "Gold", description: "Amber and ink" },
] as const;

export type ColorTheme = (typeof THEME_OPTIONS)[number]["id"];
export type ThemeMode = "light" | "dark";
export type NotificationSound = "success" | "error" | "warning" | "info";

type ThemeContextValue = {
  colorTheme: ColorTheme;
  mode: ThemeMode;
  soundEnabled: boolean;
  setColorTheme: (theme: ColorTheme) => void;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
  setSoundEnabled: (enabled: boolean) => void;
  playNotificationSound: (type: NotificationSound) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const COLOR_THEME_KEY = "loop:color-theme";
const MODE_KEY = "loop:theme-mode";
const SOUND_KEY = "loop:notification-sounds";

function readStoredTheme(): ColorTheme {
  if (typeof window === "undefined") return "aurora";
  const stored = window.localStorage.getItem(COLOR_THEME_KEY);
  return THEME_OPTIONS.some((option) => option.id === stored) ? (stored as ColorTheme) : "aurora";
}

function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(MODE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function readStoredSoundPreference(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SOUND_KEY) === "on";
}

function applyThemeToDocument(mode: ThemeMode, colorTheme: ColorTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
  root.classList.toggle("light", mode === "light");
  root.dataset.theme = colorTheme;
  root.style.colorScheme = mode;
}

function NotificationSoundBridge() {
  const { toasts } = useSonner();
  const { playNotificationSound } = useTheme();
  const seenRef = useRef<Set<string | number>>(new Set());

  useEffect(() => {
    for (const currentToast of toasts) {
      if (currentToast.delete || seenRef.current.has(currentToast.id)) continue;
      seenRef.current.add(currentToast.id);
      if (currentToast.type === "success" || currentToast.type === "error" || currentToast.type === "warning" || currentToast.type === "info") {
        playNotificationSound(currentToast.type);
      }
    }
  }, [playNotificationSound, toasts]);

  return null;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("dark");
  const [colorTheme, setColorThemeState] = useState<ColorTheme>("aurora");
  const [soundEnabled, setSoundEnabledState] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    setModeState(readStoredMode());
    setColorThemeState(readStoredTheme());
    setSoundEnabledState(readStoredSoundPreference());
  }, []);

  useEffect(() => {
    applyThemeToDocument(mode, colorTheme);
  }, [mode, colorTheme]);

  const setMode = useCallback((nextMode: ThemeMode) => {
    setModeState(nextMode);
    window.localStorage.setItem(MODE_KEY, nextMode);
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === "dark" ? "light" : "dark");
  }, [mode, setMode]);

  const setColorTheme = useCallback((nextTheme: ColorTheme) => {
    setColorThemeState(nextTheme);
    window.localStorage.setItem(COLOR_THEME_KEY, nextTheme);
  }, []);

  const setSoundEnabled = useCallback((enabled: boolean) => {
    setSoundEnabledState(enabled);
    window.localStorage.setItem(SOUND_KEY, enabled ? "on" : "off");
  }, []);

  const playNotificationSound = useCallback((type: NotificationSound) => {
    if (!soundEnabled || typeof window === "undefined") return;
    try {
      const AudioContextCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;
      const audioContext = audioContextRef.current ?? new AudioContextCtor();
      audioContextRef.current = audioContext;
      if (audioContext.state === "suspended") void audioContext.resume();

      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const now = audioContext.currentTime;
      const frequency = type === "error" ? 220 : type === "warning" ? 330 : type === "info" ? 440 : 660;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.045, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.14);
    } catch {
      // Audio is decorative and must never affect the underlying notification.
    }
  }, [soundEnabled]);

  const value = useMemo<ThemeContextValue>(() => ({
    colorTheme,
    mode,
    soundEnabled,
    setColorTheme,
    setMode,
    toggleMode,
    setSoundEnabled,
    playNotificationSound,
  }), [colorTheme, mode, playNotificationSound, setColorTheme, setMode, setSoundEnabled, soundEnabled, toggleMode]);

  return (
    <ThemeContext.Provider value={value}>
      <NotificationSoundBridge />
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
