import { signal } from '@preact/signals-core'

/** Manufacturing specifications belong to one entry point, never to the batch. */
export interface FactoryPart {
  entrypoint: string
  material: string
  finish: string
  quantity: number
  notes: string
}

/** A batch captures these bytes once and shares them between all split jobs. */
export interface FactorySnapshot {
  files: readonly { relativePath: string; data: Uint8Array }[]
}

export interface FactoryDelivery {
  shipping_address_revision_id: string
  is_expedited: boolean
}

export interface SubmittedFactoryJob {
  id: string
  status: string
  part: FactoryPart
}

export type FactoryWriteResult =
  | { ok: true; id: string; status: string }
  | { ok: false; message: string; uncertain: boolean }

export interface FactoryJobRequests {
  create: (
    part: FactoryPart,
    snapshot: FactorySnapshot,
    delivery: FactoryDelivery
  ) => Promise<FactoryWriteResult>
  revise: (
    job: SubmittedFactoryJob,
    part: FactoryPart
  ) => Promise<FactoryWriteResult>
}

export function parseFactoryPart(part: FactoryPart): FactoryPart | Error {
  if (!part.entrypoint || !part.material || !part.finish)
    return new Error(
      'Choose an entry point, material, and finish for each job.'
    )
  if (!Number.isSafeInteger(part.quantity) || part.quantity < 1)
    return new Error('Quantity must be a positive whole number.')
  return { ...part, notes: part.notes.trim() }
}

/**
 * Confirmed jobs survive popover closes and project switches while installed.
 * Each project/account has its own workspace; disposal ignores late responses.
 */
export function createFactoryWorkspace() {
  const jobs = signal<readonly SubmittedFactoryJob[]>([])
  const pending = signal(false)
  const error = signal('')
  const uncertain = signal(false)
  let disposed = false
  const submit = async (
    parts: readonly FactoryPart[],
    snapshot: FactorySnapshot,
    delivery: FactoryDelivery,
    requests: FactoryJobRequests
  ): Promise<readonly string[]> => {
    if (disposed || pending.peek() || uncertain.peek()) return []
    const parsed = parts.map(parseFactoryPart)
    const invalid = parsed.find((part) => part instanceof Error)
    if (invalid instanceof Error) {
      error.value = invalid.message
      return []
    }
    if (
      !parts.length ||
      new Set(parts.map((part) => part.entrypoint)).size !== parts.length
    ) {
      error.value = 'Choose each entry point only once.'
      return []
    }
    if (
      parts.some(
        (part) =>
          !snapshot.files.some((file) => file.relativePath === part.entrypoint)
      )
    ) {
      error.value =
        'A selected entry point is missing from the project snapshot.'
      return []
    }
    pending.value = true
    error.value = ''
    const submitted: string[] = []
    try {
      for (const part of parsed) {
        if (disposed || part instanceof Error) break
        const result = await requests.create(part, snapshot, delivery)
        if (disposed) break
        if (!result.ok) {
          error.value = result.message
          uncertain.value = result.uncertain
          break
        }
        jobs.value = [
          ...jobs.peek(),
          { id: result.id, status: result.status, part },
        ]
        submitted.push(part.entrypoint)
      }
    } finally {
      if (!disposed) pending.value = false
    }
    return submitted
  }
  return {
    jobs,
    pending,
    error,
    uncertain,
    submit,
    revise: async (
      job: SubmittedFactoryJob,
      part: FactoryPart,
      requests: FactoryJobRequests
    ) => {
      if (disposed || pending.peek() || uncertain.peek()) return false
      const parsed = parseFactoryPart(part)
      if (parsed instanceof Error) {
        error.value = parsed.message
        return false
      }
      pending.value = true
      error.value = ''
      try {
        const result = await requests.revise(job, parsed)
        if (disposed) return false
        if (!result.ok) {
          error.value = result.message
          uncertain.value = result.uncertain
          return false
        }
        jobs.value = jobs
          .peek()
          .map((item) =>
            item.id === job.id
              ? { ...item, status: result.status, part: parsed }
              : item
          )
        return true
      } finally {
        if (!disposed) pending.value = false
      }
    },
    dispose: () => {
      disposed = true
    },
  }
}

export type FactoryWorkspace = ReturnType<typeof createFactoryWorkspace>
