import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react'

/** A tiny path router: plain paths, relative links, no #fragments. */

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange)
  return () => window.removeEventListener('popstate', onChange)
}

/** The path prefix the app is served under: '' at the root, '/dashboard' under /dashboard/. */
const BASE = import.meta.env.BASE_URL.replace(/\/+$/, '')

/** Adds the prefix to an app path such as '/billing'. '/' becomes the prefix itself, or '/' at the root. */
export function withBase(to: string): string {
  return to === '/' ? BASE || '/' : BASE + to
}

/** The location path with the prefix and any trailing slash removed. Always starts with '/'. */
function snapshot(): string {
  let path = window.location.pathname
  if (BASE && (path === BASE || path.startsWith(`${BASE}/`))) path = path.slice(BASE.length)
  path = path.replace(/\/+$/, '')
  return path === '' ? '/' : path
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export function navigate(to: string): void {
  const target = withBase(to)
  if (target === window.location.pathname + window.location.search) return
  window.history.pushState(null, '', target)
  window.dispatchEvent(new PopStateEvent('popstate'))
  window.scrollTo(0, 0)
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string
}

export function Link({ to, onClick, children, ...rest }: LinkProps) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(to)
  }
  return (
    <a href={withBase(to)} onClick={handle} {...rest}>
      {children}
    </a>
  )
}
