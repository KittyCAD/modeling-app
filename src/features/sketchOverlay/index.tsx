import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { computed } from '@preact/signals'
import { commandService, commandsValueSpec } from '@src/contracts/commands'
import { keybindingsValueSpec } from '@src/contracts/keybindings'
import {
  sceneInteractionsValueSpec,
  sceneItemsValueSpec,
} from '@src/contracts/scene'
import {
  EXIT_MODE_COMMAND,
  toolbarItemsValueSpec,
} from '@src/contracts/sceneModes'
import { sceneProjectionService } from '@src/contracts/sceneProjection'
import { sketchSessionService } from '@src/contracts/sketchSession'
import {
  SKETCHING_MODE,
  SKETCHING_SCOPE,
} from '@src/features/sceneToolbar/modes'
import { createSketchInteraction } from '@src/features/sketchOverlay/createSketchInteraction'
import { SketchOverlay } from '@src/features/sketchOverlay/SketchOverlay'

/**
 * Drawing in a sketch: what it looks like, and what the pointer does.
 *
 * Separate from `sketchMode`, which owns *where the user is* and the session's
 * lifecycle. This owns the two things that only make sense once a sketch is
 * open, and both of them are about the scene rather than about the file: an
 * overlay that draws the sketch, and an interaction that turns clicks into
 * points on its plane.
 *
 * Neither knows how the scene is rendered. The overlay asks the projection where
 * things are and the interaction asks it where a click landed; a renderer in
 * this process would answer the same questions differently and nothing here
 * would change.
 */
export default defineRegistryItemFactory((ctx) => {
  const sessions = () => ctx.services.optional(sketchSessionService)

  const interaction = createSketchInteraction({
    session: sessions,
    projection: () => ctx.services.optional(sceneProjectionService),
  })

  /** True once there is a sketch open with a plane to draw on. */
  const drawable = computed(() => sessions()?.open.value?.plane != null)

  const equip = (tool: 'line') => () => {
    const session = sessions()
    // A second press of the same tool puts it down, which is how somebody stops
    // drawing without reaching for anything.
    session?.equip(session.tool.value?.tool === tool ? null : tool)
  }

  return {
    model: { pointer: interaction.pointer },
    item: defineRuntimeRegistryItem({
      id: 'sketchOverlay',
      provides: [
        provide(sceneItemsValueSpec, {
          id: 'sketch.overlay',
          zone: 'fill',
          order: 0,
          // Mounted only while there is something to draw, so the projection is
          // not consulted — or subscribed to — the rest of the time.
          visible: drawable,
          render: () => <SketchOverlay pointer={interaction.pointer} />,
        }),

        /**
         * Ahead of the camera, and claiming only while a tool is equipped.
         *
         * Order 50 puts it in front of the camera at 100 and selection at 200,
         * which is the only way to be: interactions share one element, so
         * `stopImmediatePropagation` from a listener bound earlier is what stops
         * them. With no tool equipped it claims nothing and orbiting works
         * exactly as it does outside a sketch.
         */
        provide(sceneInteractionsValueSpec, {
          id: 'sketch.draw',
          order: 50,
          attach: interaction.attachTool,
        }),

        /**
         * Between the camera and selection, for clicks that are not drawing.
         *
         * The camera has to see a press or an orbit inside a sketch would stop
         * working; selection must not, because its answer to a click on nothing
         * is to leave the mode — which now finishes the sketch.
         */
        provide(sceneInteractionsValueSpec, {
          id: 'sketch.pick',
          order: 150,
          attach: interaction.attachPick,
        }),

        provide(commandsValueSpec, {
          id: 'sketch.tool.line',
          title: 'Line',
          category: 'Sketch',
          icon: 'line',
          description: 'Draw a line between two points in the open sketch.',
          enabled: drawable,
          run: equip('line'),
        }),

        provide(toolbarItemsValueSpec, {
          kind: 'command',
          id: 'sketch.tool.line',
          mode: SKETCHING_MODE,
          section: 'draw',
          order: 10,
          commandId: 'sketch.tool.line',
        }),

        provide(keybindingsValueSpec, {
          keystrokes: ['l'],
          commandId: 'sketch.tool.line',
          scopes: [SKETCHING_SCOPE],
        }),

        /**
         * Escape, one step at a time.
         *
         * Backing out of a half-drawn line, putting the tool down, and finishing
         * the sketch are three different intentions, and a key that did all
         * three at once would be a key nobody could use mid-drawing. So Escape
         * undoes the innermost thing that is happening, and pressing it again
         * gets you further out — which is what it does in every CAD app.
         *
         * The last rung is the app-wide Escape. This binding is in the sketching
         * scope and therefore shadows it, so it has to be able to mean the same
         * thing when there is nothing sketch-specific left to stop.
         */
        provide(commandsValueSpec, {
          id: 'sketch.tool.cancel',
          title: 'Stop drawing',
          category: 'Sketch',
          icon: 'close',
          description:
            'Abandon the shape being drawn, then the tool, then the sketch.',
          run: () => {
            const session = sessions()
            const tool = session?.tool.value

            if (tool && tool.points.length > 0) {
              session?.cancelTool()
              return
            }
            if (tool) {
              session?.equip(null)
              return
            }

            /*
             * Nothing sketch-specific left to stop, so this means what Escape
             * means everywhere: leave the mode. Which now writes the sketch
             * back, because the mode *is* the open sketch.
             */
            ctx.services.optional(commandService)?.run(EXIT_MODE_COMMAND)
          },
        }),

        provide(keybindingsValueSpec, {
          keystrokes: ['Escape'],
          commandId: 'sketch.tool.cancel',
          scopes: [SKETCHING_SCOPE],
        }),
      ],
    }),
  }
}, 'sketchOverlay')
