import {
  DUPLICATE_IN_PROGRESS_FILE_NAME,
  DUPLICATE_RESERVATION_FILE_PREFIX,
  MAX_PROJECT_NAME_LENGTH,
} from '@src/lib/constants'
import { isArray } from '@src/lib/utils'

export const DUPLICATE_OWNERSHIP_VERSION = 1 as const
export const DUPLICATE_ARTIFACT_STALE_MS = 24 * 60 * 60 * 1000

const DUPLICATE_TOKEN_REGEXP =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type DuplicateOwnershipBase = {
  version: typeof DUPLICATE_OWNERSHIP_VERSION
  token: string
  createdAt: number
}

export type DuplicateStageEvidence = DuplicateOwnershipBase & {
  kind: 'stage'
  phase: 'copying' | 'reserved'
  targetName?: string
}

export type DuplicateTargetEvidence = DuplicateOwnershipBase & {
  kind: 'target'
  phase: 'publishing' | 'published'
}

export type DuplicateReservationEvidence = DuplicateOwnershipBase & {
  kind: 'reservation'
  phase: 'prepared' | 'reserved' | 'published'
  targetName: string
}

export type DuplicateOwnershipEvidence =
  | DuplicateStageEvidence
  | DuplicateTargetEvidence
  | DuplicateReservationEvidence

export type DuplicatePublicationEvidence = {
  markerName: typeof DUPLICATE_IN_PROGRESS_FILE_NAME
  reservationFileName: string
  targetPublishing: Uint8Array<ArrayBuffer>
  targetPublished: Uint8Array<ArrayBuffer>
  reservationPrepared: Uint8Array<ArrayBuffer>
  reservationReserved: Uint8Array<ArrayBuffer>
  reservationPublished: Uint8Array<ArrayBuffer>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !isArray(value)
}

function hasValidBase(
  value: Record<string, unknown>
): value is Record<string, unknown> & DuplicateOwnershipBase {
  return (
    value.version === DUPLICATE_OWNERSHIP_VERSION &&
    typeof value.token === 'string' &&
    DUPLICATE_TOKEN_REGEXP.test(value.token) &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt) &&
    value.createdAt >= 0
  )
}

function isSafeTargetName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_PROJECT_NAME_LENGTH &&
    value !== '.' &&
    value !== '..' &&
    !/[\\/\u0000-\u001f]/.test(value)
  )
}

export function parseDuplicateOwnershipEvidence(
  contents: string | Uint8Array
): DuplicateOwnershipEvidence | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(
      typeof contents === 'string'
        ? contents
        : new TextDecoder().decode(contents)
    )
  } catch {
    return undefined
  }
  if (!isObject(parsed) || !hasValidBase(parsed)) {
    return undefined
  }

  if (
    parsed.kind === 'stage' &&
    (parsed.phase === 'copying' || parsed.phase === 'reserved') &&
    (parsed.targetName === undefined || isSafeTargetName(parsed.targetName))
  ) {
    return parsed as DuplicateStageEvidence
  }
  if (
    parsed.kind === 'target' &&
    (parsed.phase === 'publishing' || parsed.phase === 'published')
  ) {
    return parsed as DuplicateTargetEvidence
  }
  if (
    parsed.kind === 'reservation' &&
    (parsed.phase === 'prepared' ||
      parsed.phase === 'reserved' ||
      parsed.phase === 'published') &&
    isSafeTargetName(parsed.targetName)
  ) {
    return parsed as DuplicateReservationEvidence
  }
  return undefined
}

export function serializeDuplicateOwnershipEvidence(
  evidence: DuplicateOwnershipEvidence
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(evidence))
}

function stablePathHash(value: string) {
  let first = 0xdeadbeef ^ value.length
  let second = 0x41c6ce57 ^ value.length
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 2654435761)
    second = Math.imul(second ^ code, 1597334677)
  }
  first =
    Math.imul(first ^ (first >>> 16), 2246822507) ^
    Math.imul(second ^ (second >>> 13), 3266489909)
  second =
    Math.imul(second ^ (second >>> 16), 2246822507) ^
    Math.imul(first ^ (first >>> 13), 3266489909)
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0)
    .toString(16)
    .padStart(8, '0')}`
}

export function getDuplicateReservationFileName(targetName: string) {
  return `${DUPLICATE_RESERVATION_FILE_PREFIX}${stablePathHash(
    targetName.normalize('NFC').toLowerCase().normalize('NFC')
  )}`
}

export function createDuplicatePublicationEvidence({
  token,
  targetName,
  createdAt = Date.now(),
}: {
  token: string
  targetName: string
  createdAt?: number
}): DuplicatePublicationEvidence {
  const base = {
    version: DUPLICATE_OWNERSHIP_VERSION,
    token,
    createdAt,
  } as const
  return {
    markerName: DUPLICATE_IN_PROGRESS_FILE_NAME,
    reservationFileName: getDuplicateReservationFileName(targetName),
    targetPublishing: serializeDuplicateOwnershipEvidence({
      ...base,
      kind: 'target',
      phase: 'publishing',
    }),
    targetPublished: serializeDuplicateOwnershipEvidence({
      ...base,
      kind: 'target',
      phase: 'published',
    }),
    reservationPrepared: serializeDuplicateOwnershipEvidence({
      ...base,
      kind: 'reservation',
      phase: 'prepared',
      targetName,
    }),
    reservationReserved: serializeDuplicateOwnershipEvidence({
      ...base,
      kind: 'reservation',
      phase: 'reserved',
      targetName,
    }),
    reservationPublished: serializeDuplicateOwnershipEvidence({
      ...base,
      kind: 'reservation',
      phase: 'published',
      targetName,
    }),
  }
}

export function duplicateEvidenceMatches(
  evidence: DuplicateOwnershipEvidence | undefined,
  expected: Pick<DuplicateOwnershipEvidence, 'kind' | 'token'> & {
    phase?: DuplicateOwnershipEvidence['phase']
  }
) {
  return Boolean(
    evidence &&
      evidence.kind === expected.kind &&
      evidence.token === expected.token &&
      (expected.phase === undefined || evidence.phase === expected.phase)
  )
}
