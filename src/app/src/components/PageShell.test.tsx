import { TooltipProvider } from '@app/components/ui/tooltip';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PageShell from './PageShell';

vi.mock('@app/components/Navigation', () => {
  const MockNavigation = ({
    onThemePreferenceChange,
  }: {
    onThemePreferenceChange: (themePreference: 'light' | 'dark' | 'system') => void;
  }) => {
    return (
      <div data-testid="navigation-mock">
        <button data-testid="dark-button" onClick={() => onThemePreferenceChange('dark')}>
          Use Dark
        </button>
        <button data-testid="light-button" onClick={() => onThemePreferenceChange('light')}>
          Use Light
        </button>
        <button data-testid="system-button" onClick={() => onThemePreferenceChange('system')}>
          Use System
        </button>
      </div>
    );
  };
  return {
    default: MockNavigation,
  };
});

vi.mock('@app/components/PostHogProvider', () => ({
  PostHogProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./PostHogPageViewTracker', () => ({
  PostHogPageViewTracker: () => <div data-testid="posthog-tracker-mock" />,
}));

vi.mock('@app/components/UpdateBanner', () => {
  const MockUpdateBanner = () => {
    return <div data-testid="update-banner-mock">UpdateBanner</div>;
  };
  return {
    default: MockUpdateBanner,
  };
});

const ThemeDisplay = () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return <div data-testid="theme-mode">{isDark ? 'dark' : 'light'}</div>;
};

let matchMediaListeners: ((event: { matches: boolean }) => void)[] = [];

const mockMatchMedia = (matches = false) => {
  matchMediaListeners = [];

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' ? matches : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(
        (eventName: string, listener: (event: { matches: boolean }) => void) => {
          if (eventName === 'change') {
            matchMediaListeners.push(listener);
          }
        },
      ),
      removeEventListener: vi.fn(
        (eventName: string, listener: (event: { matches: boolean }) => void) => {
          if (eventName === 'change') {
            matchMediaListeners = matchMediaListeners.filter(
              (currentListener) => currentListener !== listener,
            );
          }
        },
      ),
      dispatchEvent: vi.fn(),
    })),
  });
};

const emitSystemThemeChange = (matches: boolean) => {
  matchMediaListeners.forEach((listener) => listener({ matches }));
};

const renderPageShell = (initialPath = '/', children: React.ReactNode = null) => {
  return render(
    <TooltipProvider delayDuration={0}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<PageShell />}>
            <Route
              path="*"
              element={
                <>
                  <ThemeDisplay />
                  {children}
                </>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
};

describe('PageShell', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');

    mockMatchMedia(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should render navigation component', async () => {
    renderPageShell();
    await waitFor(() => {
      expect(screen.getByTestId('navigation-mock')).toBeInTheDocument();
    });
  });

  it('should render update banner', async () => {
    renderPageShell();
    await waitFor(() => {
      expect(screen.getByTestId('update-banner-mock')).toBeInTheDocument();
    });
  });

  it('should render PostHog tracker', async () => {
    renderPageShell();
    await waitFor(() => {
      expect(screen.getByTestId('posthog-tracker-mock')).toBeInTheDocument();
    });
  });

  it('should start in light mode by default when system preference is light', async () => {
    renderPageShell();
    await waitFor(() => {
      expect(screen.getByTestId('theme-mode')).toHaveTextContent('light');
    });
  });

  it('should start in dark mode when system preference is dark', async () => {
    mockMatchMedia(true);

    renderPageShell();
    await waitFor(() => {
      // Check the DOM attribute directly since ThemeDisplay doesn't re-render on changes
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
  });

  it('should toggle dark mode when toggle button is clicked', async () => {
    renderPageShell();
    const user = userEvent.setup();

    await waitFor(() => {
      // Initially may be 'light' or null (no attribute)
      const theme = document.documentElement.getAttribute('data-theme');
      expect(theme === 'light' || theme === null).toBe(true);
    });

    await user.click(screen.getByTestId('dark-button'));

    await waitFor(() => {
      // Check the DOM attribute directly since ThemeDisplay doesn't re-render on changes
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
  });

  it('should persist dark mode preference in localStorage', async () => {
    renderPageShell();
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByTestId('theme-mode')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('dark-button'));

    expect(localStorage.getItem('darkMode')).toBe('true');
  });

  it('should remove the explicit preference when choosing system theme', async () => {
    localStorage.setItem('darkMode', 'true');
    renderPageShell();
    const user = userEvent.setup();

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    await user.click(screen.getByTestId('system-button'));

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    });
    expect(localStorage.getItem('darkMode')).toBeNull();
  });

  it('should follow system preference changes while using system theme', async () => {
    renderPageShell();

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    });

    act(() => {
      emitSystemThemeChange(true);
    });

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    act(() => {
      emitSystemThemeChange(false);
    });

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    });
  });

  it('should ignore system preference changes while using an explicit preference', async () => {
    localStorage.setItem('darkMode', 'false');
    renderPageShell();

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    });

    act(() => {
      emitSystemThemeChange(true);
    });

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    });
  });

  it('should restore dark mode preference from localStorage', async () => {
    localStorage.setItem('darkMode', 'true');

    renderPageShell();

    await waitFor(() => {
      // Check the DOM attribute directly since ThemeDisplay doesn't re-render on changes
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
  });
});
