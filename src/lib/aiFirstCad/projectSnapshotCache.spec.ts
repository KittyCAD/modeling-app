import {
  loadProjectSnapshotCache,
  revokeProjectSnapshotCache,
  writeProjectSnapshotCache,
} from '@src/lib/aiFirstCad/projectSnapshotCache'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mkdir: vi.fn(
    async (_path: string, _options?: { recursive: boolean }) => undefined
  ),
  readFile: vi.fn(async (_path: string) => new Uint8Array([1, 2, 3])),
  stat: vi.fn(async (_path: string) => ({ mtimeMs: 0, size: 0 })),
  writeFile: vi.fn(async (_path: string, _data: Uint8Array) => undefined),
}))

vi.mock('@src/lib/fs-zds', () => ({
  default: {
    basename: (value: string) => value.split('/').at(-1) ?? '',
    dirname: (value: string) => value.slice(0, value.lastIndexOf('/')),
    getPath: async () => '/user-data',
    join: (...values: string[]) => values.join('/').replaceAll('//', '/'),
    mkdir: mocks.mkdir,
    readFile: mocks.readFile,
    relative: (from: string, to: string) => to.slice(from.length + 1),
    stat: mocks.stat,
    writeFile: mocks.writeFile,
  },
}))

const file = {
  label: 'parts/bracket.kcl',
  path: '/projects/demo/parts/bracket.kcl',
}

describe('projectSnapshotCache', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cached-bracket')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  it('loads only a per-file PNG that is at least as new as its KCL source', async () => {
    mocks.stat
      .mockResolvedValueOnce({ mtimeMs: 100, size: 20 })
      .mockResolvedValueOnce({ mtimeMs: 101, size: 3 })

    const cachedImages = await loadProjectSnapshotCache('/projects/demo', [
      file,
    ])

    expect(cachedImages.get(file.path)).toBe('blob:cached-bracket')
    expect(mocks.readFile).toHaveBeenCalledOnce()

    revokeProjectSnapshotCache(cachedImages)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cached-bracket')
  })

  it('ignores stale per-file PNGs', async () => {
    mocks.stat
      .mockResolvedValueOnce({ mtimeMs: 200, size: 20 })
      .mockResolvedValueOnce({ mtimeMs: 199, size: 3 })

    const cachedImages = await loadProjectSnapshotCache('/projects/demo', [
      file,
    ])

    expect(cachedImages.size).toBe(0)
    expect(mocks.readFile).not.toHaveBeenCalled()
  })

  it('stores decoded PNG bytes in app data instead of the project', async () => {
    await expect(
      writeProjectSnapshotCache(
        '/projects/demo',
        file.path,
        'data:image/png;base64,AQID'
      )
    ).resolves.toBe(true)

    const cachePath = mocks.writeFile.mock.calls[0]?.[0]
    expect(cachePath).toMatch(
      /^\/user-data\/ai-first-cad-snapshots-v1\/[a-f0-9]{8}\/[a-f0-9]{8}-bracket\.kcl\.png$/
    )
    expect(cachePath).not.toContain('/projects/demo')
    expect(mocks.mkdir).toHaveBeenCalledWith(
      cachePath?.slice(0, cachePath.lastIndexOf('/')),
      { recursive: true }
    )
    expect(mocks.writeFile.mock.calls[0]?.[1]).toEqual(
      new Uint8Array([1, 2, 3])
    )
  })
})
