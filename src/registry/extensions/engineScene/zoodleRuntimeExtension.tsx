import {
  type RegistryLike,
  defineRegistryItem,
  provide,
} from '@kittycad/registry'
import { ViewportAnnotationOverlay } from '@src/components/ViewportAnnotationOverlay'
import {
  defineEngineSceneStreamClassName,
  defineEngineSceneStreamLayer,
  engineSceneRuntimeExtensionsSlot,
  engineSceneStreamClassNamesValueSpec,
  engineSceneStreamLayersValueSpec,
} from '@src/registry/contracts/engineScene'

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

export function createZoodleRuntimeExtension(
  session: ZoodleRuntimeExtensionSession
) {
  const zoodleAnnotationLayer = defineEngineSceneStreamLayer({
    id: 'zookeeper.zoodle.annotation-layer',
    order: 100,
    wrapperClassName: 'z-50 rounded-lg overflow-hidden',
    Component: () => (
      <ViewportAnnotationOverlay
        imageDataUrl={session.imageDataUrl}
        onCancel={session.onCancel}
        onSend={session.onSend}
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
