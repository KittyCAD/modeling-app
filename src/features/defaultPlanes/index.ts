import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { computed } from '@preact/signals'
import { defaultPlanesService } from '@src/contracts/defaultPlanes'
import { engineConnectionService } from '@src/contracts/engine'
import { kclSceneService } from '@src/contracts/kclScene'
import { createDefaultPlanes } from '@src/features/defaultPlanes/createDefaultPlanes'
import { hiddenArtifactIds } from '@src/features/featureTree/visibility'
import { sceneIsEmpty } from '@src/lib/kcl/sceneContents'

/**
 * The default planes, and when they are worth showing.
 *
 * Its own feature rather than part of the engine scene, because what it holds is
 * a *policy* — a plane is visible when there is nothing else to look at — and the
 * two things that policy reads belong to different owners: the plane ids come
 * from the executor, and the answer to "is there anything else" comes from the
 * artifact graph and the `hide()` calls in the feature tree.
 *
 * Everything it does to the engine is one effect reconciling one derived signal,
 * which is the part worth protecting. The same behaviour in the existing app is a
 * flag mirrored in machine context, mutated from five actions, and driven by
 * debounced events into a nested state machine.
 */
export default defineRegistryItemFactory((ctx) => {
  // Lazy, never in the factory body: resolving a service while the graph is
  // being flattened is not allowed.
  const scene = () => ctx.services.optional(kclSceneService)
  const engine = () => ctx.services.optional(engineConnectionService)

  const planes = createDefaultPlanes({
    ids: computed(() => scene()?.defaultPlanes.value ?? null),

    /**
     * Whether anything is on screen.
     *
     * Both halves of the question come from the same run: the artifact graph
     * says what was built, and the `hide()` calls in the operation timeline say
     * which of it was taken away again.
     */
    sceneIsEmpty: computed(() => {
      const current = scene()
      if (!current) return true

      const operations = Object.values(
        current.operations.value.map ?? {}
      ).flat()
      return sceneIsEmpty(
        current.artifacts.value,
        hiddenArtifactIds(operations)
      )
    }),

    /*
     * Fired rather than sent: the answer is a confirmation nobody reads, and
     * awaiting six of them per run would put the planes behind a round trip they
     * do not need.
     */
    setHidden: (id, hidden) => {
      engine()?.fireCommand({ type: 'object_visible', object_id: id, hidden })
    },

    sceneEpoch: computed(() => engine()?.sceneEpoch.value ?? 0),
  })

  /**
   * Deferred by a microtask, as everything with an effect here is.
   *
   * Both effects read services on their first run — the engine, to tell it about
   * a plane — and the container refuses a service read while the graph is being
   * flattened. This is that rule, obeyed at the place that knows about it.
   */
  let disposed = false
  queueMicrotask(() => {
    if (!disposed) planes.start()
  })

  return {
    model: planes,
    item: defineRuntimeRegistryItem({
      id: 'defaultPlanes',
      dispose: () => {
        disposed = true
        planes.dispose()
      },
      providesServices: [provideService(defaultPlanesService, planes)],
    }),
  }
}, 'defaultPlanes')
