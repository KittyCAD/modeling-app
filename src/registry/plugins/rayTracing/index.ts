import { sceneRenderingService } from '@src/registry/contracts/sceneRendering'
import { defineRegistryItemFactory, provideService } from '@kittycad/registry'
import { rayTracingService } from '@src/registry/contracts/rayTracing'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { createRayTracingRuntime } from './runtime'

const runtime = defineRegistryItemFactory(() => {
  const runtime = createRayTracingRuntime()
  return {
    id: 'ray-tracing.runtime',
    providesServices: [
      provideService(rayTracingService, runtime.service),
      provideService(sceneRenderingService, runtime.service),
    ],
    dispose: () => runtime.dispose(),
  }
}, 'ray-tracing.runtime')

export default createZdsPlugin({
  id: 'ray-tracing',
  title: 'Ray Tracing',
  description: 'Ray-traced rendering for WebGPU viewports.',
  defaultSetting: 'off',
  items: [runtime],
  activationSetting: {
    category: 'modeling',
    settingName: 'rayTracing',
    title: 'Ray Tracing',
    description: 'Enable ray tracing in the local renderer.',
    hideOnLevel: 'project',
    userToml: { sectionKey: 'modeling', tomlKey: 'ray_tracing' },
  },
})
