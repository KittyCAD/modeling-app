import type { components } from '@src/lib/kclMigration/api.generated'
import { isArray, isRecord } from '@src/lib/utils'

export type MigrationRequest = components['schemas']['KclMigrationRequest']
export type MigrationOperation = components['schemas']['KclMigrationOperation']
export type MigrationResult = components['schemas']['KclMigrationResult']
export type MigrationClientMessage =
  components['schemas']['KclMigrationClientMessage']
export type MigrationServerMessage =
  components['schemas']['KclMigrationServerMessage']

export const MIGRATION_FEATURE = 'zookeeper_kcl_migration'
export const MIGRATION_TARGET = '3.0-preview'
export const MAX_FILES = 256
export const MAX_BYTES = 8 * 1024 * 1024

const statuses = new Set<string>([
  'running',
  'succeeded',
  'failed',
  'timed_out',
  'cancelled',
  'unsupported',
  'validation_failed',
])

function isFiles(value: unknown): value is Record<string, number[]> {
  if (!isRecord(value) || Object.keys(value).length > MAX_FILES) return false
  let bytes = 0
  return Object.values(value).every((file) => {
    if (!isArray(file)) return false
    bytes += file.length
    return (
      bytes <= MAX_BYTES &&
      file.every(
        (byte) =>
          typeof byte === 'number' &&
          Number.isInteger(byte) &&
          byte >= 0 &&
          byte <= 255
      )
    )
  })
}

function isResult(value: unknown): value is MigrationResult {
  if (
    !isRecord(value) ||
    typeof value.status !== 'string' ||
    !statuses.has(value.status) ||
    value.status === 'running' ||
    typeof value.detail !== 'string' ||
    (value.conversion_not_started !== undefined &&
      typeof value.conversion_not_started !== 'boolean') ||
    (value.conversion_not_started === true &&
      !['failed', 'unsupported', 'validation_failed'].includes(value.status)) ||
    !isFiles(value.files ?? {})
  )
    return false
  const validation = value.validation
  if (value.status !== 'succeeded')
    return Object.keys(value.files ?? {}).length === 0
  return (
    isRecord(validation) &&
    validation.source_version === '2.0' &&
    validation.target === MIGRATION_TARGET &&
    typeof validation.runtime_version === 'string' &&
    typeof validation.rules_revision === 'string' &&
    typeof validation.summary === 'string' &&
    validation.source_executed === true &&
    validation.target_executed === true &&
    validation.geometry_preserved === true &&
    validation.behavior_preserved === true
  )
}

function isOperation(value: unknown): value is MigrationOperation {
  if (!isRecord(value)) return false
  const snapshot = value.project_snapshot
  return (
    typeof value.id === 'string' &&
    isRecord(snapshot) &&
    typeof snapshot.project_id === 'string' &&
    typeof snapshot.snapshot_id === 'string' &&
    value.target === MIGRATION_TARGET &&
    typeof value.deadline === 'string' &&
    Number.isFinite(Date.parse(value.deadline)) &&
    typeof value.status === 'string' &&
    statuses.has(value.status) &&
    (value.status === 'running'
      ? value.result == null
      : isResult(value.result) && value.result.status === value.status)
  )
}

export function parseMigrationMessage(
  value: unknown
): MigrationServerMessage | Error {
  if (isRecord(value)) {
    if (value.type === 'pong') return { type: 'pong' }
    if (value.type === 'error' && typeof value.detail === 'string') {
      return { type: 'error', detail: value.detail }
    }
    if (value.type === 'operation' && isOperation(value.operation)) {
      return { type: 'operation', operation: value.operation }
    }
  }
  return new Error(
    'The server returned an invalid migration result. No changes were applied.'
  )
}

export function belongsToRequest(
  operation: MigrationOperation,
  request: MigrationRequest
) {
  return (
    operation.id === request.request_id &&
    operation.target === request.target &&
    operation.project_snapshot.project_id ===
      request.project_snapshot.project_id &&
    operation.project_snapshot.snapshot_id ===
      request.project_snapshot.snapshot_id
  )
}
