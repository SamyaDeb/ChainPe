/** Money formatting tests. Run with `bun run test`. */
import assert from 'node:assert/strict'
import { formatScore, formatUsdc, formatUsdcExact, parseAtomic, permille, scaleToPixels } from '../src/lib/money'

const cases: Array<[string, string]> = [
  ['0', '$0.00'],
  ['1', '$0.000001'],
  ['9999', '$0.009999'],
  ['10000', '$0.01'],
  ['10049', '$0.01'],
  ['10050', '$0.01'],
  ['15000', '$0.02'],
  ['14999', '$0.01'],
  ['1000000', '$1.00'],
  ['1234567890', '$1,234.57'],
  // Above 2^53: a JS number would lose precision here.
  ['9007199254740993', '$9,007,199,254.74'],
  ['9007199254740993000000', '$9,007,199,254,740,993.00'],
]

let failed = 0
for (const [input, expected] of cases) {
  const actual = formatUsdc(input)
  try {
    assert.equal(actual, expected)
  } catch {
    failed += 1
    console.error(`formatUsdc(${input}): expected ${expected}, got ${actual}`)
  }
}

function check(name: string, fn: () => void): void {
  try {
    fn()
  } catch (e) {
    failed += 1
    console.error(`${name}:`, e instanceof Error ? e.message : e)
  }
}

check('invalid amounts show a dash', () => {
  assert.equal(formatUsdc('abc'), '\u2014')
  assert.equal(formatUsdc('-5'), '\u2014')
  assert.equal(formatUsdc('1.5'), '\u2014')
  assert.equal(parseAtomic('12x'), null)
})
check('exact format trims zeros but keeps two places', () => {
  assert.equal(formatUsdcExact('5000000'), '$5.00')
  assert.equal(formatUsdcExact('5500000'), '$5.50')
  assert.equal(formatUsdcExact('1'), '$0.000001')
})
check('score from value and decimals', () => {
  assert.equal(formatScore('95', 0), '95')
  assert.equal(formatScore('9550', 2), '95.5')
  assert.equal(formatScore('5', 2), '0.05')
  assert.equal(formatScore('-40', 0), '-40')
  assert.equal(formatScore('x', 0), null)
})
check('bigint ratios', () => {
  assert.equal(scaleToPixels(50n, 100n, 144), 72)
  assert.equal(scaleToPixels(0n, 100n, 144), 0)
  assert.equal(scaleToPixels(9007199254740993n, 9007199254740993n, 144), 144)
  assert.equal(permille(1n, 4n), 250)
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('money tests passed')
