import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@app/components/ui/dropdown-menu';
import { cn } from '@app/lib/utils';
import { Monitor, Moon, Sun } from 'lucide-react';
import type { ResolvedTheme, ThemePreference } from '@app/hooks/useThemePreference';

interface ThemeSelectorProps {
  resolvedTheme: ResolvedTheme;
  systemTheme: ResolvedTheme;
  themePreference: ThemePreference;
  onThemePreferenceChange: (themePreference: ThemePreference) => void;
}

const THEME_OPTIONS = [
  {
    description: 'Always use the light theme',
    icon: Sun,
    label: 'Light',
    value: 'light',
  },
  {
    description: 'Always use the dark theme',
    icon: Moon,
    label: 'Dark',
    value: 'dark',
  },
  {
    description: 'Match your operating system',
    icon: Monitor,
    label: 'System',
    value: 'system',
  },
] satisfies {
  description: string;
  icon: typeof Sun;
  label: string;
  value: ThemePreference;
}[];

function getPreferenceLabel(themePreference: ThemePreference) {
  return THEME_OPTIONS.find((option) => option.value === themePreference)?.label ?? 'System';
}

function ThemeSelector({
  resolvedTheme,
  systemTheme,
  themePreference,
  onThemePreferenceChange,
}: ThemeSelectorProps) {
  const activeOption =
    THEME_OPTIONS.find((option) => option.value === themePreference) ?? THEME_OPTIONS[2];
  const ActiveIcon = activeOption.icon;
  const preferenceLabel = getPreferenceLabel(themePreference);
  const resolvedThemeLabel = resolvedTheme === 'dark' ? 'dark' : 'light';

  const handleThemePreferenceChange = (value: string) => {
    onThemePreferenceChange(value as ThemePreference);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Theme selector: ${preferenceLabel} (currently ${resolvedThemeLabel})`}
          title={`Theme: ${preferenceLabel} (currently ${resolvedThemeLabel})`}
          className={cn(
            'inline-flex size-9 items-center justify-center rounded-md text-foreground/60',
            'transition-colors hover:bg-accent hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          )}
        >
          <ActiveIcon className="size-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          Theme
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={themePreference} onValueChange={handleThemePreferenceChange}>
          {THEME_OPTIONS.map((option) => {
            const Icon = option.icon;
            const isSystemOption = option.value === 'system';
            return (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                className="items-start gap-2 py-2"
              >
                <Icon className="mt-0.5 size-4 text-muted-foreground" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium leading-none">{option.label}</span>
                  <span className="text-xs leading-tight text-muted-foreground">
                    {isSystemOption ? `Matches system (${systemTheme})` : option.description}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ThemeSelector;
