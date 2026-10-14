import path from 'node:path'
import noopfs from '@src/lib/fs-zds/noopfs'
import { createReadOnlyProjectStorage } from '@src/lib/fs-zds/readOnlyProjects'
import { describe, expect, test, vi } from 'vitest'

function setup(pathApi = path.posix, root = '/cache/views') {
  const backing = {
    ...noopfs.impl,
    ...pathApi,
    writeFile: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    cp: vi.fn(async () => undefined),
  }
  return {
    backing,
    storage: createReadOnlyProjectStorage(backing, root),
  }
}

describe('read-only project storage', () => {
  test('guards Windows paths and rejects archives targeting another drive', async () => {
    const { storage, backing } = setup(path.win32, 'C:\\cache\\views')
    await expect(
      storage.filesystem.writeFile(
        'c:\\CACHE\\views\\project\\main.kcl',
        new Uint8Array()
      )
    ).rejects.toThrow('view-only')
    await expect(
      storage.createSnapshot([
        { relativePath: 'D:\\outside.kcl', data: new Uint8Array() },
      ])
    ).rejects.toThrow('Invalid project file path')
    expect(backing.writeFile).not.toHaveBeenCalled()
    await storage.filesystem.writeFile(
      'D:\\cache\\views\\main.kcl',
      new Uint8Array()
    )
    expect(backing.writeFile).toHaveBeenCalledOnce()
  })
  test('materializes nested files but rejects writes, moves, deletes and overwriting copies', async () => {
    const { backing, storage } = setup()
    const viewPath = await storage.createSnapshot([
      {
        relativePath: 'parts/main.kcl',
        data: new TextEncoder().encode('x = 1'),
      },
    ])
    expect(backing.writeFile).toHaveBeenCalledOnce()
    const file = path.posix.join(viewPath, 'parts/main.kcl')
    const fs = storage.filesystem
    await expect(fs.writeFile(file, new Uint8Array())).rejects.toMatchObject({
      code: 'EACCES',
    })
    await expect(
      fs.mkdir(path.posix.join(viewPath, 'new'))
    ).rejects.toMatchObject({ code: 'EACCES' })
    await expect(fs.rm(viewPath)).rejects.toMatchObject({ code: 'EACCES' })
    await expect(fs.rm('/cache', { recursive: true })).rejects.toMatchObject({
      code: 'EACCES',
    })
    await expect(fs.rename(viewPath, '/projects/moved')).rejects.toMatchObject({
      code: 'EACCES',
    })
    await expect(fs.rename('/projects/a', viewPath)).rejects.toMatchObject({
      code: 'EACCES',
    })
    await expect(fs.cp('/projects/a', viewPath)).rejects.toMatchObject({
      code: 'EACCES',
    })
    expect(backing.writeFile).toHaveBeenCalledOnce()
    expect(backing.rm).not.toHaveBeenCalled()
    await fs.cp(viewPath, '/projects/explicit-copy')
    expect(backing.cp).toHaveBeenCalledOnce()
    await storage.disposeSnapshot(viewPath)
    expect(backing.rm).toHaveBeenCalledWith(viewPath, {
      recursive: true,
      force: true,
    })
  })

  test('normalizes paths and does not confuse neighboring directories with the cache', async () => {
    const { storage, backing } = setup()
    await expect(
      storage.filesystem.writeFile(
        '/cache/views/a/../main.kcl',
        new Uint8Array()
      )
    ).rejects.toThrow('view-only')
    await storage.filesystem.writeFile(
      '/cache/views-copy/main.kcl',
      new Uint8Array()
    )
    expect(backing.writeFile).toHaveBeenCalledOnce()
  })

  test.each(['../escape.kcl', '/outside.kcl', 'parts/../../outside.kcl'])(
    'rejects archive escape %s before writing anything',
    async (relativePath) => {
      const { backing, storage } = setup()
      await expect(
        storage.createSnapshot([
          { relativePath: 'main.kcl', data: new Uint8Array() },
          { relativePath, data: new Uint8Array() },
        ])
      ).rejects.toThrow('Invalid project file path')
      expect(backing.writeFile).not.toHaveBeenCalled()
    }
  )
})
