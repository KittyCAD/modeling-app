import { signal } from '@preact/signals-core'
import { MigrationRecoveryError } from '@src/lib/kclMigration/apply'
import { isErr } from '@src/lib/trap'
import {
  connectMigration,
  type MigrationConnection,
} from '@src/lib/kclMigration/client'
import {
  MIGRATION_TARGET,
  type MigrationOperation,
  type MigrationRequest,
} from '@src/lib/kclMigration/protocol'
import {
  candidateFiles,
  type ProjectFiles,
} from '@src/lib/kclMigration/snapshot'

export interface MigrationSnapshot {
  projectId: string
  entrypoint: string
  files: ProjectFiles
}

export interface MigrationProject {
  capture: () => Promise<MigrationSnapshot>
  apply: (
    expected: ProjectFiles,
    replacement: ProjectFiles
  ) => Promise<string | undefined>
  isCurrent: () => boolean
}

export type MigrationPhase =
  | 'idle'
  | 'capturing'
  | 'connecting'
  | 'running'
  | 'cancelling'
  | 'disconnected'
  | 'review'
  | 'applying'
  | 'applied'
  | 'undoing'
  | 'recovery_required'
  | 'failed'
  | 'cancelled'

/** Owns one project's attempt and its review/undo snapshots outside React. */
export class MigrationController {
  readonly phase = signal<MigrationPhase>('idle')
  readonly detail = signal('')
  readonly operation = signal<MigrationOperation | undefined>(undefined)
  readonly candidate = signal<ProjectFiles | undefined>(undefined)
  readonly original = signal<MigrationSnapshot | undefined>(undefined)
  private request: MigrationRequest | undefined
  private abort = new AbortController()
  private connection: MigrationConnection | undefined
  private disposed = false
  private cancelled = false

  constructor(
    private readonly project: MigrationProject,
    private readonly token: () => string
  ) {}

  private current = () => !this.disposed && this.project.isCurrent()

  async start(allowPreview: boolean): Promise<void> {
    if (
      !allowPreview ||
      !this.current() ||
      !['idle', 'failed', 'cancelled'].includes(this.phase.value)
    )
      return
    this.abort.abort()
    this.abort = new AbortController()
    const owner = this.abort
    this.original.value = undefined
    this.request = undefined
    this.cancelled = false
    this.candidate.value = undefined
    this.operation.value = undefined
    this.detail.value = ''
    this.phase.value = 'capturing'
    try {
      const original = await this.project.capture()
      if (!this.current() || owner !== this.abort || owner.signal.aborted)
        return
      this.original.value = original
      this.request = {
        request_id: crypto.randomUUID(),
        project_snapshot: {
          project_id: original.projectId,
          snapshot_id: crypto.randomUUID(),
        },
        entrypoint: original.entrypoint,
        current_files: Object.fromEntries(
          [...original.files].map(([path, bytes]) => [path, Array.from(bytes)])
        ),
        target: MIGRATION_TARGET,
        allow_preview: true,
      }
      await this.connect(false)
    } catch (error: unknown) {
      if (owner === this.abort) this.fail(error)
    }
  }

  private async connect(statusOnly: boolean): Promise<void> {
    if (!this.request || !this.current()) return
    this.phase.value = 'connecting'
    const owner = this.abort
    try {
      const connection = await connectMigration({
        request: this.request,
        token: this.token(),
        signal: owner.signal,
        statusOnly,
        onOperation: (operation) => {
          if (!this.current() || owner !== this.abort || owner.signal.aborted)
            return
          this.operation.value = operation
          if (operation.status === 'running') {
            this.phase.value = this.cancelled ? 'cancelling' : 'running'
            return
          }
          this.detail.value = operation.result?.detail ?? ''
          if (operation.result?.conversion_not_started === true) {
            this.detail.value +=
              ' This attempt did not count toward your daily migration limit.'
          }
          if (this.cancelled || operation.status === 'cancelled') {
            this.phase.value = 'cancelled'
            this.candidate.value = undefined
          } else if (operation.status === 'succeeded' && this.original.value) {
            const candidate = candidateFiles(
              this.original.value.files,
              operation.result?.files ?? {}
            )
            if (isErr(candidate)) return this.fail(candidate)
            this.candidate.value = candidate
            this.phase.value = 'review'
          } else {
            this.phase.value = 'failed'
          }
        },
        onError: (error) => {
          if (owner === this.abort) this.fail(error)
        },
        onDisconnect: () => {
          if (!this.current() || owner !== this.abort) return
          this.phase.value = 'disconnected'
          this.detail.value =
            'The connection closed. Check the final status before starting another attempt. Disconnected migrations do not resume.'
        },
      })
      if (!this.current() || owner !== this.abort || owner.signal.aborted)
        connection.close()
      else {
        this.connection = connection
        if (this.cancelled) connection.cancel()
      }
    } catch (error: unknown) {
      if (owner === this.abort && this.current() && !owner.signal.aborted)
        this.fail(error)
    }
  }

  async recover(): Promise<void> {
    if (this.phase.value !== 'disconnected') return
    this.connection?.close()
    await this.connect(true)
  }

  cancel(): void {
    this.cancelled = true
    this.candidate.value = undefined
    if (this.phase.value === 'capturing' || this.phase.value === 'connecting') {
      this.abort.abort()
      this.phase.value = 'cancelled'
    } else if (this.phase.value === 'running') {
      this.phase.value = 'cancelling'
      this.connection?.cancel()
    }
  }

  async apply(): Promise<void> {
    const before = this.original.value?.files
    const after = this.candidate.value
    if (!this.current() || !before || !after || this.phase.value !== 'review')
      return
    this.phase.value = 'applying'
    try {
      const warning = await this.project.apply(before, after)
      if (this.current()) {
        this.phase.value = 'applied'
        this.detail.value =
          warning ||
          'Migration applied. Keep this project open to use Undo Migration.'
      }
    } catch (error: unknown) {
      this.fail(error)
    }
  }

  async undo(): Promise<void> {
    const before = this.original.value?.files
    const after = this.candidate.value
    if (!this.current() || !before || !after || this.phase.value !== 'applied')
      return
    this.phase.value = 'undoing'
    try {
      const warning = await this.project.apply(after, before)
      if (this.current()) {
        this.phase.value = 'idle'
        this.candidate.value = undefined
        this.detail.value = warning || 'The original project was restored.'
      }
    } catch (error: unknown) {
      if (this.current()) {
        this.phase.value =
          error instanceof MigrationRecoveryError
            ? 'recovery_required'
            : 'applied'
        this.detail.value = isErr(error)
          ? error.message
          : 'Undo could not complete.'
      }
    }
  }

  private fail(error: unknown): void {
    if (!this.current() || this.abort.signal.aborted) return
    this.phase.value =
      error instanceof MigrationRecoveryError ? 'recovery_required' : 'failed'
    this.detail.value = isErr(error)
      ? error.message
      : 'Migration could not complete.'
    this.connection?.close()
  }

  dispose(): void {
    this.disposed = true
    this.abort.abort()
    this.connection?.close()
  }
}
