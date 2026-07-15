import {
  createDuplicatePublicationEvidence,
  getDuplicateReservationFileName,
  parseDuplicateOwnershipEvidence,
} from '@src/lib/fs-zds/duplicateReservations'
import { describe, expect, it } from 'vitest'

describe('duplicate ownership evidence', () => {
  it('uses the same reservation for canonically equivalent names', () => {
    expect(getDuplicateReservationFileName('Caf\u00e9')).toBe(
      getDuplicateReservationFileName('Cafe\u0301')
    )
  })

  it('rejects malformed, unsafe, and non-UUID ownership claims', () => {
    expect(parseDuplicateOwnershipEvidence('{')).toBeUndefined()
    expect(
      parseDuplicateOwnershipEvidence(
        JSON.stringify({
          version: 1,
          kind: 'reservation',
          phase: 'prepared',
          token: 'not-a-token',
          createdAt: 1,
          targetName: '../outside',
        })
      )
    ).toBeUndefined()
  })

  it('creates immutable prepared and publishing publication records', () => {
    const evidence = createDuplicatePublicationEvidence({
      token: '11111111-1111-4111-8111-111111111111',
      targetName: 'Copy',
      createdAt: 1,
    })
    expect(
      parseDuplicateOwnershipEvidence(evidence.reservationPrepared)
    ).toMatchObject({
      kind: 'reservation',
      phase: 'prepared',
      targetName: 'Copy',
    })
    expect(
      parseDuplicateOwnershipEvidence(evidence.targetPublishing)
    ).toMatchObject({ kind: 'target', phase: 'publishing' })
  })
})
