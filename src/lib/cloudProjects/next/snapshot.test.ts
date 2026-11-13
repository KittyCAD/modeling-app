import fc from 'fast-check'
import { posix, win32 } from '@chainner/node-path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { projectFromCloudSnapshot } from '@src/lib/cloudProjects/next/snapshot'
import {
  CLOUD_DIRECTORIES_FILE,
  encodeCloudDirectories,
} from '@src/lib/cloudProjects/runtime/directories'
import type { Project } from '@src/lib/projectSession/next/types'

const environment = vi.hoisted((): { style: 'posix' | 'win32' } => ({
  style: 'posix',
}))
vi.mock('@src/lib/fs-zds', async () => {
  const paths = await import('@chainner/node-path')
  return {
    default: {
      join: (...parts: string[]) => paths[environment.style].join(...parts),
    },
  }
})

const segment = fc.stringMatching(/^[a-z]{1,6}$/)
const directory = fc
  .array(segment, { minLength: 1, maxLength: 4 })
  .map((parts) => posix.join(...parts.map((part) => `d-${part}`)))
const filePath = fc
  .tuple(fc.array(segment, { maxLength: 3 }), segment)
  .map(([parents, name]) =>
    posix.join(...parents.map((part) => `d-${part}`), `f-${name}.kcl`)
  )
const file = (relativePath: string, contents: string) => ({
  relativePath,
  data: new TextEncoder().encode(contents),
})

describe.each(['posix', 'win32'] as const)(
  'cloud snapshot with %s paths',
  (style) => {
    const paths = style === 'posix' ? posix : win32
    const root =
      style === 'posix' ? '/projects/bracket' : 'C:\\projects\\bracket'
    const previous = (): Project => ({
      storage: { type: 'cloud', projectId: 'one' },
      contents: {
        name: 'bracket',
        path: root,
        children: [
          {
            name: 'stale.kcl',
            path: paths.join(root, 'stale.kcl'),
            children: null,
          },
        ],
      },
      metadata: {
        title: 'Previous title',
        defaultFile: 'stale.kcl',
        readWriteAccess: false,
        library: { libraryPath: paths.dirname(root), libraryType: 'directory' },
      },
    })
    beforeEach(() => {
      environment.style = style
    })

    it('rebuilds exactly the downloaded files and directories without mutating the previous project', () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(filePath, { maxLength: 15 }),
          fc.uniqueArray(directory, { maxLength: 8 }),
          (names, emptyDirectories) => {
            const original = previous()
            const before = structuredClone(original)
            const files = names.map((name) => file(name, 'contents'))
            files.push({
              relativePath: CLOUD_DIRECTORIES_FILE,
              data: encodeCloudDirectories(emptyDirectories),
            })
            const result = projectFromCloudSnapshot(original, files)
            const leaves: string[] = []
            const directories: string[] = []
            const visit = (node: Project['contents']['children'][number]) => {
              expect(node.name).toBe(paths.basename(node.path))
              if (node.children === null) {
                leaves.push(node.path)
                return
              }
              directories.push(node.path)
              for (const child of node.children) {
                expect(paths.dirname(child.path)).toBe(node.path)
                visit(child)
              }
            }
            visit(result.contents)
            const expectedDirectories = new Set([root])
            for (const name of [
              ...files.map((entry) => entry.relativePath),
              ...emptyDirectories.map((name) => `${name}/placeholder`),
            ]) {
              let parent = paths.dirname(paths.join(root, name))
              while (parent !== root) {
                expectedDirectories.add(parent)
                parent = paths.dirname(parent)
              }
            }
            expect(leaves.toSorted()).toEqual(
              files
                .map((entry) => paths.join(root, entry.relativePath))
                .toSorted()
            )
            expect(directories.toSorted()).toEqual(
              [...expectedDirectories].toSorted()
            )
            expect(result.storage).toEqual(original.storage)
            expect(result.metadata).toEqual({
              ...original.metadata,
              defaultFile: undefined,
            })
            expect(original).toEqual(before)
          }
        )
      )
    })

    it('adopts valid configuration while preserving library and access metadata', () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[A-Za-z][A-Za-z0-9 _-]{0,30}$/),
          filePath,
          (title, defaultFile) => {
            const original = previous()
            const result = projectFromCloudSnapshot(original, [
              file(
                'project.toml',
                `title = ${JSON.stringify(title)}\ndefault_file = ${JSON.stringify(defaultFile)}`
              ),
            ])
            expect(result.metadata).toEqual({
              ...original.metadata,
              title,
              defaultFile,
            })
          }
        )
      )
    })

    it.each(['title = [', 'title = 123'])(
      'retains usable metadata and the config file when configuration is invalid: %s',
      (contents) => {
        const original = previous()
        const result = projectFromCloudSnapshot(original, [
          file('project.toml', contents),
        ])
        expect(result.metadata).toEqual(original.metadata)
        expect(result.contents.children).toEqual([
          {
            name: 'project.toml',
            path: paths.join(root, 'project.toml'),
            children: null,
          },
        ])
      }
    )
  }
)
