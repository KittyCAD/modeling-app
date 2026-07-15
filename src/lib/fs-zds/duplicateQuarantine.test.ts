import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DUPLICATE_IN_PROGRESS_FILE_NAME } from '@src/lib/constants'
import { isProjectDirectoryQuarantined } from '@src/lib/fs-zds/duplicateQuarantine'
import {
  createDuplicatePublicationEvidence,
  serializeDuplicateOwnershipEvidence,
} from '@src/lib/fs-zds/duplicateReservations'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
}))

vi.mock('@src/lib/fs-zds', () => ({
  default: {
    basename: path.posix.basename,
    dirname: path.posix.dirname,
    join: path.posix.join,
    readFile: mocks.readFile,
    readdir: mocks.readdir,
  },
}))

const token = '1b2d28e0-190b-4e20-b364-c5206cf82995'
const projectPath = '/projects/Bracket copy'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.readFile.mockRejectedValue({ code: 'ENOENT' })
  mocks.readdir.mockRejectedValue({ code: 'ENOENT' })
})

describe('isProjectDirectoryQuarantined', () => {
  it('quarantines a reserved staging name before its marker exists', async () => {
    await expect(
      isProjectDirectoryQuarantined(`/projects/.zds-duplicate-${token}`)
    ).resolves.toBe(true)
    expect(mocks.readFile).not.toHaveBeenCalled()
    expect(mocks.readdir).not.toHaveBeenCalled()
  })

  it('quarantines the reservation-to-mkdir window', async () => {
    const evidence = createDuplicatePublicationEvidence({
      token,
      targetName: 'Bracket copy',
    })
    mocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith(evidence.reservationFileName)) {
        return evidence.reservationPrepared
      }
      return Promise.reject({ code: 'ENOENT' })
    })

    await expect(isProjectDirectoryQuarantined(projectPath)).resolves.toBe(true)
    expect(mocks.readdir).not.toHaveBeenCalled()
  })

  it('quarantines a directly addressed staging directory', async () => {
    mocks.readdir.mockResolvedValue([DUPLICATE_IN_PROGRESS_FILE_NAME])
    mocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith(DUPLICATE_IN_PROGRESS_FILE_NAME)) {
        return serializeDuplicateOwnershipEvidence({
          version: 1,
          kind: 'stage',
          phase: 'copying',
          token,
          createdAt: 1,
        })
      }
      return Promise.reject({ code: 'ENOENT' })
    })

    await expect(isProjectDirectoryQuarantined(projectPath)).resolves.toBe(true)
  })

  it('does not treat an invalid user marker as ownership evidence', async () => {
    mocks.readdir.mockResolvedValue([DUPLICATE_IN_PROGRESS_FILE_NAME])
    mocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith(DUPLICATE_IN_PROGRESS_FILE_NAME)) {
        return new TextEncoder().encode('user content')
      }
      return Promise.reject({ code: 'ENOENT' })
    })

    await expect(isProjectDirectoryQuarantined(projectPath)).resolves.toBe(
      false
    )
  })

  it('rechecks the reservation after a target existence transition', async () => {
    const evidence = createDuplicatePublicationEvidence({
      token,
      targetName: 'Bracket copy',
    })
    let reservationReadCount = 0
    mocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith(evidence.reservationFileName)) {
        reservationReadCount += 1
        if (reservationReadCount === 2) {
          return evidence.reservationPrepared
        }
      }
      return Promise.reject({ code: 'ENOENT' })
    })

    await expect(isProjectDirectoryQuarantined(projectPath)).resolves.toBe(true)
    expect(reservationReadCount).toBe(2)
  })
})
