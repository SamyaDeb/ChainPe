import { useCallback, useEffect, useRef, useState } from 'react'
import { isApiError } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'

export interface Resource<T> {
  /** Data for the current key. Null while loading the first time or after the key changed. */
  data: T | null
  /** The last error. May be set together with data when a refresh failed. */
  error: unknown
  loading: boolean
  /** When `data` was fetched. */
  updatedAt: number | null
  reload: () => void
}

interface State<T> {
  key: string
  data: T | null
  error: unknown
  updatedAt: number | null
}

interface Options {
  /** Poll interval in ms. Polling pauses while the tab is hidden and never overlaps requests. */
  pollMs?: number
  enabled?: boolean
}

const RETRY_DELAY_MS = 6_000

/**
 * Loads data for `key`. Data stays on screen during refetches. A new key clears the data, so a previous
 * range or filter is never shown as the current one.
 */
export function useResource<T>(key: string, fetcher: () => Promise<T>, options: Options = {}): Resource<T> {
  const { pollMs, enabled = true } = options
  const { handleError } = useAuth()
  const [state, setState] = useState<State<T>>({ key, data: null, error: null, updatedAt: null })
  const [tick, setTick] = useState(0)
  const fetcherRef = useRef(fetcher)

  useEffect(() => {
    fetcherRef.current = fetcher
  })

  useEffect(() => {
    if (!enabled) return
    const flags: { cancelled: boolean; busy: boolean; first: boolean; timer: number | undefined } = {
      cancelled: false,
      busy: false,
      first: true,
      timer: undefined,
    }

    const schedule = (delay: number) => {
      window.clearTimeout(flags.timer)
      if (!flags.cancelled && pollMs) flags.timer = window.setTimeout(() => void run(), delay)
    }

    const run = async () => {
      if (flags.busy || flags.cancelled) return
      if (!flags.first && document.visibilityState !== 'visible') {
        schedule(pollMs ?? 0)
        return
      }
      flags.first = false
      flags.busy = true
      let delay = pollMs ?? 0
      try {
        const data = await fetcherRef.current()
        if (flags.cancelled) return
        setState({ key, data, error: null, updatedAt: Date.now() })
      } catch (e) {
        if (flags.cancelled) return
        if (handleError(e)) return
        const wait = isApiError(e) && e.retryAfterSec !== null ? e.retryAfterSec * 1000 : RETRY_DELAY_MS
        delay = Math.max(delay, wait)
        setState((s) => ({
          key,
          data: s.key === key ? s.data : null,
          error: e,
          updatedAt: s.key === key ? s.updatedAt : null,
        }))
      } finally {
        flags.busy = false
        schedule(delay)
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible' && pollMs) {
        window.clearTimeout(flags.timer)
        void run()
      }
    }

    void run()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      flags.cancelled = true
      window.clearTimeout(flags.timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [key, enabled, pollMs, tick, handleError])

  const reload = useCallback(() => {
    setState((s) => ({ ...s, error: null }))
    setTick((t) => t + 1)
  }, [])

  const current = state.key === key
  const data = current ? state.data : null
  const error = current ? state.error : null
  return { data, error, loading: enabled && data === null && error === null, updatedAt: current ? state.updatedAt : null, reload }
}
