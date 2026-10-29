import { defineRegistryItemFactory, provideService } from '@kittycad/registry'
import { createInteractionOutcomes } from '@src/lib/interactionPerformance/outcomes'
import { createDelayOutcomes } from '@src/lib/interactionPerformance/delayOutcomes'
import { createModelingOutcomes } from '@src/lib/interactionPerformance/modelingOutcomes'
import { createUiOutcomes } from '@src/lib/interactionPerformance/uiOutcomes'
import type * as RecorderModule from '@src/lib/interactionPerformance/recorder'
import type { InteractionSnapshot } from '@src/lib/interactionPerformance/types'
import { interactionPerformanceService } from '@src/registry/contracts/interactionPerformance'
import { projectSession } from '@src/registry/contracts/projectSession'

export default import.meta.env.VITE_INTERACTION_PERFORMANCE === '1'
  ? defineRegistryItemFactory((ctx) => {
      const getEditor = () =>
        ctx.services.optional(projectSession)?.getProject()?.executingEditor
          .value ?? undefined
      const originalDefinitions = Object.values(
        createInteractionOutcomes(() => getEditor()?.hasParseErrors() ?? false)
      )
      const interactionDefinitions = [
        ...originalDefinitions,
        ...createDelayOutcomes(getEditor),
        ...createModelingOutcomes(getEditor),
        ...createUiOutcomes(getEditor),
      ]
      let recorder: RecorderModule.InteractionRecorder | undefined
      let loading: Promise<typeof RecorderModule> | undefined
      let generation = 0
      let disposed = false

      const snapshot = (): InteractionSnapshot =>
        recorder?.snapshot() ?? {
          samples: [],
          registered: originalDefinitions.map(
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
        id: 'interaction-performance',
        providesServices: [
          provideService(interactionPerformanceService, {
            async start(interactionIds) {
              if (disposed) {
                return Promise.reject(
                  new Error('The interaction recording service is disposed.')
                )
              }
              const unknown = interactionIds?.find(
                (id) =>
                  !interactionDefinitions.some(
                    (definition) => definition.id === id
                  )
              )
              if (unknown) {
                return Promise.reject(
                  new Error(`Unknown interaction: ${unknown}`)
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
              // Paired comparisons keep their immutable workload. Expanded
              // absolute-budget scenarios explicitly select their identities.
              const error = recorder.start(
                interactionIds ?? originalDefinitions.map(({ id }) => id)
              )
              if (error) return Promise.reject(error)
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
      }
    }, 'interaction-performance')
  : undefined
