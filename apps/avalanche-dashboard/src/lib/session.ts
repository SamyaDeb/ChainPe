/** The signed-in session. sessionStorage only: never localStorage, never the URL. */

export interface Session {
  token: string
  address: string
  expiresAt: string
}

const KEY = 'chainpe.session'

export function isExpired(session: Session, now = Date.now()): boolean {
  const at = Date.parse(session.expiresAt)
  return Number.isNaN(at) || at <= now
}

export function loadSession(): Session | null {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { token, address, expiresAt } = parsed as Record<string, unknown>
    if (typeof token !== 'string' || typeof address !== 'string' || typeof expiresAt !== 'string') return null
    const session: Session = { token, address, expiresAt }
    return isExpired(session) ? null : session
  } catch {
    return null
  }
}

export function saveSession(session: Session): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(session))
  } catch {
    /* storage unavailable: the session lives in memory only */
  }
}

export function clearSession(): void {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    /* nothing to clear */
  }
}

/**
 * The token used by the API client. Kept in module scope and set at the moment a session starts or ends,
 * so a screen that mounts right after sign-in never sends a request without it.
 */
let activeToken: string | null = null

export function setActiveToken(token: string | null): void {
  activeToken = token
}

export function getActiveToken(): string | null {
  return activeToken
}
