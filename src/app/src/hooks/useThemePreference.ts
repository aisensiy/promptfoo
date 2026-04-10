import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';

export type ResolvedTheme = 'light' | 'dark';
export type ThemePreference = ResolvedTheme | 'system';

const DARK_MODE_STORAGE_KEY = 'darkMode';
const SYSTEM_DARK_MODE_QUERY = '(prefers-color-scheme: dark)';

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia(SYSTEM_DARK_MODE_QUERY).matches ? 'dark' : 'light';
}

function getStoredThemePreference(): ThemePreference {
  const savedMode = localStorage.getItem(DARK_MODE_STORAGE_KEY);

  if (savedMode === 'true') {
    return 'dark';
  }

  if (savedMode === 'false') {
    return 'light';
  }

  return 'system';
}

function persistThemePreference(preference: ThemePreference) {
  if (preference === 'system') {
    localStorage.removeItem(DARK_MODE_STORAGE_KEY);
    return;
  }

  localStorage.setItem(DARK_MODE_STORAGE_KEY, String(preference === 'dark'));
}

function applyResolvedTheme(theme: ResolvedTheme) {
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
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === DARK_MODE_STORAGE_KEY) {
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
