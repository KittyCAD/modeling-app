import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createDuplicatePublicationEvidence } from '@src/lib/fs-zds/duplicateReservations'
import { publishDirectory } from '@src/lib/fs-zds/nodefs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('node publishDirectory', () => {
  let rootPath: string

  beforeEach(async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'zds-node-publish-'))
  })

  afterEach(async () => {
    await fs.rm(rootPath, { recursive: true, force: true })
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
    ).resolves.toContain('"phase":"publishing"')
    await expect(
      fs.readFile(path.join(rootPath, evidence.reservationFileName), 'utf-8')
    ).resolves.toContain('"phase":"prepared"')
  })
})
