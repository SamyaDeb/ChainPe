const STUDIO_ORIGINS = ['https://studio.arc.io', 'https://studio-staging.arc.io']
const HANDSHAKE_TIMEOUT_MS = 1500
const NAVIGATED_DEBOUNCE_MS = 100
const trimSlash = (url: string) => url.replace(/\/+$/, '')
const ownBase = () => trimSlash(new URL(import.meta.env?.BASE_URL ?? '/', `${window.location.origin}/`).href)
const ABSOLUTE_URL = /^([a-z][a-z\d+.-]*:|\/\/)/i
const UNSAFE_PATH_CHAR = /%(?![\da-f]{2})|[^\w\-.~!$&'()*+,;=:@%/]/giu
let known: string | undefined
let listening = false
const waiters = new Set<(url: string) => void>()
let syncInstalled = false

export type ShareSyncEnv = {
  self: unknown
  top: unknown
  parent: { postMessage(message: unknown, targetOrigin: string): void }
  location: Pick<Location, 'pathname' | 'search'> & { ancestorOrigins?: ArrayLike<string> }
  referrer?: string
  history: Pick<History, 'pushState' | 'replaceState'>
  addEventListener(type: 'popstate', listener: () => void): void
}

const originOf = (url: string) => {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

export function parentStudioOrigins(ancestorOrigins?: ArrayLike<string>, referrer = ''): string[] {
  const known = [ancestorOrigins?.[0] ?? '', originOf(referrer)].find((o) => STUDIO_ORIGINS.includes(o))
  return known ? [known] : STUDIO_ORIGINS
}

const onMessage = (event: MessageEvent) => {
  if (!STUDIO_ORIGINS.includes(event.origin) || event.source !== window.parent) return
  const data = event.data as { type?: string; url?: unknown } | null
  if (data?.type !== 'arc-share:url' || typeof data.url !== 'string' || !data.url.startsWith(`${event.origin}/`)) return
  known = trimSlash(data.url)
  listening = false
  window.removeEventListener('message', onMessage)
  for (const resolve of waiters) resolve(known)
  waiters.clear()
}

export function getShareBase(): Promise<string> {
  if (window.self === window.top) return Promise.resolve(ownBase())
  if (known) return Promise.resolve(known)
  return new Promise<string>((resolve) => {
    const timer = setTimeout(() => {
      waiters.delete(settle)
      resolve(ownBase())
    }, HANDSHAKE_TIMEOUT_MS)
    const settle = (url: string) => {
      clearTimeout(timer)
      resolve(url)
    }
    waiters.add(settle)
    if (!listening) {
      listening = true
      window.addEventListener('message', onMessage)
    }
    for (const origin of parentStudioOrigins(window.location.ancestorOrigins, document.referrer)) {
      window.parent.postMessage({ type: 'arc-share:hello' }, origin)
    }
  })
}

export async function buildShareLink(path: string): Promise<string> {
  if (ABSOLUTE_URL.test(path)) throw new TypeError('buildShareLink expects a path such as "/claim/ab", not an absolute URL')
  const [, route, rest] = /^([^?#]*)(.*)$/s.exec(path) as RegExpExecArray
  const encoded = route.replace(UNSAFE_PATH_CHAR, (char) => (char === '%' ? '%25' : encodeURIComponent(char)))
  return (await getShareBase()) + (encoded.startsWith('/') ? encoded : `/${encoded}`) + rest
}

export function installShareSync(env: ShareSyncEnv = window): void {
  if (env.self === env.top || syncInstalled) return
  syncInstalled = true

  const targets = parentStudioOrigins(env.location.ancestorOrigins, env.referrer ?? document.referrer)
  let lastPosted: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const post = () => {
    const { pathname, search } = env.location
    const key = pathname + search
    if (key === lastPosted) return
    lastPosted = key
    for (const origin of targets) {
      env.parent.postMessage({ type: 'arc-share:navigated', path: pathname, search }, origin)
    }
  }

  const schedule = () => {
    timer ??= setTimeout(() => {
      timer = undefined
      post()
    }, NAVIGATED_DEBOUNCE_MS)
  }

  for (const method of ['pushState', 'replaceState'] as const) {
    const original = env.history[method]
    env.history[method] = function (this: History, ...args: Parameters<History['pushState']>) {
      const result = original.apply(this, args)
      schedule()
      return result
    }
  }
  env.addEventListener('popstate', schedule)
  post()
}
