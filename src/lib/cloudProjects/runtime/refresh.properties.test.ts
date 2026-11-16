import { createHash } from 'node:crypto'
import fc from 'fast-check'
import { assert, describe, expect, it } from 'vitest'
import { planCloudRefresh } from '@src/lib/cloudProjects/runtime/refresh'
import { parseProjectArchive } from '@src/lib/cloudProjects/runtime/archive'
import type {
  ProjectArchiveFile,
  RemoteProjectFile,
} from '@src/lib/cloudProjects/runtime/types'
import JSZip from 'jszip'

function metadata(
  file: ProjectArchiveFile,
  version = 'new'
): RemoteProjectFile {
  return {
    id: `${version}-${file.relativePath}`,
    relative_path: file.relativePath,
    byte_size: file.data.byteLength,
    sha256: createHash('sha256').update(file.data).digest('hex'),
  }
}
const file = (relativePath: string, bytes = [1, 2]): ProjectArchiveFile => ({
  relativePath,
  data: new Uint8Array(bytes),
})
const project = (revision: string, files: readonly ProjectArchiveFile[]) => ({
  id: 'one',
  revision,
  files: files.map((file) => metadata(file, revision)),
})
const bytesEqual = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, index) => byte === b[index])

const paths = fc
  .array(fc.constantFrom('a', 'b', 'é', '空', '😀', ' '), {
    minLength: 1,
    maxLength: 10,
  })
  .map((characters) => `nested/${characters.join('')}.bin`)
const trees = fc.uniqueArray(
  fc.record({
    path: paths,
    before: fc.option(fc.uint8Array({ maxLength: 128 }), { nil: undefined }),
    after: fc.option(fc.uint8Array({ maxLength: 128 }), { nil: undefined }),
  }),
  { selector: (entry) => entry.path, maxLength: 25 }
)

describe('cloud refresh planning invariants', () => {
  it('reconstructs generated new versions while downloading exactly their changed and added files', () => {
    fc.assert(
      fc.property(trees, (entries) => {
        const before = entries.flatMap(({ path, before }) =>
          before ? [{ relativePath: path, data: before }] : []
        )
        const after = entries.flatMap(({ path, after }) =>
          after ? [{ relativePath: path, data: after }] : []
        )
        const plan = planCloudRefresh(
          project('old', before),
          project('new', after),
          before
        )
        assert(!(plan instanceof Error))
        const expected = entries
          .filter(
            ({ before, after }) =>
              after && (!before || !bytesEqual(before, after))
          )
          .map(({ path }) => path)
          .sort()
        expect(plan.selected.map((file) => file.relative_path).sort()).toEqual(
          expected
        )
        const downloaded = after
          .filter((file) => expected.includes(file.relativePath))
          .reverse()
        const merged = plan.merge(downloaded)
        assert(!(merged instanceof Error))
        expect(
          new Map(merged.map((file) => [file.relativePath, file.data]))
        ).toEqual(new Map(after.map((file) => [file.relativePath, file.data])))
      }),
      { numRuns: 200 }
    )
  })

  it('reuses unchanged bytes when version-specific file IDs change', () => {
    const files = [file('nested/a.bin')]
    const plan = planCloudRefresh(
      project('old', files),
      project('new', files),
      files
    )
    assert(!(plan instanceof Error))
    expect(plan.selected).toEqual([])
    expect(plan.merge([])).toEqual(files)
  })

  it('fetches bytes again when the cross-version hash is unknown', () => {
    const files = [file('nested/a.bin')]
    const next = project('new', files)
    next.files[0].sha256 = undefined
    const plan = planCloudRefresh(project('old', files), next, files)
    assert(!(plan instanceof Error))
    expect(plan.selected).toEqual(next.files)
  })

  it('reuses an immutable file in the same version even without a hash', () => {
    const files = [file('nested/a.bin')]
    const same = project('old', files)
    same.files[0].sha256 = undefined
    const plan = planCloudRefresh(same, same, files)
    assert(!(plan instanceof Error))
    expect(plan.selected).toEqual([])
  })

  it.each(['missing', 'extra', 'duplicate', 'wrong-size'] as const)(
    'rejects an incomplete or mismatched archive: %s',
    (failure) => {
      const next = [file('new.bin')]
      const plan = planCloudRefresh(
        project('old', []),
        project('new', next),
        []
      )
      assert(!(plan instanceof Error))
      const downloaded =
        failure === 'missing'
          ? []
          : failure === 'extra'
            ? [file('unexpected.bin')]
            : failure === 'duplicate'
              ? [...next, ...next]
              : [file('new.bin', [0])]
      expect(plan.merge(downloaded)).toBeInstanceOf(Error)
    }
  )

  it.each([
    '../escape.kcl',
    '/absolute.kcl',
    'C:/absolute.kcl',
    'nested/../escape.kcl',
    'nested//file.kcl',
    'nested\\file.kcl',
  ])('rejects unsafe or noncanonical metadata path %s', (path) => {
    expect(
      planCloudRefresh(project('old', []), project('new', [file(path)]), [])
    ).toBeInstanceOf(Error)
  })

  it('rejects missing metadata and duplicate paths or file IDs before selecting downloads', () => {
    expect(planCloudRefresh({ id: 'one' }, project('new', []), [])).toEqual(
      new Error('Cloud refresh requires project file metadata.')
    )
    const next = project('new', [file('a'), file('b')])
    next.files[1].id = next.files[0].id
    expect(planCloudRefresh(project('old', []), next, [])).toBeInstanceOf(Error)
  })
})

it('preserves generated paths and bytes in rootless version archives, including a single nested file', async () => {
  await fc.assert(
    fc.asyncProperty(
      paths,
      fc.uint8Array({ maxLength: 1024 }),
      async (path, data) => {
        const zip = new JSZip()
        zip.file(path, data)
        expect(
          await parseProjectArchive(
            await zip.generateAsync({ type: 'arraybuffer' })
          )
        ).toEqual([{ relativePath: path, data }])
      }
    ),
    { numRuns: 100 }
  )
})
