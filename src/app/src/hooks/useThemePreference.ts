import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';

export type ResolvedTheme = 'light' | 'dark';
export type ThemePreference = ResolvedTheme | 'system';

const DARK_MODE_STORAGE_KEY = 'darkMode';
const SYSTEM_DARK_MODE_QUERY = '(prefers-color-scheme: dark)';

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }

  return window.matchMedia(SYSTEM_DARK_MODE_QUERY).matches ? 'dark' : 'light';
}

function getStoredThemePreference(): ThemePreference {
  let savedMode: string | null = null;

  try {
    savedMode = localStorage.getItem(DARK_MODE_STORAGE_KEY);
  } catch {
    return 'system';
  }

  if (savedMode === 'true') {
    return 'dark';
  }

  if (savedMode === 'false') {
    return 'light';
  }

  return 'system';
}

function persistThemePreference(preference: ThemePreference) {
  try {
    if (preference === 'system') {
      localStorage.removeItem(DARK_MODE_STORAGE_KEY);
      return;
    }

    localStorage.setItem(DARK_MODE_STORAGE_KEY, String(preference === 'dark'));
  } catch (error) {
    console.debug('[ThemeSelector] Failed to persist theme preference', { error, preference });
  }
}

function applyResolvedTheme(theme: ResolvedTheme) {
  if (typeof document === 'undefined') {
    return;
  }

  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }

  document.documentElement.style.colorScheme = theme;
}

export function useThemePreference() {
  const [themePreference, setThemePreferenceState] =
    useState<ThemePreference>(getStoredThemePreference);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);
  const resolvedTheme = themePreference === 'system' ? systemTheme : themePreference;

  useLayoutEffect(() => {
    applyResolvedTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const systemPreference = window.matchMedia(SYSTEM_DARK_MODE_QUERY);

    const handleSystemPreferenceChange = ({ matches }: { matches: boolean }) => {
      setSystemTheme(matches ? 'dark' : 'light');
    };

    systemPreference.addEventListener('change', handleSystemPreferenceChange);

    return () => {
      systemPreference.removeEventListener('change', handleSystemPreferenceChange);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === DARK_MODE_STORAGE_KEY || event.key === null) {
        setThemePreferenceState(getStoredThemePreference());
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const setThemePreference = useCallback((preference: ThemePreference) => {
    persistThemePreference(preference);
    setThemePreferenceState(preference);
  }, []);

  return useMemo(
    () => ({
      resolvedTheme,
      setThemePreference,
      systemTheme,
      themePreference,
    }),
    [resolvedTheme, setThemePreference, systemTheme, themePreference],
  );
}
