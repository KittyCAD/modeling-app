import { getProjectDirectoryNameFromTitle } from '@src/lib/projectName'
import { describe, expect, it } from 'vitest'

describe('projectName', () => {
  it('derives filesystem-friendly project directory names from titles', () => {
    expect(
      getProjectDirectoryNameFromTitle(' My Cool Project! ', 'untitled')
    ).toBe('my-cool-project')
    expect(
      getProjectDirectoryNameFromTitle('Café Bracket / v2', 'untitled')
    ).toBe('cafe-bracket-v2')
  })

  it('falls back when the title has no directory-safe characters', () => {
    expect(getProjectDirectoryNameFromTitle('!!!', 'untitled')).toBe('untitled')
  })
})
