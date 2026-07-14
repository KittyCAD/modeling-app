import { sanitizeProjectName } from '@src/lib/projectName'
import { describe, expect, it } from 'vitest'

describe('sanitizeProjectName', () => {
  it('keeps project names within one filesystem-safe path segment', () => {
    expect(sanitizeProjectName(' Bracket: rev 2? ', 'fallback')).toBe(
      'Bracket- rev 2-'
    )
    expect(sanitizeProjectName('../copied', 'fallback')).toBe('-copied')
    expect(sanitizeProjectName('.hidden', 'fallback')).toBe('hidden')
    expect(sanitizeProjectName('trailing. ', 'fallback')).toBe('trailing')
  })

  it('avoids Windows reserved device names', () => {
    expect(sanitizeProjectName('CON', 'fallback')).toBe('CON-project')
    expect(sanitizeProjectName('lpt1.txt', 'fallback')).toBe('lpt1-project.txt')
  })

  it('uses a sanitized fallback for empty names', () => {
    expect(sanitizeProjectName('...', '.fallback')).toBe('fallback')
  })
})
