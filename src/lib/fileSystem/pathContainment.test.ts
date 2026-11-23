import { posix, win32 } from '@chainner/node-path'
import { getContainedRelativePath } from '@src/lib/fileSystem/pathContainment'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

describe.each([
  { name: 'POSIX', paths: posix, root: '/projects/part' },
  { name: 'Windows', paths: win32, root: 'C:\\projects\\part' },
])('$name path containment', ({ paths, root }) => {
  it('keeps nested paths and distinguishes siblings sharing the root prefix', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('part', '..hidden', 'space name', '空', 'é'), {
          minLength: 1,
          maxLength: 6,
        }),
        (segments) => {
          const relative = paths.join(...segments)
          expect(
            getContainedRelativePath(paths, root, paths.join(root, relative))
          ).toBe(relative)
          expect(
            getContainedRelativePath(
              paths,
              root,
              paths.join(`${root}-other`, relative)
            )
          ).toBeUndefined()
          expect(
            getContainedRelativePath(
              paths,
              root,
              paths.join(paths.dirname(root), 'outside', relative)
            )
          ).toBeUndefined()
        }
      )
    )
  })

  it('returns the root separately from an outside path', () => {
    expect(getContainedRelativePath(paths, root, paths.join(root, '.'))).toBe(
      ''
    )
    expect(
      getContainedRelativePath(paths, root, paths.dirname(root))
    ).toBeUndefined()
  })
})

it.each(['D:\\projects\\part\\file.kcl', '\\\\server\\share\\file.kcl'])(
  'rejects a Windows path on another drive or share: %s',
  (target) => {
    expect(
      getContainedRelativePath(win32, 'C:\\projects\\part', target)
    ).toBeUndefined()
  }
)
