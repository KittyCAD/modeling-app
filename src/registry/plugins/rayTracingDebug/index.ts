import { defineRegistryItem, provide } from '@kittycad/registry'
import {
  defineEngineSceneViewExtension,
  engineSceneViewExtensionsValueSpec,
} from '@src/registry/contracts/engineScene'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { RayTracingDebugPanel } from './RayTracingDebugPanel'

const panel = defineEngineSceneViewExtension({
  id: 'ray-tracing-debug.panel',
  zone: 'right',
  order: 10,
  Component: RayTracingDebugPanel,
  wrapperClassName: 'w-80',
})

export default createZdsPlugin({
  id: 'ray-tracing-debug',
  title: 'Ray Tracing Debug',
  description:
    'Experimental ray tracing modes and transition controls in the viewport.',
  defaultSetting: 'off',
  items: [
    defineRegistryItem({
      provides: [
        provide(engineSceneViewExtensionsValueSpec, panel, { key: panel.id }),
      ],
    }),
  ],
})
