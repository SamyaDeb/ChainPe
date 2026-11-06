import { useCallback, useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

const KEY = 'chainpe.theme'
const listeners = new Set<() => void>()

function stored(): Theme | null {
  try {
    const v = window.localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

/** Light by default, to match the landing page. Dark is a choice the user makes with the toggle. */
export function currentTheme(): Theme {
  return stored() ?? 'light'
}

export function applyTheme(): void {
  document.documentElement.classList.toggle('dark', currentTheme() === 'dark')
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useSyncExternalStore(subscribe, currentTheme, (): Theme => 'light')
  const toggle = useCallback(() => {
    const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark'
    try {
      window.localStorage.setItem(KEY, next)
    } catch {
      /* preference not saved */
    }
    applyTheme()
    for (const l of listeners) l()
  }, [])
  return { theme, toggle }
}
