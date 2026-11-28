import type { ProjectDirectory } from '@src/lib/projectSession/next/types'
import { applyProjectFileMutation } from '@src/lib/projectSession/next/fileTree'
import { requireSuccess } from '@src/lib/editors/testViews'
import type { FileEntry } from '@src/lib/project'
import fc from 'fast-check'
import { expect, it, vi } from 'vitest'
import { posix, win32 } from 'node:path'

const platform = vi.hoisted((): { value: 'posix' | 'win32' } => ({
  value: 'posix',
}))
vi.mock('@src/lib/fs-zds', async () => {
  const paths = await import('node:path')
  return {
    default: {
      relative: (from: string, to: string) =>
        paths[platform.value].relative(from, to),
      join: (...parts: string[]) => paths[platform.value].join(...parts),
      resolve: (...parts: string[]) => paths[platform.value].resolve(...parts),
      dirname: (path: string) => paths[platform.value].dirname(path),
      basename: (path: string) => paths[platform.value].basename(path),
      get sep() {
        return paths[platform.value].sep
      },
    },
  }
})
function files(root: FileEntry): string[] {
  return root.children === null ? [root.path] : root.children.flatMap(files)
}

const platforms: readonly ('posix' | 'win32')[] = ['posix', 'win32']
it.each(platforms)(
  'records nested creations and moves without duplicates or mutating the old %s tree',
  (name) => {
    platform.value = name
    const paths = name === 'posix' ? posix : win32
    const root = name === 'posix' ? '/project' : 'C:\\project'
    fc.assert(
      fc.property(
        fc.array(
          fc.array(fc.constantFrom('parts', 'nested'), { maxLength: 4 }),
          { maxLength: 20 }
        ),
        (parents) => {
          const initial: ProjectDirectory = {
            name: 'project',
            path: root,
            children: [],
          }
          let tree = initial
          const created = parents.map((parts, index) =>
            paths.join(root, ...parts, `file-${index}.md`)
          )
          for (const path of created) {
            tree = requireSuccess(
              applyProjectFileMutation(tree, { type: 'created', path })
            )
            tree = requireSuccess(
              applyProjectFileMutation(tree, { type: 'created', path })
            )
          }
          expect(files(tree).sort()).toEqual([...created].sort())
          const moved = created.map((source, index) => {
            const destination = paths.join(
              root,
              'moved',
              'deep',
              `file-${index}.md`
            )
            tree = requireSuccess(
              applyProjectFileMutation(tree, {
                type: 'renamed',
                source,
                destination,
              })
            )
            return destination
          })
          expect(files(tree).sort()).toEqual(moved.sort())
          expect(initial.children).toEqual([])
        }
      ),
      { numRuns: 50 }
    )
  }
)

it('preserves file and directory metadata and unrelated entry identities during a rename', () => {
  platform.value = 'posix'
  const metadata = {
    modified: 1,
    accessed: 2,
    created: 3,
    size: 4,
    type: null,
    permission: null,
  }
  const source = {
    name: 'old.md',
    path: '/project/parts/old.md',
    metadata,
    children: null,
  }
  const sibling = { name: 'keep.md', path: '/project/keep.md', children: null }
  const root: ProjectDirectory = {
    name: 'project',
    path: '/project',
    metadata,
    children: [
      { name: 'parts', path: '/project/parts', metadata, children: [source] },
      sibling,
    ],
  }
  const tree = requireSuccess(
    applyProjectFileMutation(root, {
      type: 'renamed',
      source: source.path,
      destination: '/project/parts/new.md',
    })
  )
  expect(tree.metadata).toBe(metadata)
  expect(tree.children[0].metadata).toBe(metadata)
  expect(tree.children[0].children?.[0].metadata).toBe(metadata)
  expect(tree.children[1]).toBe(sibling)
  expect(files(root)).toEqual(['/project/parts/old.md', '/project/keep.md'])
  expect(files(tree)).toEqual(['/project/parts/new.md', '/project/keep.md'])
})

it('records the requested Windows file spelling while retaining its parent directory spelling', () => {
  platform.value = 'win32'
  const root: ProjectDirectory = {
    name: 'project',
    path: 'C:\\project',
    children: [
      {
        name: 'Parts',
        path: 'C:\\project\\Parts',
        children: [
          {
            name: 'old.md',
            path: 'C:\\project\\Parts\\old.md',
            children: null,
          },
        ],
      },
    ],
  }
  const tree = requireSuccess(
    applyProjectFileMutation(root, {
      type: 'renamed',
      source: 'C:\\PROJECT\\PARTS\\old.md',
      destination: 'C:\\project\\parts\\New.md',
    })
  )
  expect(tree.children[0].name).toBe('Parts')
  expect(tree.children[0].children?.[0].name).toBe('New.md')
  expect(files(tree)).toHaveLength(1)
})

it.each(['created', 'renamed'] as const)(
  'preserves case-distinct Windows cloud files when a file is %s',
  (type) => {
    platform.value = 'win32'
    const root = 'C:/cloud/one'
    const original = win32.join(root, 'main.kcl')
    const sibling = win32.join(root, 'Main.kcl')
    const tree: ProjectDirectory = {
      name: 'one',
      path: win32.normalize(root),
      children: [
        { name: 'main.kcl', path: original, children: null },
        ...(type === 'renamed'
          ? [{ name: 'Main.kcl', path: sibling, children: null }]
          : []),
      ],
    }
    const updated = requireSuccess(
      applyProjectFileMutation(
        tree,
        type === 'created'
          ? { type, path: sibling }
          : {
              type,
              source: original,
              destination: win32.join(root, 'moved.kcl'),
            },
        true
      )
    )
    expect(files(updated).sort()).toEqual(
      (type === 'created'
        ? [original, sibling]
        : [sibling, win32.join(root, 'moved.kcl')]
      ).sort()
    )
  }
)
