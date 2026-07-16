import {
  getProjectDirectoryNameFromTitle,
  getProjectTitleFromUniqueDirectoryName,
} from '@src/lib/projectName'
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

  it('preserves project title casing when applying a unique directory suffix', () => {
    expect(
      getProjectTitleFromUniqueDirectoryName({
        requestedProjectTitle: 'Test',
        requestedProjectDirectoryName: 'test',
        uniqueProjectDirectoryName: 'test-1',
      })
    ).toBe('Test-1')
  })

  it('leaves project titles unchanged when the directory was not uniqued', () => {
    expect(
      getProjectTitleFromUniqueDirectoryName({
        requestedProjectTitle: 'My Cool Project',
        requestedProjectDirectoryName: 'my-cool-project',
        uniqueProjectDirectoryName: 'my-cool-project',
      })
    ).toBe('My Cool Project')
  })
})
