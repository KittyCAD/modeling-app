import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed } from '@preact/signals'
import { commandsValueSpec } from '@src/contracts/commands'
import {
  defaultPlaneDriverService,
  defaultPlanesService,
} from '@src/contracts/defaultPlanes'
import { keybindingsValueSpec } from '@src/contracts/keybindings'
import { kclSceneService } from '@src/contracts/kclScene'
import {
  sceneHudSectionsValueSpec,
  sceneHudService,
} from '@src/contracts/sceneHud'
import { createDefaultPlanes } from '@src/features/defaultPlanes/createDefaultPlanes'
import { PlanesSection } from '@src/features/defaultPlanes/PlanesSection'
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
/** Shared between the contribution and the command that folds it. */
const SECTION_ID = 'scene.planes'

export default defineRegistryItemFactory((ctx) => {
  const hud = () => ctx.services.get(sceneHudService)
  // Lazy, never in the factory body: resolving a service while the graph is
  // being flattened is not allowed.
  const scene = () => ctx.services.optional(kclSceneService)

  const planes = createDefaultPlanes({
    /*
     * Optional, and the reason this feature has no idea what a plane is made of.
     * Whatever renders contributes one; without a renderer there is a model of
     * which planes should be showing and nobody to show them.
     */
    driver: () => ctx.services.optional(defaultPlaneDriverService) ?? null,

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
  })

  /**
   * Deferred by a microtask, as everything with an effect here is.
   *
   * Both effects resolve the driver on their first run, and the container
   * refuses a service read while the graph is being flattened. This is that
   * rule, obeyed at the place that knows about it.
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
      provides: [
        /**
         * Above the feature tree, at a negative order.
         *
         * Because the planes are what the scene is *before* it has features —
         * and because on an empty project they are the only rows the outline
         * has, which a section underneath an empty list could not be.
         */
        provide(sceneHudSectionsValueSpec, {
          id: SECTION_ID,
          title: 'Planes',
          icon: 'plane',
          order: -10,
          render: () => <PlanesSection />,
        }),

        provide(commandsValueSpec, {
          id: 'defaultPlanes.toggle',
          title: 'Toggle planes outline',
          category: 'View',
          icon: 'plane',
          shortcut: '⇧⌘4',
          active: computed(() => hud().sectionOpen(SECTION_ID).value),
          run: () => hud().toggleSection(SECTION_ID),
        }),
        provide(keybindingsValueSpec, {
          keystrokes: ['Mod+Shift+4'],
          commandId: 'defaultPlanes.toggle',
        }),
      ],
    }),
  }
}, 'defaultPlanes')
