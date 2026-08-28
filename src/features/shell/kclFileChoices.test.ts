import { describe, expect, it } from 'vitest'
import type { ProjectFile } from '@src/contracts/projects'
import { kclFileChoices } from '@src/features/shell/kclFileChoices'

const file = (path: string): ProjectFile => ({
  path,
  name: path.split('/').pop() ?? path,
  kind: 'file',
})

const directory = (path: string, children: ProjectFile[]): ProjectFile => ({
  path,
  name: path.split('/').pop() ?? path,
  kind: 'directory',
  children,
})

describe('choosing a KCL file', () => {
  it('groups files by the folder they sit in, root first', () => {
    const groups = kclFileChoices([
      directory('parts', [file('parts/bolt.kcl')]),
      file('main.kcl'),
    ])

    expect(groups).toEqual([
      { directory: '', files: [{ path: 'main.kcl', name: 'main.kcl' }] },
      {
        directory: 'parts',
        files: [{ path: 'parts/bolt.kcl', name: 'bolt.kcl' }],
      },
    ])
  })

  /* Executing a markdown file is not a thing the session will do. */
  it('offers only KCL files', () => {
    const groups = kclFileChoices([
      file('README.md'),
      file('project.toml'),
      file('main.kcl'),
    ])

    expect(groups).toEqual([
      { directory: '', files: [{ path: 'main.kcl', name: 'main.kcl' }] },
    ])
  })

  it('reaches files nested any number of folders deep', () => {
    const groups = kclFileChoices([
      directory('a', [directory('a/b', [file('a/b/deep.kcl')])]),
    ])

    expect(groups).toEqual([
      {
        directory: 'a/b',
        files: [{ path: 'a/b/deep.kcl', name: 'deep.kcl' }],
      },
    ])
  })

  it('sorts folders and their files by name', () => {
    const groups = kclFileChoices([
      directory('z', [file('z/one.kcl')]),
      directory('a', [file('a/second.kcl'), file('a/first.kcl')]),
    ])

    expect(groups.map((group) => group.directory)).toEqual(['a', 'z'])
    expect(groups[0].files.map((entry) => entry.name)).toEqual([
      'first.kcl',
      'second.kcl',
    ])
  })

  it('leaves out a folder holding no KCL at all', () => {
    const groups = kclFileChoices([directory('docs', [file('docs/notes.md')])])

    expect(groups).toEqual([])
  })

  it('has nothing to offer for an empty project', () => {
    expect(kclFileChoices([])).toEqual([])
  })
})
