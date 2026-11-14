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

interface CoreOptions extends Options {
  /** Returns true when it handled the error (e.g. ended the session), so the hook stops quietly. */
  onError?: (e: unknown) => boolean
  /** Double the wait after each failure in a row, up to MAX_BACKOFF_MS. Off: a fixed RETRY_DELAY_MS. */
  backoff?: boolean
}

const RETRY_DELAY_MS = 6_000
const MAX_BACKOFF_MS = 60_000

/**
 * Loads data for `key`. Data stays on screen during refetches. A new key clears the data, so a previous
 * range or filter is never shown as the current one.
 */
function useResourceCore<T>(key: string, fetcher: () => Promise<T>, options: CoreOptions): Resource<T> {
  const { pollMs, enabled = true, onError, backoff = false } = options
  const [state, setState] = useState<State<T>>({ key, data: null, error: null, updatedAt: null })
  const [tick, setTick] = useState(0)
  const fetcherRef = useRef(fetcher)

  useEffect(() => {
    fetcherRef.current = fetcher
  })

  useEffect(() => {
    if (!enabled) return
    const flags: { cancelled: boolean; busy: boolean; first: boolean; timer: number | undefined; failures: number } = {
      cancelled: false,
      busy: false,
      first: true,
      timer: undefined,
      failures: 0,
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
        flags.failures = 0
        setState({ key, data, error: null, updatedAt: Date.now() })
      } catch (e) {
        if (flags.cancelled) return
        if (onError?.(e)) return
        flags.failures += 1
        const base = backoff ? Math.min(MAX_BACKOFF_MS, Math.max(pollMs ?? RETRY_DELAY_MS, 1000) * 2 ** flags.failures) : RETRY_DELAY_MS
        const wait = isApiError(e) && e.retryAfterSec !== null ? e.retryAfterSec * 1000 : base
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
      if (document.visibilityState === 'visible' && pollMs && (!backoff || flags.failures === 0)) {
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
  }, [key, enabled, pollMs, tick, onError, backoff])

  const reload = useCallback(() => {
    setState((s) => ({ ...s, error: null }))
    setTick((t) => t + 1)
  }, [])

  const current = state.key === key
  const data = current ? state.data : null
  const error = current ? state.error : null
  return { data, error, loading: enabled && data === null && error === null, updatedAt: current ? state.updatedAt : null, reload }
}

/** For signed-in screens: an error that ends the session signs the user out instead of showing. */
export function useResource<T>(key: string, fetcher: () => Promise<T>, options: Options = {}): Resource<T> {
  const { handleError } = useAuth()
  return useResourceCore(key, fetcher, { ...options, onError: handleError })
}

/** For the public pages, which have no session. Backs off on errors in a row. */
export function usePublicResource<T>(key: string, fetcher: () => Promise<T>, options: Options = {}): Resource<T> {
  return useResourceCore(key, fetcher, { ...options, backoff: true })
}
