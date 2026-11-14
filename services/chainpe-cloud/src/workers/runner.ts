/** Runs a job on an interval, one at a time, backing off on errors. A failing job never takes the API down. */
import { safeMessage } from '../util.js'

const MAX_BACKOFF_MS = 60_000

export interface Loop {
  wake(): void
  stop(): void
}

/**
 * `job` returns true when there is more to do soon, for catching up. `catchUpMs` paces that,
 * because the public RPC answers 429 to an unpaced scan.
 */
export function startLoop(name: string, intervalMs: number, job: () => Promise<boolean | void>, catchUpMs = 0): Loop {
  let stopped = false
  let timer: NodeJS.Timeout | undefined
  let resume: (() => void) | undefined
  let backoff = intervalMs

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      resume = resolve
      timer = setTimeout(resolve, ms)
    })

  void (async () => {
    while (!stopped) {
      try {
        const more = await job()
        backoff = intervalMs
        await sleep(more === true ? catchUpMs : intervalMs)
      } catch (err) {
        console.error(`${name} failed, retrying in ${backoff} ms: ${safeMessage(err)}`)
        await sleep(backoff)
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
      }
    }
  })()

  return {
    wake() {
      if (timer) clearTimeout(timer)
      resume?.()
    },
    stop() {
      stopped = true
      this.wake()
    },
  }
}
