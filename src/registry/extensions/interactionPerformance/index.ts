import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { interactionDefinitions } from '@src/lib/interactionPerformance/definitions'
import { InteractionRecorder } from '@src/lib/interactionPerformance/recorder'
import { interactionPerformanceService } from '@src/registry/contracts/interactionPerformance'

export default defineRegistryItemFactory(() => {
  const recorder = new InteractionRecorder(document, interactionDefinitions)
  return {
    item: defineRuntimeRegistryItem({
      id: 'interaction-performance',
      providesServices: [
        provideService(interactionPerformanceService, {
          start: () => recorder.start(),
          snapshot: () => recorder.snapshot(),
          stop: () => recorder.stop(),
        }),
      ],
      dispose: () => {
        recorder.stop()
      },
    }),
  }
}, 'interaction-performance')
