import { OpenCascadeCommandManager } from '@src/network/openCascadeCommandManager'
import type { OpenCascadeRenderSnapshot } from '@src/network/openCascadeCommandManager'

type WorkerRequest = {
  type: 'request'
  id: number
  method: string
  args?: unknown[]
}

const manager = new OpenCascadeCommandManager({ registerLatest: false })
let mutationQueue: Promise<unknown> = Promise.resolve()
let lastSnapshot: OpenCascadeRenderSnapshot | undefined

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
    const response = {
      type: 'response',
      id: message.id,
      ok: true,
      result,
    } as const
    postResponse(response, transferablesFor(result))
  } catch (error) {
    self.postMessage({
      type: 'response',
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function postResponse(message: unknown, transfer: Transferable[]) {
  const workerSelf = self as unknown as {
    postMessage(message: unknown, transfer: Transferable[]): void
  }
  workerSelf.postMessage(message, transfer)
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
  const snapshot = await manager.exportRenderSnapshot()
  const patch = snapshotPatch(snapshot, lastSnapshot)
  lastSnapshot = snapshot
  self.postMessage({
    type: 'stream',
    snapshot: patch,
  })
}

function snapshotPatch(
  snapshot: OpenCascadeRenderSnapshot,
  previous: OpenCascadeRenderSnapshot | undefined
): Partial<Omit<OpenCascadeRenderSnapshot, 'versions'>> &
  Pick<OpenCascadeRenderSnapshot, 'versions'> {
  if (!previous) {
    return snapshot
  }

  const patch: Partial<Omit<OpenCascadeRenderSnapshot, 'versions'>> &
    Pick<OpenCascadeRenderSnapshot, 'versions'> = {
    versions: snapshot.versions,
    selectionFilter: snapshot.selectionFilter,
    exportError: snapshot.exportError,
    solidCount: snapshot.solidCount,
    hiddenObjectIds: snapshot.hiddenObjectIds,
    pathPlanes: snapshot.pathPlanes,
    pathVisibility: snapshot.pathVisibility,
  }
  const visibilityChanged =
    snapshot.versions.visibility !== previous.versions.visibility
  if (
    visibilityChanged ||
    snapshot.versions.topology !== previous.versions.topology
  ) {
    patch.topologyMeshes = snapshot.topologyMeshes
  }
  if (
    visibilityChanged ||
    snapshot.versions.sketch !== previous.versions.sketch
  ) {
    patch.sketchLineMeshes = snapshot.sketchLineMeshes
  }
  if (
    visibilityChanged ||
    snapshot.versions.plane !== previous.versions.plane
  ) {
    patch.planeMeshes = snapshot.planeMeshes
  }
  if (
    visibilityChanged ||
    snapshot.versions.region !== previous.versions.region
  ) {
    patch.regionMeshes = snapshot.regionMeshes
  }
  return patch
}

function transferablesFor(value: unknown): Transferable[] {
  const transferables: Transferable[] = []
  const seen = new Set<unknown>()
  const visit = (item: unknown) => {
    if (!item || seen.has(item)) {
      return
    }
    seen.add(item)
    if (item instanceof Uint8Array) {
      transferables.push(item.buffer)
      return
    }
    if (Array.isArray(item)) {
      for (const child of item) {
        visit(child)
      }
      return
    }
    if (typeof item === 'object') {
      for (const child of Object.values(item)) {
        visit(child)
      }
    }
  }
  visit(value)
  return transferables
}
