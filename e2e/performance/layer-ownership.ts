import type { CDPSession, Page, TestInfo } from '@playwright/test'
import { isArray } from '@src/lib/utils'
import type { Protocol } from 'playwright-core/types/protocol'

interface OwnerNode {
  nodeName: string
  id: string | null
  class: string | null
  'data-testid': string | null
  role: string | null
}

interface LayerOwner {
  backendNodeId: number
  requestedAtEpochMs: number
  resolvedAtEpochMs: number
  ancestors: readonly OwnerNode[] | null
}

interface LayerReasons {
  layerId: string
  requestedAtEpochMs: number
  resolvedAtEpochMs: number
  compositingReasons: string[] | null
  compositingReasonIds: string[] | null
}

type CapturedLayer = Pick<
  Protocol.LayerTree.Layer,
  | 'layerId'
  | 'parentLayerId'
  | 'backendNodeId'
  | 'width'
  | 'height'
  | 'offsetX'
  | 'offsetY'
  | 'drawsContent'
  | 'paintCount'
>

interface LayerEvidence {
  clock: 'node-epoch-ms'
  rendererTimeOrigin: number
  changes: {
    receivedAtEpochMs: number
    layers: CapturedLayer[] | null
  }[]
  owners: LayerOwner[]
  compositing: LayerReasons[]
  errors: { stage: string; backendNodeId?: number; layerId?: string }[]
}

interface LayerCapture {
  stop(): Promise<LayerEvidence>
}

// The page owns this diagnostic session; nothing is installed on renderer globals.
const captures = new WeakMap<Page, LayerCapture>()

function isOwnerNode(value: unknown): value is OwnerNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'nodeName' in value &&
    typeof value.nodeName === 'string' &&
    'id' in value &&
    (typeof value.id === 'string' || value.id === null) &&
    'class' in value &&
    (typeof value.class === 'string' || value.class === null) &&
    'data-testid' in value &&
    (typeof value['data-testid'] === 'string' ||
      value['data-testid'] === null) &&
    'role' in value &&
    (typeof value.role === 'string' || value.role === null)
  )
}

export async function startLayerOwnershipCapture(page: Page) {
  await captures.get(page)?.stop()
  captures.delete(page)
  const rendererTimeOrigin = await page.evaluate(() => performance.timeOrigin)
  const session: CDPSession = await page.context().newCDPSession(page)
  const evidence: LayerEvidence = {
    clock: 'node-epoch-ms',
    rendererTimeOrigin,
    changes: [],
    owners: [],
    compositing: [],
    errors: [],
  }
  const requestedOwners = new Set<number>()
  const requestedLayers = new Set<string>()
  const pendingQueries: Promise<void>[] = []
  let closed = false
  let stopping: Promise<LayerEvidence> | undefined

  async function resolveCompositingReasons(layerId: string) {
    const reasons: LayerReasons = {
      layerId,
      requestedAtEpochMs: Date.now(),
      resolvedAtEpochMs: 0,
      compositingReasons: null,
      compositingReasonIds: null,
    }
    evidence.compositing.push(reasons)
    try {
      const result = await session.send('LayerTree.compositingReasons', {
        layerId,
      })
      reasons.compositingReasons = result.compositingReasons
      reasons.compositingReasonIds = result.compositingReasonIds
    } catch {
      // Short-lived layers can be removed before the protocol query resolves.
      evidence.errors.push({ stage: 'compositing-reasons', layerId })
    } finally {
      reasons.resolvedAtEpochMs = Date.now()
    }
  }

  async function resolveOwner(backendNodeId: number) {
    const owner: LayerOwner = {
      backendNodeId,
      requestedAtEpochMs: Date.now(),
      resolvedAtEpochMs: 0,
      ancestors: null,
    }
    evidence.owners.push(owner)
    let objectId: string | undefined
    try {
      const { object } = await session.send('DOM.resolveNode', {
        backendNodeId,
      })
      objectId = object.objectId
      if (!objectId) throw new Error('Layer owner has no DOM object.')
      const response = await session.send('Runtime.callFunctionOn', {
        objectId,
        arguments: [{ objectId }],
        returnByValue: true,
        functionDeclaration: function (node: Node | null) {
          const ancestors: OwnerNode[] = []
          while (node && ancestors.length < 4) {
            const element = node instanceof Element ? node : null
            ancestors.push({
              nodeName: node.nodeName,
              id: element?.getAttribute('id') ?? null,
              class: element?.getAttribute('class') ?? null,
              'data-testid': element?.getAttribute('data-testid') ?? null,
              role: element?.getAttribute('role') ?? null,
            })
            node =
              node.parentNode ?? (node instanceof ShadowRoot ? node.host : null)
          }
          return ancestors
        }.toString(),
      })
      const value: unknown = response.result.value
      if (
        response.exceptionDetails ||
        !isArray(value) ||
        !value.every(isOwnerNode)
      ) {
        throw new Error('Layer owner attributes were unavailable.')
      }
      owner.ancestors = value
    } catch {
      // Nodes may disappear between the layer event and this protocol lookup.
      evidence.errors.push({ stage: 'resolve-owner', backendNodeId })
    } finally {
      owner.resolvedAtEpochMs = Date.now()
      if (objectId && !closed) {
        await session.send('Runtime.releaseObject', { objectId }).catch(() => {
          evidence.errors.push({ stage: 'release-owner', backendNodeId })
        })
      }
    }
  }

  const onLayers = ({
    layers,
  }: Protocol.LayerTree.layerTreeDidChangePayload) => {
    evidence.changes.push({
      receivedAtEpochMs: Date.now(),
      layers:
        layers?.map((layer) => ({
          layerId: layer.layerId,
          parentLayerId: layer.parentLayerId,
          backendNodeId: layer.backendNodeId,
          width: layer.width,
          height: layer.height,
          offsetX: layer.offsetX,
          offsetY: layer.offsetY,
          drawsContent: layer.drawsContent,
          paintCount: layer.paintCount,
        })) ?? null,
    })
    for (const layer of layers ?? []) {
      if (!requestedLayers.has(layer.layerId)) {
        requestedLayers.add(layer.layerId)
        pendingQueries.push(resolveCompositingReasons(layer.layerId))
      }
      if (
        layer.backendNodeId === undefined ||
        requestedOwners.has(layer.backendNodeId)
      ) {
        continue
      }
      requestedOwners.add(layer.backendNodeId)
      pendingQueries.push(resolveOwner(layer.backendNodeId))
    }
  }

  function removeListeners() {
    session.off('LayerTree.layerTreeDidChange', onLayers)
    page.off('close', onPageClosed)
  }

  function onSessionClosed() {
    closed = true
    removeListeners()
    session.off('close', onSessionClosed)
  }

  function onPageClosed() {
    void stop().catch(() => {
      evidence.errors.push({ stage: 'page-close-cleanup' })
    })
  }

  function stop(): Promise<LayerEvidence> {
    if (stopping) return stopping
    removeListeners()
    stopping = (async () => {
      try {
        await Promise.all(pendingQueries)
        if (!closed) {
          await session.send('LayerTree.disable').catch(() => {
            evidence.errors.push({ stage: 'disable-layer-tree' })
          })
        }
      } finally {
        if (!closed) {
          await session.detach().catch(() => {
            evidence.errors.push({ stage: 'detach-session' })
          })
        }
        session.off('close', onSessionClosed)
      }
      return evidence
    })()
    return stopping
  }

  captures.set(page, { stop })
  session.on('LayerTree.layerTreeDidChange', onLayers)
  session.on('close', onSessionClosed)
  page.once('close', onPageClosed)
  try {
    await session.send('LayerTree.enable')
  } catch (error) {
    await stop()
    captures.delete(page)
    throw error
  }
}

export async function finishLayerOwnershipCapture(
  page: Page,
  testInfo?: TestInfo
) {
  const capture = captures.get(page)
  captures.delete(page)
  if (!capture) return
  const evidence = await capture.stop()
  if (testInfo) {
    await testInfo.attach('layer-ownership', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    })
  }
}
