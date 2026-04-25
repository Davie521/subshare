"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  DEFAULT_THEME_MODE,
  parseThemeMode,
  resolveTheme,
  THEME_COOKIE_NAME,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemeMode,
} from "@/lib/theme";

type ThemeContextValue = {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyResolved(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.dataset.theme = resolved;
}

function writeCookie(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  // 1 year, path-wide. Non-HttpOnly because the boot script needs to read it.
  document.cookie = `${THEME_COOKIE_NAME}=${mode}; path=/; max-age=31536000; samesite=lax`;
}

function readSystemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return DEFAULT_THEME_MODE;
  return parseThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY));
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Lazy init: localStorage is only safe in the client. On the server we
  // return the default; the inline boot script has already applied the right
  // class to <html> so there's no flash. JSX never branches on these values.
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    resolveTheme(readStoredMode(), readSystemPrefersDark()),
  );

  // After mount: re-apply the class (boot script handled SSR; this is the
  // belt-and-suspenders for soft navigations and tests).
  useEffect(() => {
    applyResolved(resolved);
    // We intentionally only run on mount — subsequent updates flow through
    // setMode / matchMedia / storage handlers, which already call applyResolved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to system color-scheme changes when in auto mode.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (mode !== "auto") return;
      const r = resolveTheme("auto", mql.matches);
      setResolved(r);
      applyResolved(r);
    };
    if (mql.addEventListener) {
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    }
    mql.addListener(handler);
    return () => mql.removeListener(handler);
  }, [mode]);

  // Cross-tab sync via the storage event.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY) return;
      const next = parseThemeMode(e.newValue);
      setModeState(next);
      const r = resolveTheme(next, readSystemPrefersDark());
      setResolved(r);
      applyResolved(r);
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    }
    writeCookie(next);
    const r = resolveTheme(next, readSystemPrefersDark());
    setResolved(r);
    applyResolved(r);
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      mode: DEFAULT_THEME_MODE,
      resolved: "light",
      setMode: () => {},
    };
  }
  return ctx;
}
