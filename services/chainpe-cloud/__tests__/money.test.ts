/** Money stays a string or bigint end to end, so a JS number must never touch it. */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = new URL('../src/', import.meta.url).pathname

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []
  )
}

describe('money handling', () => {
  it('never converts an amount to a JS number', () => {
    const offenders = files(SRC).flatMap((file) =>
      fs
        .readFileSync(file, 'utf-8')
        .split('\n')
        .filter((line) => /(Number|parseFloat|parseInt)\([^)]*(atomic|amount|spend|revenue|value(?!Decimals)|balance|price)/i.test(line))
        .map((line) => `${path.basename(file)}: ${line.trim()}`)
    )
    expect(offenders).toEqual([])
  })
})
