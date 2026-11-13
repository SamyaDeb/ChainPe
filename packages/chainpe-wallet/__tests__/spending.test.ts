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
