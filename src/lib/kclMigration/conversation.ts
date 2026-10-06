import { signal } from '@preact/signals-core'
import { migrationConversationCommand } from '@src/lib/kclMigration/client'
import type {
  MigrationApplicationStatus,
  MigrationHistoryEntry,
} from '@src/lib/kclMigration/protocol'
import { isErr } from '@src/lib/trap'
import type { Exchange } from '@src/lib/zookeeper/zookeeperManagerMachine'

export function migrationHistoryPosition(
  entry: MigrationHistoryEntry,
  exchanges: readonly Exchange[]
): number {
  const promptId = entry.prompt_id ?? entry.after_prompt_id
  if (!promptId) return 0
  const index = exchanges.findIndex((exchange) =>
    exchange.responses.some(
      (response) =>
        'end_of_stream' in response && response.end_of_stream.id === promptId
    )
  )
  return index < 0 ? exchanges.length : index + 1
}

export interface MigrationConversationLink {
  id: string
  completed: () => void
  reportApplication: (
    operationId: string,
    status: MigrationApplicationStatus
  ) => void
}

interface ApplicationQueue {
  conversationId: string
  revision: number
  statuses: MigrationApplicationStatus[]
  sending: boolean
  error?: string
}

/** Read-only history and ordered acknowledgements. Neither path can apply project files. */
export class MigrationConversation {
  readonly replayRevision = signal(0)
  readonly reportingApplication = signal(false)
  readonly entries = signal<readonly MigrationHistoryEntry[]>([])
  readonly error = signal('')
  readonly applicationError = signal('')
  readonly loading = signal(false)
  private conversationId: string | undefined
  private reading = new AbortController()
  private reporting = new AbortController()
  private applications = new Map<string, ApplicationQueue>()

  constructor(private readonly token: () => string) {}

  select(conversationId: string | undefined): void {
    if (conversationId !== this.conversationId) this.entries.value = []
    this.conversationId = conversationId
    void this.refresh()
  }

  async refresh(): Promise<void> {
    this.reading.abort()
    const owner = (this.reading = new AbortController())
    const conversationId = this.conversationId
    this.error.value = ''
    this.loading.value = !!conversationId
    if (!conversationId) return
    try {
      const entries = new Map<string, MigrationHistoryEntry>()
      const cursors = new Set<string>()
      let before: string | undefined
      do {
        const response = await migrationConversationCommand(
          { type: 'history', conversation_id: conversationId, before },
          this.token(),
          owner.signal
        )
        if (response.type !== 'history' || owner.signal.aborted) return
        for (const entry of response.entries)
          entries.set(entry.operation_id, entry)
        before = response.next_before ?? undefined
        if (before && cursors.has(before)) {
          this.error.value = 'Migration history could not finish loading.'
          return
        }
        if (before) cursors.add(before)
      } while (before)
      if (!owner.signal.aborted)
        this.entries.value = [...entries.values()].sort(
          (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
        )
    } catch (error: unknown) {
      if (!owner.signal.aborted)
        this.error.value = isErr(error)
          ? error.message
          : 'Migration history could not load.'
    } finally {
      if (owner === this.reading) this.loading.value = false
    }
  }

  link(id: string): MigrationConversationLink {
    const owner = this.reporting
    return {
      id,
      completed: () => {
        if (!owner.signal.aborted && id === this.conversationId) {
          this.replayRevision.value += 1
          void this.refresh()
        }
      },
      reportApplication: (operationId, status) => {
        if (owner.signal.aborted) return
        let queue = this.applications.get(operationId)
        if (!queue) {
          queue = {
            conversationId: id,
            revision: 0,
            statuses: [],
            sending: false,
          }
          this.applications.set(operationId, queue)
        }
        if (queue.statuses.at(-1) !== status) queue.statuses.push(status)
        if (!queue.error) void this.flush(operationId, queue, owner)
      },
    }
  }

  private async flush(
    operationId: string,
    queue: ApplicationQueue,
    owner: AbortController
  ): Promise<void> {
    if (queue.sending || owner.signal.aborted) return
    queue.sending = true
    this.reportingApplication.value = true
    queue.error = undefined
    try {
      while (queue.statuses.length && !owner.signal.aborted) {
        const status = queue.statuses[0]
        const response = await migrationConversationCommand(
          {
            type: 'application',
            operation_id: operationId,
            status,
            expected_revision: queue.revision,
          },
          this.token(),
          owner.signal
        )
        if (response.type !== 'application' || owner.signal.aborted) return
        queue.revision = response.application.revision
        queue.statuses.shift()
        if (queue.conversationId === this.conversationId) {
          this.replayRevision.value += 1
          void this.refresh()
        }
        this.entries.value = this.entries
          .peek()
          .map((entry) =>
            entry.operation_id === operationId
              ? { ...entry, application: response.application }
              : entry
          )
      }
    } catch (error: unknown) {
      // Keep the exact revision for retry when the server may have accepted a lost reply.
      if (!owner.signal.aborted)
        queue.error = isErr(error)
          ? error.message
          : 'Application state could not be saved.'
    } finally {
      queue.sending = false
      this.reportingApplication.value = [...this.applications.values()].some(
        (item) => item.sending
      )
      if (!owner.signal.aborted)
        this.applicationError.value =
          [...this.applications.values()].find((item) => item.error)?.error ??
          ''
    }
  }

  retryApplications(): void {
    for (const [id, queue] of this.applications) {
      if (queue.statuses.length) void this.flush(id, queue, this.reporting)
    }
  }

  reset(): void {
    this.reading.abort()
    this.reporting.abort()
    this.reporting = new AbortController()
    this.applications.clear()
    this.conversationId = undefined
    this.entries.value = []
    this.error.value = ''
    this.applicationError.value = ''
    this.loading.value = false
    this.reportingApplication.value = false
    this.replayRevision.value = 0
  }
}
