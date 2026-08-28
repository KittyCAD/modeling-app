import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed } from '@preact/signals'
import { commandsValueSpec } from '@src/contracts/commands'
import { kclSceneService } from '@src/contracts/kclScene'
import { sceneInteractionsValueSpec } from '@src/contracts/scene'
import { scenePickerService, selectionService } from '@src/contracts/selection'
import {
  createClickRecogniser,
  selectionModeFor,
} from '@src/features/selection/createClickRecogniser'
import { createSelectionService } from '@src/features/selection/createSelectionService'

/**
 * Selection: clicking the model, and what that means.
 *
 * Sits beside the camera on the same seam. Both are contributed scene
 * interactions over whatever surface the scene is drawn on, and neither knows the
 * other exists — the camera claims drags, this claims clicks, and the guard table
 * is what keeps them apart.
 *
 * What is selected is renderer-independent: entity ids plus whatever the artifact
 * graph says about them. Only the *picking* is engine-specific, and that is on
 * the other side of `scenePickerService` for the same reason the camera's
 * command envelope is on the other side of `cameraDriverService`.
 */
export default defineRegistryItemFactory((ctx) => {
  const selection = createSelectionService({
    picker: () => ctx.services.optional(scenePickerService),
    scene: () => ctx.services.optional(kclSceneService),
  })

  const hasSelection = computed(() => selection.entities.value.length > 0)

  return {
    model: selection,
    item: defineRuntimeRegistryItem({
      id: 'selection',
      providesServices: [provideService(selectionService, selection)],
      provides: [
        /**
         * Clicks, ordered after the camera.
         *
         * The camera attaches first and claims what its guard table recognises;
         * a plain left click is not a gesture under any of the seven
         * conventions, so it arrives here unclaimed.
         */
        provide(sceneInteractionsValueSpec, {
          id: 'selection',
          order: 200,
          attach: (element: HTMLElement) => {
            const pointFor = (event: PointerEvent) => {
              const rect = element.getBoundingClientRect()
              return {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top,
                viewport: { width: rect.width, height: rect.height },
              }
            }

            return createClickRecogniser(element, {
              onClick: (event) => {
                void selection.selectAt(
                  pointFor(event),
                  selectionModeFor(event)
                )
              },
            })
          },
        }),

        provide(commandsValueSpec, {
          id: 'selection.clear',
          title: 'Clear selection',
          category: 'Edit',
          icon: 'close',
          enabled: hasSelection,
          run: () => selection.clear(),
        }),
      ],
    }),
  }
}, 'selection')
