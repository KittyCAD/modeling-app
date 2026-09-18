import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { interactionOutcomes } from '@src/lib/interactionPerformance/outcomes'
import type * as RecorderModule from '@src/lib/interactionPerformance/recorder'
import type { InteractionSnapshot } from '@src/lib/interactionPerformance/types'
import { interactionPerformanceService } from '@src/registry/contracts/interactionPerformance'

export default import.meta.env.VITE_INTERACTION_PERFORMANCE === '1'
  ? defineRegistryItemFactory(() => {
      const interactionDefinitions = Object.values(interactionOutcomes)
      let recorder: RecorderModule.InteractionRecorder | undefined
      let loading: Promise<typeof RecorderModule> | undefined
      let generation = 0
      let disposed = false

      const snapshot = (): InteractionSnapshot =>
        recorder?.snapshot() ?? {
          samples: [],
          registered: interactionDefinitions.map(
            ({ id, testId, budgetMs, outcome }) => ({
              id,
              testId,
              budgetMs,
              outcome,
            })
          ),
          droppedSamples: 0,
          droppedPointerEvents: 0,
          visibilityInterrupted: false,
        }

      return {
        item: defineRuntimeRegistryItem({
          id: 'interaction-performance',
          providesServices: [
            provideService(interactionPerformanceService, {
              async start() {
                if (disposed) {
                  return Promise.reject(
                    new Error('The interaction recording service is disposed.')
                  )
                }
                const requestedGeneration = ++generation
                const { InteractionRecorder } = await (loading ??= import(
                  '@src/lib/interactionPerformance/recorder'
                ).catch((error: unknown) => {
                  loading = undefined
                  return Promise.reject(error)
                }))
                // Stopping, disposal, or a newer start owns the session after loading.
                if (disposed || requestedGeneration !== generation) return
                recorder ??= new InteractionRecorder(
                  document,
                  interactionDefinitions
                )
                recorder.start()
              },
              snapshot,
              stop: () => {
                generation++
                return recorder?.stop() ?? snapshot()
              },
            }),
          ],
          dispose: () => {
            disposed = true
            generation++
            recorder?.stop()
          },
        }),
      }
    }, 'interaction-performance')
  : undefined
