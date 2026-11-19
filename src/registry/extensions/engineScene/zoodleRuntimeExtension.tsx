import { signal } from '@preact/signals-core'
import { ViewportAnnotationOverlay } from '@src/components/ViewportAnnotationOverlay'
import { clamp } from '@src/lib/utils'
import {
  defineEngineSceneStreamClassName,
  defineEngineSceneStreamLayer,
  engineSceneRuntimeExtensionsSlot,
  engineSceneStreamClassNamesFacet,
  engineSceneStreamLayersFacet,
} from '@src/registry/contracts/engineScene'
import {
  defaultZoodleToolKey,
  ZOODLE_BRUSH_SIZE_DEFAULT_PX,
  ZOODLE_BRUSH_SIZE_MAX_PX,
  ZOODLE_BRUSH_SIZE_MIN_PX,
  type ZoodleService,
  type ZoodleToolKey,
  zoodleService,
  zoodleToolDefinitions,
} from '@src/registry/contracts/zoodle'
import { contribute, provide, type Registry } from 'plankton'
export interface ZoodleRuntimeExtensionSession {
  imageDataUrl: string
  onCancel: () => void
  onSend: (annotatedDataUrl: string) => void
}

const zoodleStreamStackClassName = defineEngineSceneStreamClassName({
  id: 'zookeeper.zoodle.stream-stack',
  order: 100,
  className:
    'inset-4 z-20 rounded-lg before:content-[""] before:absolute before:-inset-4 before:bg-ml-green',
})

const clampZoodleBrushSize = (brushSize: number) => {
  const finiteBrushSize = Number.isFinite(brushSize)
    ? brushSize
    : ZOODLE_BRUSH_SIZE_DEFAULT_PX

  return clamp(
    finiteBrushSize,
    ZOODLE_BRUSH_SIZE_MIN_PX,
    ZOODLE_BRUSH_SIZE_MAX_PX
  )
}

function createZoodleService(): ZoodleService {
  const activeToolKey = signal<ZoodleToolKey>(defaultZoodleToolKey)
  const brushSize = signal(ZOODLE_BRUSH_SIZE_DEFAULT_PX)

  return {
    toolDefinitions: zoodleToolDefinitions,
    activeToolKey,
    brushSize,
    equipTool(toolKey) {
      activeToolKey.value = toolKey
    },
    setBrushSize(nextBrushSize) {
      brushSize.value = clampZoodleBrushSize(nextBrushSize)
    },
  }
}

export function createZoodleRuntimeExtension(
  session: ZoodleRuntimeExtensionSession
) {
  const zoodle = createZoodleService()
  const zoodleAnnotationLayer = defineEngineSceneStreamLayer({
    id: 'zookeeper.zoodle.annotation-layer',
    order: 100,
    wrapperClassName: 'z-50 rounded-lg overflow-hidden',
    Component: () => (
      <ViewportAnnotationOverlay
        imageDataUrl={session.imageDataUrl}
        onCancel={session.onCancel}
        onSend={session.onSend}
        zoodle={zoodle}
      />
    ),
  })
  return [
    contribute(
      engineSceneStreamClassNamesFacet,
      () => zoodleStreamStackClassName,
      {
        key: zoodleStreamStackClassName.id,
      }
    ),
    contribute(engineSceneStreamLayersFacet, () => zoodleAnnotationLayer, {
      key: zoodleAnnotationLayer.id,
    }),
    provide(zoodleService, zoodle),
  ]
}

export function activateZoodleRuntimeExtension(
  registry: Pick<Registry, 'replace'>,
  session: ZoodleRuntimeExtensionSession
) {
  return registry.replace(engineSceneRuntimeExtensionsSlot, [
    createZoodleRuntimeExtension(session),
  ])
}

export function deactivateZoodleRuntimeExtension(
  registry: Pick<Registry, 'replace'>
) {
  return registry.replace(engineSceneRuntimeExtensionsSlot, [])
}
