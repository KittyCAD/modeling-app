import { describe, expect, it } from 'vitest'
import {
  formatRelativeTime,
  formatRevision,
  matchesQuery,
} from '@src/lib/format'

const now = new Date('2026-06-01T12:00:00Z').getTime()
const ago = (ms: number) => now - ms

describe('formatRelativeTime', () => {
  it('reports anything under a minute as now', () => {
    expect(formatRelativeTime(ago(0), now)).toBe('now')
    expect(formatRelativeTime(ago(59_000), now)).toBe('now')
  })

  it('steps up through minutes, hours, days, weeks, and years', () => {
    expect(formatRelativeTime(ago(60_000), now)).toBe('1m')
    expect(formatRelativeTime(ago(90 * 60_000), now)).toBe('1h')
    expect(formatRelativeTime(ago(36 * 3_600_000), now)).toBe('1d')
    expect(formatRelativeTime(ago(10 * 86_400_000), now)).toBe('1w')
    expect(formatRelativeTime(ago(400 * 86_400_000), now)).toBe('1y')
  })

  it('clamps future timestamps rather than showing a negative age', () => {
    // Clock skew between a cloud source and the local machine is normal, and
    // "-3m" in a title block reads as a bug.
    expect(formatRelativeTime(now + 60_000, now)).toBe('now')
  })
})

describe('formatRevision', () => {
  it('pads so the field does not change width as it climbs', () => {
    expect(formatRevision(1)).toBe('01')
    expect(formatRevision(9)).toBe('09')
    expect(formatRevision(41)).toBe('41')
    expect(formatRevision(100)).toBe('100')
  })

  it('marks an unknown revision rather than showing zero', () => {
    expect(formatRevision(undefined)).toBe('—')
  })
})

describe('matchesQuery', () => {
  it('matches case-insensitively on a substring', () => {
    expect(matchesQuery('bracket-v2', 'BRACK')).toBe(true)
    expect(matchesQuery('bracket-v2', 'v2')).toBe(true)
    expect(matchesQuery('bracket-v2', 'enclosure')).toBe(false)
  })

  it('treats an empty or whitespace query as no filter', () => {
    expect(matchesQuery('anything', '')).toBe(true)
    expect(matchesQuery('anything', '   ')).toBe(true)
  })
})
