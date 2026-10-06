'use client';

/**
 * Theme picker: system, light, or dark.
 *
 * The tokens in globals.css already answer to `.light` and `.dark` on <html>,
 * and to the OS when neither is set. This component only decides which class
 * is there and remembers the choice in localStorage. The inline script in
 * layout.tsx reads the same key before first paint so a reload does not flash;
 * `applyTheme` is kept in sync with it by hand.
 */
import { useLayoutEffect, useState } from 'react';
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';

export type Theme = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'theme';

const THEMES: { value: Theme; label: string; Icon: LucideIcon }[] = [
  { value: 'system', label: 'Follow the system theme', Icon: Monitor },
  { value: 'light', label: 'Light theme', Icon: Sun },
  { value: 'dark', label: 'Dark theme', Icon: Moon },
];

function isTheme(value: unknown): value is Theme {
  return value === 'system' || value === 'light' || value === 'dark';
}

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  if (theme !== 'system') root.classList.add(theme);
}

export function ThemeToggle() {
  // Server-rendered as `system` so hydration matches; the real choice lands
  // before paint. The page itself never flashes: the inline script in
  // layout.tsx has already set the class by the time React runs. Re-applying
  // here also restores the class after React clears <html> on the dev Strict
  // Mode remount.
  const [theme, setTheme] = useState<Theme>('system');
  useLayoutEffect(() => {
    const stored = readStoredTheme();
    setTheme(stored);
    applyTheme(stored);
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    applyTheme(next);
    try {
      if (next === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode or blocked storage: the choice still applies for this page.
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex rounded-md border border-border bg-surface p-0.5 font-mono text-xs"
    >
      {THEMES.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          title={label}
          onClick={() => choose(value)}
          className={`rounded p-1 ${
            theme === value ? 'bg-surface-2 text-foreground' : 'text-muted hover:text-foreground'
          }`}
        >
          <Icon aria-hidden className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
