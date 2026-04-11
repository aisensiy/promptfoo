import { Tooltip, TooltipContent, TooltipTrigger } from '@app/components/ui/tooltip';
import { type ThemePreference, useThemePreference } from '@app/hooks/useThemePreference';
import { cn } from '@app/lib/utils';
import { Monitor, Moon, Sun } from 'lucide-react';

const THEME_ORDER = ['light', 'system', 'dark'] as const satisfies readonly ThemePreference[];

const NEXT_THEME_PREFERENCE = {
  dark: 'light',
  light: 'system',
  system: 'dark',
} satisfies Record<ThemePreference, ThemePreference>;

const THEME_OPTIONS = {
  dark: {
    icon: Moon,
    label: 'Dark theme',
  },
  light: {
    icon: Sun,
    label: 'Light theme',
  },
  system: {
    icon: Monitor,
    label: 'System theme',
  },
} satisfies Record<
  ThemePreference,
  {
    icon: typeof Sun;
    label: string;
  }
>;

function getNextThemePreference(themePreference: ThemePreference): ThemePreference {
  return NEXT_THEME_PREFERENCE[themePreference];
}

function ThemeSelector() {
  const { resolvedTheme, setThemePreference, systemTheme, themePreference } = useThemePreference();
  const nextThemePreference = getNextThemePreference(themePreference);
  const currentThemeLabel = THEME_OPTIONS[themePreference].label;
  const nextThemeLabel = THEME_OPTIONS[nextThemePreference].label;
  const tooltipLabel =
    themePreference === 'system' ? `${currentThemeLabel} (${systemTheme})` : currentThemeLabel;

  const handleThemePreferenceChange = () => {
    setThemePreference(nextThemePreference);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleThemePreferenceChange}
          aria-label={`Theme preference: ${currentThemeLabel} (currently ${resolvedTheme}). Switch to ${nextThemeLabel}.`}
          className={cn(
            'relative inline-flex size-9 items-center justify-center rounded-full p-2 text-foreground/60',
            'transition-all duration-200 hover:bg-black/[0.04] hover:text-foreground hover:rotate-[15deg]',
            'dark:hover:bg-white/[0.08]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          )}
        >
          {THEME_ORDER.map((preference) => {
            const Icon = THEME_OPTIONS[preference].icon;

            return (
              <Icon
                key={preference}
                aria-hidden="true"
                className={cn(
                  'absolute size-5 transition-all duration-200',
                  preference === themePreference
                    ? 'rotate-0 opacity-100'
                    : 'pointer-events-none rotate-90 opacity-0',
                )}
              />
            );
          })}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltipLabel}</TooltipContent>
    </Tooltip>
  );
}

export default ThemeSelector;
