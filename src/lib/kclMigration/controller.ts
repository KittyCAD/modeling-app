import { signal } from '@preact/signals-core'
import { MigrationRecoveryError } from '@src/lib/kclMigration/apply'
import {
  connectMigration,
  type MigrationConnection,
} from '@src/lib/kclMigration/client'
import {
  MIGRATION_TARGET,
  type MigrationProgress,
  type MigrationRequest,
} from '@src/lib/kclMigration/protocol'
import {
  candidateFiles,
  type ProjectFiles,
} from '@src/lib/kclMigration/snapshot'
import { isErr } from '@src/lib/trap'

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
  | 'applying'
  | 'applied'
  | 'recovery_required'
  | 'failed'
  | 'cancelled'

/** Owns one project's attempt and automatically applies its validated result. */
export class MigrationController {
  readonly phase = signal<MigrationPhase>('idle')
  readonly detail = signal('')
  readonly progress = signal<MigrationProgress[]>([])
  readonly progressText = signal('')
  private original: MigrationSnapshot | undefined
  private request: MigrationRequest | undefined
  private readonly abort = new AbortController()
  private connection: MigrationConnection | undefined
  private disposed = false
  private cancelled = false

  get busy(): boolean {
    return [
      'capturing',
      'connecting',
      'running',
      'cancelling',
      'disconnected',
      'applying',
    ].includes(this.phase.value)
  }

  get canCancel(): boolean {
    return ['capturing', 'connecting', 'running'].includes(this.phase.value)
  }

  constructor(
    private readonly project: MigrationProject,
    private readonly token: () => string
  ) {}

  private current = () => !this.disposed && this.project.isCurrent()

  async start(): Promise<void> {
    if (!this.current() || this.phase.value !== 'idle') return
    this.phase.value = 'capturing'
    try {
      const original = await this.project.capture()
      if (!this.current() || this.abort.signal.aborted) return
      this.original = original
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
      this.fail(error)
    }
  }

  private async connect(statusOnly: boolean): Promise<void> {
    if (!this.request || !this.current()) return
    this.phase.value = 'connecting'
    try {
      const connection = await connectMigration({
        request: this.request,
        token: this.token(),
        signal: this.abort.signal,
        statusOnly,
        onProgress: (message) => {
          if (!this.current() || this.abort.signal.aborted) return
          if ('delta' in message) this.progressText.value += message.delta.delta
          else
            this.progress.value = [
              ...this.progress.value,
              'info' in message
                ? { reasoning: { type: 'text', content: message.info.text } }
                : message,
            ]
        },
        onOperation: (operation) => {
          if (!this.current() || this.abort.signal.aborted) return
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
          } else if (operation.status === 'succeeded' && this.original) {
            const candidate = candidateFiles(
              this.original.files,
              operation.result?.files ?? {}
            )
            if (isErr(candidate)) return this.fail(candidate)
            void this.apply(this.original.files, candidate)
          } else {
            this.phase.value = 'failed'
          }
        },
        onError: (error) => this.fail(error),
        onDisconnect: () => {
          if (!this.current()) return
          this.phase.value = 'disconnected'
          this.detail.value =
            'The connection closed. Check the final status before starting another attempt. Disconnected migrations do not resume.'
        },
      })
      if (!this.current() || this.abort.signal.aborted) connection.close()
      else {
        this.connection = connection
        if (this.cancelled) connection.cancel()
      }
    } catch (error: unknown) {
      this.fail(error)
    }
  }

  async recover(): Promise<void> {
    if (this.phase.value !== 'disconnected') return
    this.connection?.close()
    await this.connect(true)
  }

  cancel(): void {
    if (!this.canCancel) return
    this.cancelled = true
    if (this.phase.value === 'capturing' || this.phase.value === 'connecting') {
      this.abort.abort()
      this.phase.value = 'cancelled'
    } else if (this.phase.value === 'running') {
      this.phase.value = 'cancelling'
      this.connection?.cancel()
    }
  }

  private async apply(
    before: ProjectFiles,
    after: ProjectFiles
  ): Promise<void> {
    if (!this.current() || this.cancelled) return
    this.phase.value = 'applying'
    try {
      const warning = await this.project.apply(before, after)
      if (this.current()) {
        this.phase.value = 'applied'
        this.detail.value =
          warning ||
          'Migrated to KCL 3 preview. Use Undo to restore the previous project.'
        this.original = undefined
        this.request = undefined
      }
    } catch (error: unknown) {
      this.fail(error)
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
