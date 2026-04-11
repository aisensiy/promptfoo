import { TooltipProvider } from '@app/components/ui/tooltip';
import { mockMatchMedia as installMatchMedia, restoreBrowserMocks } from '@app/tests/browserMocks';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ThemeSelector from './ThemeSelector';

const SYSTEM_DARK_MODE_QUERY = '(prefers-color-scheme: dark)';

let matchMedia: ReturnType<typeof installMatchMedia>;

const renderThemeSelector = () => {
  return render(
    <TooltipProvider delayDuration={0}>
      <ThemeSelector />
    </TooltipProvider>,
  );
};

const installSystemTheme = (isDark = false) => {
  matchMedia = installMatchMedia({
    matches: (query) => query === SYSTEM_DARK_MODE_QUERY && isDark,
  });
};

const emitSystemThemeChange = (matches: boolean) => {
  const mediaQueryList = matchMedia.mock.results[matchMedia.mock.results.length - 1]
    ?.value as MediaQueryList;

  act(() => {
    mediaQueryList.dispatchEvent({ matches } as MediaQueryListEvent);
  });
};

const getThemeButton = () => screen.getByRole('button', { name: /theme preference/i });

describe('ThemeSelector', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
    installSystemTheme();
  });

  afterEach(() => {
    restoreBrowserMocks();
  });

  it('renders a compact three-way theme button', () => {
    renderThemeSelector();

    expect(
      screen.getByRole('button', {
        name: 'Theme preference: System theme (currently light). Switch to Dark theme.',
      }),
    ).toHaveClass('size-9');
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('cycles through system, dark, light, and back to system', async () => {
    const user = userEvent.setup();
    renderThemeSelector();

    await user.click(
      screen.getByRole('button', {
        name: 'Theme preference: System theme (currently light). Switch to Dark theme.',
      }),
    );
    expect(
      screen.getByRole('button', {
        name: 'Theme preference: Dark theme (currently dark). Switch to Light theme.',
      }),
    ).toBeInTheDocument();

    await user.click(getThemeButton());
    expect(
      screen.getByRole('button', {
        name: 'Theme preference: Light theme (currently light). Switch to System theme.',
      }),
    ).toBeInTheDocument();

    await user.click(getThemeButton());
    expect(
      screen.getByRole('button', {
        name: 'Theme preference: System theme (currently light). Switch to Dark theme.',
      }),
    ).toBeInTheDocument();
  });

  it('uses the system preference when no explicit preference is stored', async () => {
    restoreBrowserMocks();
    installSystemTheme(true);

    renderThemeSelector();

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
    expect(localStorage.getItem('darkMode')).toBeNull();
  });

  it('persists explicit dark and light preferences', async () => {
    const user = userEvent.setup();
    renderThemeSelector();

    await user.click(getThemeButton());

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(localStorage.getItem('darkMode')).toBe('true');

    await user.click(getThemeButton());

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    });
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(localStorage.getItem('darkMode')).toBe('false');
  });

  it('removes an explicit preference when system is selected', async () => {
    const user = userEvent.setup();
    localStorage.setItem('darkMode', 'false');
    renderThemeSelector();

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    });

    await user.click(getThemeButton());

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    });
    expect(localStorage.getItem('darkMode')).toBeNull();
  });

  it('follows system changes only when system preference is selected', async () => {
    const user = userEvent.setup();
    renderThemeSelector();

    emitSystemThemeChange(true);

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    await user.click(getThemeButton());
    emitSystemThemeChange(false);

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
  });
});
