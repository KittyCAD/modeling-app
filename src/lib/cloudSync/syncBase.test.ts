import { parseAcknowledgedSyncBase } from '@src/lib/cloudSync/syncBase'
import type { ProjectManifest } from '@src/lib/cloudSync/types'
import { describe, expect, it } from 'vitest'

const manifest: ProjectManifest = {
  files: {
    'main.kcl': {
      byteSize: 12,
      sha256: 'base-manifest-fingerprint',
    },
  },
}

describe('parseAcknowledgedSyncBase', () => {
  it('pairs a revision with the manifest acknowledged by it', () => {
    expect(
      parseAcknowledgedSyncBase({
        remoteRevision: 'revision-123',
        baseManifest: manifest,
      })
    ).toEqual({
      revision: 'revision-123',
      manifest,
    })
  })

  it.each([{}, { remoteRevision: 'revision-123' }, { baseManifest: manifest }])(
    'rejects an incomplete persisted pair %#',
    (metadata) => {
      expect(parseAcknowledgedSyncBase(metadata)).toBeUndefined()
    }
  )
})
