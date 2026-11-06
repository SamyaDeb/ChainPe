import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { SpendingTracker } from '../src/spending.js'

describe('SpendingTracker', () => {
  it('allows spending within per-call limit', () => {
    const tracker = new SpendingTracker({
      maxPerCall: '1.00',
      maxPerDay: '10.00'
    })
    expect(() => tracker.check('0.50')).not.toThrow()
  })

  it('rejects spending over per-call limit', () => {
    const tracker = new SpendingTracker({
      maxPerCall: '0.10',
      maxPerDay: '10.00'
    })
    expect(() => tracker.check('0.50')).toThrow()
  })

  it('rejects spending over daily limit', () => {
    const tracker = new SpendingTracker({
      maxPerCall: '5.00',
      maxPerDay: '1.00'
    })
    tracker.record('0.80', '0xABC', 'base')
    expect(() => tracker.check('0.30')).toThrow()
  })

  it('records spending in history', () => {
    const tracker = new SpendingTracker({
      maxPerCall: '10.00',
      maxPerDay: '100.00'
    })
    tracker.record('1.00', '0xABC', 'base')
    tracker.record('2.00', 'GABC...', 'stellar')

    const summary = tracker.getSummary()
    expect(summary.recentPayments).toHaveLength(2)
    expect(summary.recentPayments[0].recipient).toBe('0xABC')
    expect(summary.recentPayments[0].amount).toBe('1.00')
    expect(summary.recentPayments[1].recipient).toBe('GABC...')
  })

  it('returns correct summary', () => {
    const tracker = new SpendingTracker({
      maxPerCall: '1.00',
      maxPerDay: '20.00'
    })
    tracker.record('0.05', '0xABC', 'base')

    const summary = tracker.getSummary()
    expect(summary.limits.maxPerCall).toBe('1.00')
    expect(summary.limits.maxPerDay).toBe('20.00')
    expect(parseFloat(summary.spentToday)).toBeGreaterThan(0)
    expect(parseFloat(summary.spentSession)).toBeGreaterThan(0)
  })

  it('caps recent payments at 10', () => {
    const tracker = new SpendingTracker({
      maxPerCall: '10.00',
      maxPerDay: '1000.00'
    })
    for (let i = 0; i < 15; i++) {
      tracker.record('0.01', `addr-${i}`, 'base')
    }

    const summary = tracker.getSummary()
    expect(summary.recentPayments).toHaveLength(10)
  })
})

describe('SpendingTracker.paymentCap', () => {
  it('is the per-call limit while the day has room', () => {
    expect(new SpendingTracker({ maxPerCall: '0.10', maxPerDay: '1.00' }).paymentCap()).toBe('0.100000')
  })

  it('shrinks to what is left today', () => {
    const tracker = new SpendingTracker({ maxPerCall: '0.10', maxPerDay: '0.015' })
    tracker.record('0.01', '0xabc', 'arc-testnet')
    expect(tracker.paymentCap()).toBe('0.005000')
  })

  it('throws when the day is used up', () => {
    const tracker = new SpendingTracker({ maxPerCall: '0.10', maxPerDay: '0.01' })
    tracker.record('0.01', '0xabc', 'arc-testnet')
    expect(() => tracker.paymentCap()).toThrow(/Daily limit/)
  })
})

describe('SpendingTracker with a file', () => {
  const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chainpe-spend-')), 'spending.json')

  it("keeps today's total across a restart", () => {
    const file = tmp()
    const first = new SpendingTracker({ maxPerCall: '0.10', maxPerDay: '0.05' }, file)
    first.record('0.04', '0xabc', 'arc-testnet')
    const restarted = new SpendingTracker({ maxPerCall: '0.10', maxPerDay: '0.05' }, file)
    expect(restarted.getSummary().spentToday).toBe('0.0400')
    expect(() => restarted.check('0.02')).toThrow(/daily limit/)
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
  })

  it("starts at zero on a new day, or when the file is unreadable", () => {
    const file = tmp()
    fs.writeFileSync(file, JSON.stringify({ day: '2000-01-01', spentToday: 9, history: [] }))
    expect(new SpendingTracker({ maxPerCall: '1', maxPerDay: '1' }, file).getSummary().spentToday).toBe('0.0000')
    fs.writeFileSync(file, '{')
    expect(new SpendingTracker({ maxPerCall: '1', maxPerDay: '1' }, file).getSummary().spentToday).toBe('0.0000')
  })
})
