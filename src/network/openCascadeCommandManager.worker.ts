import { OpenCascadeCommandManager } from '@src/network/openCascadeCommandManager'

type WorkerRequest = {
  type: 'request'
  id: number
  method: string
  args?: unknown[]
}

const manager = new OpenCascadeCommandManager({ registerLatest: false })
let mutationQueue: Promise<unknown> = Promise.resolve()

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const message = event.data
  if (message.type !== 'request') {
    return
  }

  void handleRequest(message)
})

void postSnapshot()

async function handleRequest(message: WorkerRequest) {
  try {
    const result = mutatesScene(message.method)
      ? await enqueueMutation(() =>
          handleMethod(message.method, message.args || [])
        )
      : await handleExport(message.method, message.args || [])
    self.postMessage({
      type: 'response',
      id: message.id,
      ok: true,
      result,
    })
  } catch (error) {
    self.postMessage({
      type: 'response',
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function enqueueMutation<T>(fn: () => Promise<T>): Promise<T> {
  const next = mutationQueue.then(fn, fn)
  mutationQueue = next.then(() => postSnapshot()).catch(() => undefined)
  return next
}

async function handleExport(method: string, args: unknown[]): Promise<unknown> {
  await mutationQueue.catch(() => undefined)
  return handleMethod(method, args)
}

async function handleMethod(method: string, args: unknown[]): Promise<unknown> {
  switch (method) {
    case 'startNewSession':
      return manager.startNewSession()
    case 'recordRollbackMarker':
      return manager.recordRollbackMarker(String(args[0]))
    case 'sendModelingCommandFromWasm':
      return manager.sendModelingCommandFromWasm(
        String(args[0]),
        String(args[1]),
        String(args[2]),
        String(args[3])
      )
    case 'exportLastBrep':
      return manager.exportLastBrep()
    case 'exportLatestGlbBytes':
      return manager.exportLatestGlbBytes()
    case 'exportVisibleGlbBytes':
      return manager.exportVisibleGlbBytes()
    case 'exportLatestProfileGlbBytes':
      return manager.exportLatestProfileGlbBytes()
    case 'exportRenderSnapshot':
      return manager.exportRenderSnapshot()
    default:
      throw new Error(`Unsupported OpenCascade worker method: ${method}`)
  }
}

function mutatesScene(method: string): boolean {
  return (
    method === 'startNewSession' ||
    method === 'recordRollbackMarker' ||
    method === 'sendModelingCommandFromWasm'
  )
}

async function postSnapshot() {
  self.postMessage({
    type: 'stream',
    snapshot: await manager.exportRenderSnapshot(),
  })
}
