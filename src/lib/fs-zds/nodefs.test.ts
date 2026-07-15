import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createDuplicatePublicationEvidence } from '@src/lib/fs-zds/duplicateReservations'
import { cp, publishDirectory } from '@src/lib/fs-zds/nodefs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('node filesystem', () => {
  let rootPath: string

  beforeEach(async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'zds-node-publish-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(rootPath, { recursive: true, force: true })
  })

  it('makes copied entries writable without following symlinks', async () => {
    const sourcePath = path.join(rootPath, 'source')
    const nestedPath = path.join(sourcePath, 'nested')
    const sourceFilePath = path.join(nestedPath, 'main.kcl')
    const externalPath = path.join(rootPath, 'external.kcl')
    const targetPath = path.join(rootPath, 'target')
    await fs.mkdir(nestedPath, { recursive: true })
    await fs.writeFile(sourceFilePath, 'cube = 1')
    await fs.writeFile(externalPath, 'external')
    await fs.symlink(externalPath, path.join(nestedPath, 'external-link'))
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
      expect((await fs.stat(externalPath)).mode & 0o777).toBe(0o400)
    } finally {
      await fs.chmod(sourcePath, 0o700)
      await fs.chmod(nestedPath, 0o700)
    }
  })

  it('publishes with durable ownership evidence without merging', async () => {
    const sourcePath = path.join(rootPath, 'stage')
    const targetPath = path.join(rootPath, 'target')
    await fs.mkdir(sourcePath)
    await fs.writeFile(path.join(sourcePath, 'main.kcl'), 'cube = 1')
    const evidence = createDuplicatePublicationEvidence({
      token: '11111111-1111-4111-8111-111111111111',
      targetName: 'target',
      createdAt: 1,
    })

    await publishDirectory(sourcePath, targetPath, evidence)

    await expect(
      fs.readFile(path.join(targetPath, 'main.kcl'), 'utf-8')
    ).resolves.toBe('cube = 1')
    await expect(
      fs.readFile(path.join(targetPath, evidence.markerName), 'utf-8')
    ).resolves.toContain('"phase":"published"')
    await expect(
      fs.readFile(path.join(rootPath, evidence.reservationFileName), 'utf-8')
    ).resolves.toContain('"phase":"published"')
  })

  it('removes an owned reservation after its initial evidence write fails', async () => {
    const sourcePath = path.join(rootPath, 'stage')
    const targetPath = path.join(rootPath, 'target')
    await fs.mkdir(sourcePath)
    const evidence = createDuplicatePublicationEvidence({
      token: '22222222-2222-4222-8222-222222222222',
      targetName: 'target',
      createdAt: 1,
    })
    const originalOpen = fs.open.bind(fs)
    vi.spyOn(fs, 'open').mockImplementationOnce(
      async (filePath, flags, mode) => {
        const handle = await originalOpen(filePath, flags, mode)
        vi.spyOn(handle, 'write').mockRejectedValueOnce(
          new Error('simulated evidence write failure')
        )
        return handle
      }
    )

    await expect(
      publishDirectory(sourcePath, targetPath, evidence)
    ).rejects.toThrow('simulated evidence write failure')
    await expect(
      fs.lstat(path.join(rootPath, evidence.reservationFileName))
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.lstat(targetPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves a replacement reservation after an initial write failure', async () => {
    const sourcePath = path.join(rootPath, 'stage')
    const targetPath = path.join(rootPath, 'target')
    await fs.mkdir(sourcePath)
    const evidence = createDuplicatePublicationEvidence({
      token: '33333333-3333-4333-8333-333333333333',
      targetName: 'target',
      createdAt: 1,
    })
    const reservationPath = path.join(rootPath, evidence.reservationFileName)
    const originalOpen = fs.open.bind(fs)
    vi.spyOn(fs, 'open').mockImplementationOnce(
      async (filePath, flags, mode) => {
        const handle = await originalOpen(filePath, flags, mode)
        vi.spyOn(handle, 'write').mockImplementationOnce(async () => {
          await fs.rm(reservationPath, { force: true })
          await fs.writeFile(reservationPath, 'replacement')
          throw new Error('simulated evidence write failure')
        })
        return handle
      }
    )

    await expect(
      publishDirectory(sourcePath, targetPath, evidence)
    ).rejects.toThrow('simulated evidence write failure')
    await expect(fs.readFile(reservationPath, 'utf-8')).resolves.toBe(
      'replacement'
    )
  })
})
