import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('browser filesystem path resolution', { tag: ['@web'] }, () => {
  test('keeps top-level and overlapping directory names distinct', async ({
    fs,
    page,
  }) => {
    const root = '/opfs-path-lookup'
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(`${root}/root.kcl`, new TextEncoder().encode('root'))
    await expect(fs.readFile(`${root}/root.kcl`, 'utf8')).resolves.toBe('root')

    for (const name of ['part', 'parts']) {
      await fs.mkdir(`${root}/${name}/nested`, { recursive: true })
      await fs.writeFile(
        `${root}/${name}/nested/main.kcl`,
        new TextEncoder().encode(name)
      )
    }
    for (const name of ['part', 'parts']) {
      await expect(
        fs.readFile(`${root}/${name}/nested/main.kcl`, 'utf8')
      ).resolves.toBe(name)
    }
    await expect(fs.readdir(root)).resolves.toEqual(
      expect.arrayContaining(['root.kcl', 'part', 'parts'])
    )
    await expect(
      fs.readFile(`${root}/missing/main.kcl`, 'utf8')
    ).rejects.toThrow('ENOENT')

    // Check the stored paths independently of the app's resolver.
    const contents = await page.evaluate(async () => {
      const storage = await navigator.storage.getDirectory()
      const directory = await storage.getDirectoryHandle('opfs-path-lookup')
      const file = await directory.getFileHandle('root.kcl')
      return (await file.getFile()).text()
    })
    expect(contents).toBe('root')
  })

  test('writes to the requested directory through the worker fallback', async ({
    page,
  }) => {
    const contents = await page.evaluate(async () => {
      const prototype = FileSystemFileHandle.prototype
      const writableDescriptor = Object.getOwnPropertyDescriptor(
        prototype,
        'createWritable'
      )
      Object.defineProperty(prototype, 'createWritable', {
        configurable: true,
        value: undefined,
      })
      try {
        await window.fsZds.mkdir('/opfs-worker-lookup', { recursive: true })
        await window.fsZds.writeFile(
          '/opfs-worker-lookup/worker.kcl',
          new TextEncoder().encode('worker contents')
        )
        const root = await navigator.storage.getDirectory()
        const directory = await root.getDirectoryHandle('opfs-worker-lookup')
        const file = await directory.getFileHandle('worker.kcl')
        return (await file.getFile()).text()
      } finally {
        if (writableDescriptor) {
          Object.defineProperty(prototype, 'createWritable', writableDescriptor)
        } else {
          Reflect.deleteProperty(prototype, 'createWritable')
        }
      }
    })
    expect(contents).toBe('worker contents')
  })
})
