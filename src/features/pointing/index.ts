import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed } from '@preact/signals'
import { kclSceneService } from '@src/contracts/kclScene'
import { pointingService } from '@src/contracts/pointing'
import { sceneInteractionsValueSpec } from '@src/contracts/scene'
import { scenePickerService } from '@src/contracts/selection'
import { sketchSessionService } from '@src/contracts/sketchSession'
import { createPointing } from '@src/features/pointing/createPointing'
import { coalesceToFrame } from '@src/lib/coalesceToFrame'

/**
 * What the pointer is over, and what it has to do with the file.
 *
 * Its own feature rather than part of selection, because pointing is not
 * selecting: it is free, reversible, and gone the moment the mouse moves, and
 * the useful thing about it is not what it *is* but what it is *connected to*.
 * Selection answers "what am I acting on"; this answers "what does this have to
 * do with that", which is a question about the program.
 *
 * It contributes the scene half of the answer here and the editor half through
 * an editor capability. Both read the same derived provenance and neither knows
 * the other exists.
 */
export default defineRegistryItemFactory((ctx) => {
  const picker = () => ctx.services.optional(scenePickerService)

  const pointing = createPointing({
    artifacts: computed(
      () => ctx.services.optional(kclSceneService)?.artifacts.value ?? new Map()
    ),
    highlighter: picker,
  })

  let disposed = false
  queueMicrotask(() => {
    if (!disposed) pointing.start()
  })

  return {
    model: pointing,
    item: defineRuntimeRegistryItem({
      id: 'pointing',
      dispose: () => {
        disposed = true
        pointing.dispose()
      },
      providesServices: [provideService(pointingService, pointing)],
      provides: [
        /**
         * Hovering the scene.
         *
         * After the camera and after selection, because it claims nothing: a
         * pointer move is not a gesture anybody else wants, and asking the
         * renderer what is underneath is free of consequence. Ordered last so
         * that if it ever does grow a claim, it is the one that loses.
         */
        provide(sceneInteractionsValueSpec, {
          id: 'pointing',
          order: 300,
          attach: (element: HTMLElement) => {
            /**
             * One question per frame, and one in the air at a time.
             *
             * Every hover is a round trip on the same socket the whole app
             * talks over, so an unbounded stream of them is a real cost — the
             * existing app puts `highlight_set_entity` on the *unreliable*
             * channel precisely because it is too noisy for the reliable one.
             * Coalescing to a frame bounds the rate at the source; the picker's
             * single-flight bounds it again at the wire.
             */
            const pointer = coalesceToFrame<PointerEvent>((event) => {
              /*
               * Not while a button is down. That is a camera drag or a
               * selection in progress, and asking what is under the pointer
               * thirty times a second through an orbit would spend the socket on
               * answers nobody is going to see.
               */
              if (event.buttons !== 0) return

              /*
               * Not during a sketch. The overlay does its own hover against the
               * sketch graph — a different graph in a different id space — and
               * engine picking is suppressed while a session is open anyway.
               */
              if (ctx.services.optional(sketchSessionService)?.open.value) {
                return
              }

              const available = picker()
              if (!available?.ready.peek()) return

              const rect = element.getBoundingClientRect()
              void available
                .hover({
                  x: event.clientX - rect.left,
                  y: event.clientY - rect.top,
                  viewport: { width: rect.width, height: rect.height },
                })
                .then((entityId) => {
                  if (entityId === null) {
                    pointing.clear('scene')
                    return
                  }
                  pointing.point({
                    at: { kind: 'entity', id: entityId },
                    from: 'scene',
                  })
                })
                .catch(() => {
                  // A hover that failed is not a hover. The connection reports
                  // its own problems; this one is not worth a line of console.
                })
            })

            const onPointerMove = (event: PointerEvent) => pointer.offer(event)
            const onPointerLeave = () => {
              pointer.cancel()
              pointing.clear('scene')
            }

            element.addEventListener('pointermove', onPointerMove)
            element.addEventListener('pointerleave', onPointerLeave)

            return () => {
              pointer.cancel()
              element.removeEventListener('pointermove', onPointerMove)
              element.removeEventListener('pointerleave', onPointerLeave)
            }
          },
        }),
      ],
    }),
  }
}, 'pointing')
