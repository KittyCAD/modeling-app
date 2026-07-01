import {
  type RegistryLike,
  defineRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { ViewportAnnotationOverlay } from '@src/components/ViewportAnnotationOverlay'
import {
  defineEngineSceneStreamClassName,
  defineEngineSceneStreamLayer,
  engineSceneRuntimeExtensionsSlot,
  engineSceneStreamClassNamesValueSpec,
  engineSceneStreamLayersValueSpec,
} from '@src/registry/contracts/engineScene'
import {
  ZOODLE_BRUSH_SIZE_DEFAULT_PX,
  ZOODLE_BRUSH_SIZE_MAX_PX,
  ZOODLE_BRUSH_SIZE_MIN_PX,
  type ZoodleService,
  type ZoodleToolKey,
  defaultZoodleToolKey,
  zoodleService,
  zoodleToolDefinitions,
} from '@src/registry/contracts/zoodle'

export interface ZoodleRuntimeExtensionSession {
  imageDataUrl: string
  onCancel: () => void
  onSend: (annotatedDataUrl: string) => void
}

const zoodleStreamStackClassName = defineEngineSceneStreamClassName({
  id: 'zookeeper.zoodle.stream-stack',
  order: 100,
  className:
    'inset-4 z-20 rounded-lg transition-all duration-150 ease-out before:content-[""] before:absolute before:-inset-4 before:bg-ml-green',
})

const clampZoodleBrushSize = (brushSize: number) => {
  const finiteBrushSize = Number.isFinite(brushSize)
    ? brushSize
    : ZOODLE_BRUSH_SIZE_DEFAULT_PX

  return Math.min(
    ZOODLE_BRUSH_SIZE_MAX_PX,
    Math.max(ZOODLE_BRUSH_SIZE_MIN_PX, finiteBrushSize)
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

  return defineRegistryItem({
    id: 'zookeeper.zoodle.runtime-extension',
    provides: [
      provide(
        engineSceneStreamClassNamesValueSpec,
        zoodleStreamStackClassName,
        {
          key: zoodleStreamStackClassName.id,
        }
      ),
      provide(engineSceneStreamLayersValueSpec, zoodleAnnotationLayer, {
        key: zoodleAnnotationLayer.id,
      }),
    ],
    providesServices: [provideService(zoodleService, zoodle)],
  })
}

export function activateZoodleRuntimeExtension(
  registry: Pick<RegistryLike, 'reconfigure'>,
  session: ZoodleRuntimeExtensionSession
) {
  registry.reconfigure(engineSceneRuntimeExtensionsSlot, [
    createZoodleRuntimeExtension(session),
  ])
}

export function deactivateZoodleRuntimeExtension(
  registry: Pick<RegistryLike, 'reconfigure'>
) {
  registry.reconfigure(engineSceneRuntimeExtensionsSlot, [])
}
