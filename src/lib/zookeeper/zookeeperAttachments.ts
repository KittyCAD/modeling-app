import type { MlCopilotFile } from '@kittycad/lib'

type ZookeeperAttachmentRole = 'client' | 'server'

type ZookeeperAttachmentReference = {
  promptId: string
  seq: number
  role: ZookeeperAttachmentRole
  name: string
}

type AttachmentRequest = {
  promise: Promise<MlCopilotFile>
  resolve?: (file: MlCopilotFile) => void
  reject?: (error: Error) => void
  timeoutId?: ReturnType<typeof setTimeout>
}

const ZOOKEEPER_ATTACHMENT_FETCH_TIMEOUT_MS = 30_000
const attachmentRequests = new WeakMap<
  WebSocket,
  Map<string, AttachmentRequest>
>()

function attachmentReference(
  file: MlCopilotFile
): ZookeeperAttachmentReference | undefined {
  const promptId = file.metadata?.attachment_prompt_id
  const seq = Number(file.metadata?.attachment_seq)
  const role = file.metadata?.attachment_role

  if (
    !promptId ||
    !Number.isInteger(seq) ||
    (role !== 'client' && role !== 'server')
  ) {
    return undefined
  }

  return { promptId, seq, role, name: file.name }
}

function attachmentKey(reference: ZookeeperAttachmentReference): string {
  return JSON.stringify(reference)
}

function rejectPendingAttachment(ws: WebSocket, key: string, error: Error) {
  const request = attachmentRequests.get(ws)?.get(key)
  if (!request?.reject) {
    return
  }

  clearTimeout(request.timeoutId)
  attachmentRequests.get(ws)?.delete(key)
  request.reject(error)
}

export function fetchZookeeperAttachment(
  ws: WebSocket | undefined,
  file: MlCopilotFile
): Promise<MlCopilotFile> {
  const reference = attachmentReference(file)
  if (!reference) {
    return Promise.resolve(file)
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('Zookeeper is not connected'))
  }

  let requests = attachmentRequests.get(ws)
  if (!requests) {
    requests = new Map()
    attachmentRequests.set(ws, requests)
  }

  const key = attachmentKey(reference)
  const existing = requests.get(key)
  if (existing) {
    return existing.promise
  }

  let resolveAttachment: (file: MlCopilotFile) => void = () => {}
  let rejectAttachment: (error: Error) => void = () => {}
  const promise = new Promise<MlCopilotFile>((resolve, reject) => {
    resolveAttachment = resolve
    rejectAttachment = reject
  })
  const timeoutId = setTimeout(() => {
    rejectPendingAttachment(
      ws,
      key,
      new Error(`Timed out loading ${reference.name}`)
    )
  }, ZOOKEEPER_ATTACHMENT_FETCH_TIMEOUT_MS)

  requests.set(key, {
    promise,
    resolve: resolveAttachment,
    reject: rejectAttachment,
    timeoutId,
  })

  try {
    ws.send(
      JSON.stringify({
        type: 'fetch_attachment',
        prompt_id: reference.promptId,
        seq: reference.seq,
        role: reference.role,
        name: reference.name,
      })
    )
  } catch (error: unknown) {
    rejectPendingAttachment(
      ws,
      key,
      error instanceof Error ? error : new Error(String(error))
    )
  }

  return promise
}

export function handleZookeeperAttachmentMessage(
  ws: WebSocket,
  response: unknown
): boolean {
  if (typeof response !== 'object' || response === null) {
    return false
  }

  if (
    'error' in response &&
    typeof response.error === 'object' &&
    response.error !== null &&
    'detail' in response.error &&
    response.error.detail === 'attachment not found'
  ) {
    // Fetches are handled serially by the API, but this error has no attachment
    // identifier, so it belongs to the oldest request that is still pending.
    const firstPendingKey = Array.from(
      attachmentRequests.get(ws)?.entries() ?? []
    ).find(([, request]) => request.reject)?.[0]
    if (!firstPendingKey) {
      return false
    }
    rejectPendingAttachment(
      ws,
      firstPendingKey,
      new Error(response.error.detail)
    )
    return true
  }

  if (!('attachment' in response)) {
    return false
  }
  const attachment = response.attachment
  if (typeof attachment !== 'object' || attachment === null) {
    return true
  }

  const candidate = attachment as {
    prompt_id?: unknown
    seq?: unknown
    role?: unknown
    file?: unknown
  }
  if (
    typeof candidate.prompt_id !== 'string' ||
    !Number.isInteger(candidate.seq) ||
    (candidate.role !== 'client' && candidate.role !== 'server') ||
    typeof candidate.file !== 'object' ||
    candidate.file === null ||
    !('name' in candidate.file) ||
    typeof candidate.file.name !== 'string'
  ) {
    return true
  }

  const key = attachmentKey({
    promptId: candidate.prompt_id,
    seq: candidate.seq as number,
    role: candidate.role,
    name: candidate.file.name,
  })
  const request = attachmentRequests.get(ws)?.get(key)
  if (!request?.resolve) {
    return true
  }

  clearTimeout(request.timeoutId)
  request.resolve(candidate.file as MlCopilotFile)
  // Keep the fulfilled promise so collapsing and reopening an exchange does
  // not download the same attachment again.
  attachmentRequests.get(ws)?.set(key, { promise: request.promise })
  return true
}
