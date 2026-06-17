'use client'

/**
 * ThemeSwitcher.tsx — the persisted theme + light/dark control (Redesign v2 §2.7).
 *
 * Lets you pick the active theme (Current / Liquid Glass / Vibrant Tinted /
 * the three Paper themes) and flip light/dark. Switching just sets `data-theme`
 * and `data-mode` on <html>; those attributes drive the whole token + glass +
 * paper system in globals.css.
 *
 * Persistence:
 *   - SQLite `AppSetting` (key "uiThemePref", via the `settings` tRPC router) is
 *     the SOURCE OF TRUTH — it survives restarts and is the project-standard
 *     store for app preferences.
 *   - localStorage holds the SAME value purely as an anti-flash cache: an inline
 *     script in layout.tsx reads it and applies the attributes BEFORE first
 *     paint, so the app never flashes the default dark theme on launch.
 *
 * On mount we reconcile from AppSetting (canonical) in case the cache is stale.
 */

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc/client'

type Mode = 'dark' | 'light'
type Theme =
  | 'current'
  | 'liquid'
  | 'vibrant'
  | 'paper-notebook'
  | 'paper-bujo'
  | 'paper-manuscript'
  | 'almanac'
  | 'clean-modern'

const THEMES: { id: Theme; label: string }[] = [
  { id: 'current', label: 'Current' },
  { id: 'liquid', label: 'Liquid Glass' },
  { id: 'vibrant', label: 'Vibrant Tinted' },
  { id: 'paper-notebook', label: 'Paper · Notebook' },
  { id: 'paper-bujo', label: 'Paper · Bullet Journal' },
  { id: 'paper-manuscript', label: 'Paper · Manuscript' },
  { id: 'almanac', label: 'Almanac' },
  { id: 'clean-modern', label: 'Clean Modern' },
]
const THEME_IDS = THEMES.map((t) => t.id)

/** AppSetting + localStorage key the preference JSON is stored under. */
export const THEME_PREF_KEY = 'uiThemePref'

interface ThemePref {
  theme: Theme
  mode: Mode
}

function isTheme(v: unknown): v is Theme {
  return typeof v === 'string' && (THEME_IDS as string[]).includes(v)
}

/** Apply a preference to <html> and mirror it into the anti-flash cache. */
function applyPref(pref: ThemePref) {
  const el = document.documentElement
  el.setAttribute('data-theme', pref.theme)
  el.setAttribute('data-mode', pref.mode)
  try {
    localStorage.setItem(THEME_PREF_KEY, JSON.stringify(pref))
  } catch {
    // localStorage unavailable (private mode etc.) — non-fatal, SQLite still persists.
  }
}

export function ThemeSwitcher() {
  const [mode, setMode] = useState<Mode>('light')
  const [theme, setTheme] = useState<Theme>('clean-modern')

  // NOTE: do NOT use `staleTime: Infinity` here. It would cache the first value
  // for the entire life of the page AND disable refetch-on-focus — so a window
  // left open while the preference changes (e.g. edited elsewhere) stays frozen
  // on the stale value and renders the wrong mode forever. Instead we treat the
  // value as always-stale so it re-reads the canonical SQLite value on mount and
  // whenever the window regains focus; the reconcile effect below re-applies it.
  const saved = trpc.settings.get.useQuery(
    { key: THEME_PREF_KEY },
    { retry: false, refetchOnMount: 'always', refetchOnWindowFocus: true },
  )
  const setSetting = trpc.settings.set.useMutation()

  // Sync local state from whatever is currently on <html> (the inline anti-flash
  // script may already have applied the cached preference before React loaded).
  useEffect(() => {
    const el = document.documentElement
    const m = el.getAttribute('data-mode')
    const t = el.getAttribute('data-theme')
    if (m === 'light' || m === 'dark') setMode(m)
    if (isTheme(t)) setTheme(t)
  }, [])

  // Reconcile from the canonical SQLite value once it resolves. If it differs
  // from what the cache applied, the canonical value wins.
  useEffect(() => {
    if (saved.isLoading || !saved.data) return
    try {
      const parsed = JSON.parse(saved.data) as Partial<ThemePref>
      const next: ThemePref = {
        theme: isTheme(parsed.theme) ? parsed.theme : 'current',
        mode: parsed.mode === 'light' ? 'light' : 'dark',
      }
      applyPref(next)
      setTheme(next.theme)
      setMode(next.mode)
    } catch {
      // Corrupt value — ignore, keep current.
    }
  }, [saved.isLoading, saved.data])

  /** Persist a change to both <html>/cache (instant) and SQLite (durable). */
  function persist(next: ThemePref) {
    applyPref(next)
    setSetting.mutate({ key: THEME_PREF_KEY, value: JSON.stringify(next) })
  }

  function pickTheme(t: Theme) {
    // Paper themes (and the warm-paper Almanac) are designed to be read on a
    // light page; their dark variants read as muddy brown/green (red-green
    // colour weakness). So selecting any of them auto-switches to light mode —
    // the user can still toggle dark afterward with the sun/moon button. The
    // Almanac additionally defines its warm-paper tokens at the theme level
    // (not gated on mode), so it stays warm even if toggled to dark.
    const nextMode: Mode = t.startsWith('paper-') || t === 'almanac' ? 'light' : mode
    setTheme(t)
    setMode(nextMode)
    persist({ theme: t, mode: nextMode })
  }
  function toggleMode() {
    const next: Mode = mode === 'dark' ? 'light' : 'dark'
    setMode(next)
    persist({ theme, mode: next })
  }

  return (
    <div className="ml-auto flex items-center gap-2">
      <select
        value={theme}
        onChange={(e) => pickTheme(e.target.value as Theme)}
        aria-label="Theme"
        className="rounded-lg border border-ink/10 bg-surface px-2 py-1.5 text-xs text-ink
                   focus:outline-none focus:ring-1 focus:ring-ink/20 cursor-pointer"
      >
        {THEMES.map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={toggleMode}
        aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        className="rounded-lg border border-ink/10 px-2.5 py-1.5 text-base leading-none
                   text-muted transition-colors hover:bg-ink/10 hover:text-ink"
      >
        {mode === 'dark' ? '☀️' : '🌙'}
      </button>
    </div>
  )
}
