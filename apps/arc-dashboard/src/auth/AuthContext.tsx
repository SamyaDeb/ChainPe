import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getAddress, isAddressEqual } from 'viem'
import { createApi, isApiError, type ChainPeApi } from '@/api/client'
import type { Me } from '@/api/schema'
import { USE_MOCK } from '@/lib/env'
import {
  clearSession,
  getActiveToken,
  isExpired,
  loadSession,
  saveSession,
  setActiveToken,
  type Session,
} from '@/lib/session'
import { errorText, getProvider, getWalletClient, isUserRejection } from '@/lib/wallet'
import { checkSiweMessage } from './siwe'

export type SignInStep = 'idle' | 'connecting' | 'nonce' | 'signing' | 'verifying'

export type IssueKind =
  | 'config'
  | 'no_wallet'
  | 'rejected'
  | 'not_registered'
  | 'chain_unavailable'
  | 'rate_limited'
  | 'invalid_siwe'
  | 'session_ended'
  | 'error'

export interface AuthIssue {
  kind: IssueKind
  message: string
  /** For rate_limited: the time (ms since epoch) when retrying is fine. */
  retryAt?: number
}

export type MockScenario = 'pro' | 'free' | 'unregistered'

interface MeState {
  token: string
  data: Me | null
  error: unknown
}

interface AuthValue {
  mock: boolean
  session: Session | null
  api: ChainPeApi
  me: Me | null
  meError: unknown
  step: SignInStep
  pendingMessage: string | null
  issue: AuthIssue | null
  dismissIssue: () => void
  signInWithWallet: () => Promise<void>
  signInMock: (scenario: MockScenario) => Promise<void>
  signOut: () => Promise<void>
  reloadMe: () => void
  refreshMe: () => Promise<Me | null>
  /** Handles an API error that ends the session. Returns true when it did, so callers stop. */
  handleError: (e: unknown) => boolean
}

const AuthContext = createContext<AuthValue | null>(null)

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

function issueFromError(e: unknown): AuthIssue {
  if (isUserRejection(e)) return { kind: 'rejected', message: 'The signature request was declined in your wallet.' }
  if (isApiError(e)) {
    switch (e.code) {
      case 'not_registered':
        return { kind: 'not_registered', message: e.message }
      case 'chain_unavailable':
        return { kind: 'chain_unavailable', message: 'Arc could not be read right now. This does not mean your wallet is unregistered. Retry in a moment.' }
      case 'rate_limited': {
        const wait = e.retryAfterSec ?? 10
        return { kind: 'rate_limited', message: 'Too many sign-in attempts.', retryAt: Date.now() + wait * 1000 }
      }
      case 'invalid_siwe':
        return { kind: 'invalid_siwe', message: 'That sign-in message was not accepted. It may have expired or been used. Get a new one and try again.' }
      default:
        return { kind: 'error', message: e.message }
    }
  }
  return { kind: 'error', message: errorText(e) }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => {
    const stored = loadSession()
    const usable = stored && stored.token.startsWith('mock:') === USE_MOCK ? stored : null
    if (!usable) clearSession()
    setActiveToken(usable?.token ?? null)
    return usable
  })
  const [meState, setMeState] = useState<MeState | null>(null)
  const [meTick, setMeTick] = useState(0)
  const [step, setStep] = useState<SignInStep>('idle')
  const [pendingMessage, setPendingMessage] = useState<string | null>(null)
  const [issue, setIssue] = useState<AuthIssue | null>(null)

  const api = useMemo(() => createApi(getActiveToken), [])

  const clearAll = useCallback((next: AuthIssue | null) => {
    clearSession()
    setActiveToken(null)
    setSession(null)
    setMeState(null)
    setIssue(next)
  }, [])

  // A restored live session may belong to a wallet account that changed while the page was closed.
  const [restoredAddress] = useState<string | null>(() => (USE_MOCK ? null : (session?.address ?? null)))
  useEffect(() => {
    const provider = getProvider()
    if (!restoredAddress || !provider) return
    let cancelled = false
    provider
      .request({ method: 'eth_accounts' })
      .then((accounts) => {
        const first = accounts[0]
        // An empty list means a locked wallet: leave the session alone.
        if (cancelled || !first) return
        if (!isAddressEqual(first, restoredAddress as `0x${string}`)) {
          clearAll({ kind: 'session_ended', message: 'Your wallet account changed, so you were signed out.' })
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [restoredAddress, clearAll])

  const startSession = useCallback((s: Session) => {
    setActiveToken(s.token)
    saveSession(s)
    setMeState(null)
    setIssue(null)
    setSession(s)
  }, [])

  const handleError = useCallback(
    (e: unknown): boolean => {
      if (!isApiError(e)) return false
      if (e.status === 401 || e.code === 'unauthorized') {
        clearAll({ kind: 'session_ended', message: 'Your session ended. Sign in again to continue.' })
        return true
      }
      if (e.code === 'not_registered') {
        clearAll({ kind: 'not_registered', message: e.message })
        return true
      }
      return false
    },
    [clearAll],
  )

  // Load the provider record for the session. The address always comes from the session, never the URL.
  const token = session?.token ?? null
  const sessionAddress = session?.address ?? null
  useEffect(() => {
    if (!token || !sessionAddress) return
    let cancelled = false
    api
      .me()
      .then((data) => {
        if (cancelled) return
        if (!isAddressEqual(data.address as `0x${string}`, sessionAddress as `0x${string}`)) {
          clearAll({ kind: 'error', message: 'The server returned a different account than the one you signed in with. You were signed out.' })
          return
        }
        setMeState({ token, data, error: null })
      })
      .catch((e: unknown) => {
        if (cancelled || handleError(e)) return
        setMeState({ token, data: null, error: e })
      })
    return () => {
      cancelled = true
    }
  }, [api, token, sessionAddress, meTick, handleError, clearAll])

  // End the session at expiry.
  const expiresAt = session?.expiresAt ?? null
  useEffect(() => {
    if (!expiresAt) return
    const ms = Date.parse(expiresAt) - Date.now()
    const id = window.setTimeout(
      () => clearAll({ kind: 'session_ended', message: 'Your session expired. Sign in again to continue.' }),
      Math.max(0, Math.min(ms, 2_000_000_000)),
    )
    return () => window.clearTimeout(id)
  }, [expiresAt, clearAll])

  // A different wallet account, or a disconnect, ends the session and drops all cached data.
  useEffect(() => {
    if (!sessionAddress || USE_MOCK) return
    const provider = getProvider()
    if (!provider) return
    const onAccounts = (accounts: readonly string[]) => {
      const first = accounts[0]
      if (!first || !isAddressEqual(first as `0x${string}`, sessionAddress as `0x${string}`)) {
        clearAll({ kind: 'session_ended', message: 'Your wallet account changed, so you were signed out.' })
      }
    }
    const onDisconnect = () =>
      clearAll({ kind: 'session_ended', message: 'Your wallet disconnected, so you were signed out.' })
    provider.on('accountsChanged', onAccounts)
    provider.on('disconnect', onDisconnect)
    return () => {
      provider.removeListener('accountsChanged', onAccounts)
      provider.removeListener('disconnect', onDisconnect)
    }
  }, [sessionAddress, clearAll])

  const signInWithWallet = useCallback(async () => {
    setIssue(null)
    const provider = getProvider()
    if (!provider) {
      setIssue({ kind: 'no_wallet', message: 'No browser wallet was found. Install MetaMask or Rabby, then reload this page.' })
      return
    }
    try {
      setStep('connecting')
      const wallet = getWalletClient(provider)
      const [account] = await wallet.requestAddresses()
      if (!account) throw new Error('Your wallet did not share an account.')
      const address = getAddress(account)

      setStep('nonce')
      const nonce = await api.nonce(address)
      const problem = checkSiweMessage(nonce.message, address, window.location.host)
      if (problem) {
        setIssue({ kind: 'config', message: problem })
        return
      }

      setPendingMessage(nonce.message)
      setStep('signing')
      const signature = await wallet.signMessage({ account: address, message: nonce.message })

      setStep('verifying')
      const verified = await api.verify(nonce.message, signature)
      if (!isAddressEqual(verified.address as `0x${string}`, address)) {
        throw new Error('The server signed you in as a different address than your wallet.')
      }
      startSession({ token: verified.token, address: verified.address, expiresAt: verified.expiresAt })
    } catch (e) {
      setIssue(issueFromError(e))
    } finally {
      setStep('idle')
      setPendingMessage(null)
    }
  }, [api, startSession])

  const signInMock = useCallback(
    async (scenario: MockScenario) => {
      setIssue(null)
      setStep('verifying')
      try {
        const { mockSignIn } = await import('@/mock/mockApi')
        startSession(await mockSignIn(scenario))
      } catch (e) {
        setIssue(issueFromError(e))
      } finally {
        setStep('idle')
      }
    },
    [startSession],
  )

  const signOut = useCallback(async () => {
    try {
      await api.logout()
    } catch {
      /* the session is cleared either way */
    } finally {
      clearAll(null)
    }
  }, [api, clearAll])

  const refreshMe = useCallback(async (): Promise<Me | null> => {
    try {
      const data = await api.me()
      const t = getActiveToken()
      if (t) setMeState({ token: t, data, error: null })
      return data
    } catch (e) {
      handleError(e)
      return null
    }
  }, [api, handleError])

  const reloadMe = useCallback(() => {
    setMeState(null)
    setMeTick((t) => t + 1)
  }, [])

  const current = meState && meState.token === token ? meState : null
  const value: AuthValue = {
    mock: USE_MOCK,
    session: session && !isExpired(session) ? session : null,
    api,
    me: current?.data ?? null,
    meError: current?.error ?? null,
    step,
    pendingMessage,
    issue,
    dismissIssue: () => setIssue(null),
    signInWithWallet,
    signInMock,
    signOut,
    reloadMe,
    refreshMe,
    handleError,
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
