import {
  getProjectDirectoryNameFromTitle,
  getProjectTitleFromUniqueDirectoryName,
  getUniqueDuplicateProjectName,
  getUniqueProjectNameFromNames,
} from '@src/lib/projectName'
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'

describe('projectName', () => {
  it('advances colliding numeric suffixes without losing precision', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 80n }), (index) => {
        const existing = [0n, 1n, 2n].map((offset) => `part-${index + offset}`)
        expect(getUniqueProjectNameFromNames(existing[0], existing)).toBe(
          `part-${index + 3n}`
        )
      })
    )
  })
  it.each([
    { name: 'part', existing: ['PART', 'part-1'], expected: 'part-2' },
    { name: 'part-9', existing: ['part-9'], expected: 'part-10' },
    {
      name: 'part-9007199254740992',
      existing: ['part-9007199254740992', 'part-9007199254740993'],
      expected: 'part-9007199254740994',
    },
    {
      name: 'part-$n',
      existing: ['part-9007199254740992'],
      expected: 'part-9007199254740993',
    },
    { name: 'part[$n', existing: [], expected: 'part[0' },
    { name: 'part.$n', existing: ['partX9'], expected: 'part.0' },
    { name: 'part-$n', existing: ['other-part-9-extra'], expected: 'part-0' },
    { name: 'part-$n', existing: ['part-9.kcl'], expected: 'part-0' },
    {
      name: 'part-$n.kcl',
      existing: ['part-04.kcl', 'part-007.kcl', 'part-9Xkcl'],
      expected: 'part-8.kcl',
    },
    { name: 'part-$n', existing: ['PART-9'], expected: 'part-10' },
    { name: 'part-$n', existing: [], expected: 'part-0' },
    {
      name: 'part-$nn',
      existing: ['part-01', 'part-2'],
      expected: 'part-03',
    },
  ])('resolves $name from directory names', ({ name, existing, expected }) => {
    expect(getUniqueProjectNameFromNames(name, existing)).toBe(expected)
  })

  it('derives filesystem-friendly project directory names from titles', () => {
    expect(
      getProjectDirectoryNameFromTitle(' My Cool Project! ', 'untitled')
    ).toBe('my-cool-project')
    expect(
      getProjectDirectoryNameFromTitle('Café Bracket / v2', 'untitled')
    ).toBe('cafe-bracket-v2')
  })

  it.each([
    'CON',
    'prn',
    'AUX',
    'nul',
    'COM1',
    'com9',
    'LPT1',
    'lpt9',
    'COM¹',
    'LPT²',
  ])('avoids reserved Windows directory names for title %s', (title) => {
    expect(getProjectDirectoryNameFromTitle(title, 'untitled')).toMatch(
      /^project-/
    )
  })

  it('keeps ordinary names and numeric suffixes outside the reserved range', () => {
    for (const title of ['console', 'com0', 'com10', 'lpt0', 'lpt10'])
      expect(getProjectDirectoryNameFromTitle(title, 'untitled')).toBe(title)
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

  it('uses copy suffixes for duplicated project names', () => {
    expect(getUniqueDuplicateProjectName('bla-1', ['bla-1'])).toBe('bla-1-copy')
    expect(
      getUniqueDuplicateProjectName('bla-1', [
        'bla-1',
        'BLA-1-COPY',
        'bla-1-copy-1',
      ])
    ).toBe('bla-1-copy-2')
  })
})
