import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { cp } from '@src/lib/fs-zds/nodefs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('node filesystem', () => {
  let rootPath: string
  const itOnPosix = process.platform === 'win32' ? it.skip : it

  beforeEach(async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'zds-node-copy-'))
  })

  afterEach(async () => {
    await fs.rm(rootPath, { recursive: true, force: true })
  })

  itOnPosix(
    'makes copied entries writable without following symlinks',
    async () => {
      const sourcePath = path.join(rootPath, 'source')
      const nestedPath = path.join(sourcePath, 'nested')
      const sourceFilePath = path.join(nestedPath, 'main.kcl')
      const externalPath = path.join(rootPath, 'external.kcl')
      const targetPath = path.join(rootPath, 'target')
      await fs.mkdir(nestedPath, { recursive: true })
      await fs.writeFile(sourceFilePath, 'cube = 1')
      await fs.writeFile(externalPath, 'external')
      const symlinkTarget = path.relative(nestedPath, externalPath)
      await fs.symlink(symlinkTarget, path.join(nestedPath, 'external-link'))
      await fs.chmod(sourceFilePath, 0o400)
      await fs.chmod(nestedPath, 0o500)
      await fs.chmod(sourcePath, 0o500)
      await fs.chmod(externalPath, 0o400)

      try {
        await cp(sourcePath, targetPath, {
          recursive: true,
          verbatimSymlinks: true,
          makeWritable: true,
        })

        expect((await fs.stat(targetPath)).mode & 0o700).toBe(0o700)
        expect(
          (await fs.stat(path.join(targetPath, 'nested'))).mode & 0o700
        ).toBe(0o700)
        expect(
          (await fs.stat(path.join(targetPath, 'nested', 'main.kcl'))).mode &
            0o600
        ).toBe(0o600)
        expect(
          (
            await fs.lstat(path.join(targetPath, 'nested', 'external-link'))
          ).isSymbolicLink()
        ).toBe(true)
        await expect(
          fs.readlink(path.join(targetPath, 'nested', 'external-link'))
        ).resolves.toBe(symlinkTarget)
        expect((await fs.stat(externalPath)).mode & 0o777).toBe(0o400)
      } finally {
        await fs.chmod(sourcePath, 0o700)
        await fs.chmod(nestedPath, 0o700)
      }
    }
  )

  itOnPosix('rejects a writable copy rooted at a symlink', async () => {
    const sourcePath = path.join(rootPath, 'source')
    const sourceLinkPath = path.join(rootPath, 'source-link')
    const targetPath = path.join(rootPath, 'target')
    const projectTomlPath = path.join(sourcePath, 'project.toml')
    await fs.mkdir(sourcePath)
    await fs.writeFile(projectTomlPath, 'title = "Original"')
    await fs.symlink(path.basename(sourcePath), sourceLinkPath)

    await expect(
      cp(sourceLinkPath, targetPath, {
        recursive: true,
        verbatimSymlinks: true,
        makeWritable: true,
      })
    ).rejects.toThrow('root is a symbolic link')
    await expect(fs.readFile(projectTomlPath, 'utf-8')).resolves.toBe(
      'title = "Original"'
    )
    await expect(fs.lstat(targetPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
