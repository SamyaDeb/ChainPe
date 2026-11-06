import { useCallback, useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

const KEY = 'chainpe.theme'
const listeners = new Set<() => void>()

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function stored(): Theme | null {
  try {
    const v = window.localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

export function currentTheme(): Theme {
  return stored() ?? systemTheme()
}

export function applyTheme(): void {
  document.documentElement.classList.toggle('dark', currentTheme() === 'dark')
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const onMedia = () => {
    applyTheme()
    onChange()
  }
  media.addEventListener('change', onMedia)
  return () => {
    listeners.delete(onChange)
    media.removeEventListener('change', onMedia)
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
