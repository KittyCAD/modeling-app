import type {
  KclMigrationClientMessage,
  KclMigrationOperation,
  KclMigrationRequest,
  KclMigrationResult,
  KclMigrationServerMessage,
} from '@kittycad/lib'
import { isArray, isRecord } from '@src/lib/utils'

export type MigrationOperation = KclMigrationOperation
export type MigrationResult = KclMigrationResult

// API #4812 additions, until the SDK publishes the conversation contract.
export interface MigrationRequest extends KclMigrationRequest {
  conversation_id?: string | null
}

export type MigrationApplicationStatus = 'applied' | 'undone'
export interface MigrationApplication {
  status: MigrationApplicationStatus | 'not_applied'
  revision: number
}

export interface MigrationHistoryEntry {
  operation_id: string
  conversation_id: string
  prompt_id?: string | null
  after_prompt_id?: string | null
  created_at: string
  status: MigrationOperation['status']
  application: MigrationApplication
  detail: string
}

export type MigrationClientMessage =
  | Exclude<KclMigrationClientMessage, { type: 'start' }>
  | { type: 'start'; request: MigrationRequest }
  | { type: 'history'; conversation_id: string }
  | {
      type: 'application'
      operation_id: string
      status: MigrationApplicationStatus
      expected_revision: number
    }

export type MigrationServerMessage =
  | KclMigrationServerMessage
  | {
      type: 'history'
      conversation_id: string
      entries: MigrationHistoryEntry[]
    }
  | {
      type: 'application'
      operation_id: string
      application: MigrationApplication
    }

export type MigrationProgress = Extract<
  MigrationServerMessage,
  { type: 'progress' }
>['message']

export const MIGRATION_FEATURE = 'zookeeper_kcl_migration'
export const MIGRATION_TARGET = '3.0'

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
  if (!isRecord(value)) return false
  return Object.values(value).every(
    (file) =>
      isArray(file) &&
      file.every(
        (byte) =>
          typeof byte === 'number' &&
          Number.isInteger(byte) &&
          byte >= 0 &&
          byte <= 255
      )
  )
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

function isProgress(value: unknown): value is MigrationProgress {
  if (!isRecord(value)) return false
  if (isRecord(value.delta)) return typeof value.delta.delta === 'string'
  if (isRecord(value.info)) return typeof value.info.text === 'string'
  if (!isRecord(value.reasoning)) return false
  const reasoning = value.reasoning
  switch (reasoning.type) {
    case 'text':
    case 'markdown':
      return typeof reasoning.content === 'string'
    case 'kcl_code_error':
      return typeof reasoning.error === 'string'
    case 'design_plan':
      return (
        isArray(reasoning.steps) &&
        reasoning.steps.every(
          (step) =>
            isRecord(step) &&
            typeof step.filepath_to_edit === 'string' &&
            typeof step.edit_instructions === 'string'
        )
      )
    default:
      return false
  }
}

function isApplication(value: unknown): value is MigrationApplication {
  return (
    isRecord(value) &&
    ['not_applied', 'applied', 'undone'].includes(String(value.status)) &&
    typeof value.revision === 'number' &&
    Number.isInteger(value.revision) &&
    value.revision >= 0 &&
    value.revision <= 0xffffffff
  )
}

function isHistoryEntry(value: unknown): value is MigrationHistoryEntry {
  return (
    isRecord(value) &&
    typeof value.operation_id === 'string' &&
    typeof value.conversation_id === 'string' &&
    (value.prompt_id == null || typeof value.prompt_id === 'string') &&
    (value.after_prompt_id == null ||
      typeof value.after_prompt_id === 'string') &&
    typeof value.created_at === 'string' &&
    Number.isFinite(Date.parse(value.created_at)) &&
    typeof value.status === 'string' &&
    statuses.has(value.status) &&
    typeof value.detail === 'string' &&
    isApplication(value.application)
  )
}

export function parseMigrationMessage(
  value: unknown
): MigrationServerMessage | Error {
  if (isRecord(value)) {
    if (
      value.type === 'history' &&
      typeof value.conversation_id === 'string' &&
      isArray(value.entries) &&
      value.entries.every(isHistoryEntry)
    ) {
      return {
        type: 'history',
        conversation_id: value.conversation_id,
        entries: [...value.entries],
      }
    }
    if (
      value.type === 'application' &&
      typeof value.operation_id === 'string' &&
      isApplication(value.application)
    ) {
      return {
        type: 'application',
        operation_id: value.operation_id,
        application: value.application,
      }
    }
    if (
      value.type === 'progress' &&
      typeof value.operation_id === 'string' &&
      isProgress(value.message)
    ) {
      return {
        type: 'progress',
        operation_id: value.operation_id,
        message: value.message,
      }
    }
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
