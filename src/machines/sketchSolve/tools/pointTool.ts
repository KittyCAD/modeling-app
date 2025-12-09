import { assertEvent, fromPromise, setup } from 'xstate'

import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type RustContext from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import type {
  SegmentCtor,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { roundOff } from '@src/lib/utils'
import { baseUnitToNumericSuffix } from '@src/lang/wasm'
import type { KclManager } from '@src/lang/KclManager'

const TOOL_ID = 'Point tool'
const CONFIRMING_DIMENSIONS = 'Confirming dimensions'
const CONFIRMING_DIMENSIONS_DONE = `xstate.done.actor.0.${TOOL_ID}.${CONFIRMING_DIMENSIONS}`

type ToolEvents =
  | { type: 'unequip' }
  | { type: 'escape' }
  | { type: 'add point'; data: [x: number, y: number] }
  | {
      type: `xstate.done.actor.0.${typeof TOOL_ID}.${typeof CONFIRMING_DIMENSIONS}`
      output: {
        kclSource: SourceDelta
      }
    }

export const machine = setup({
  types: {
    context: {} as {
      sceneInfra: SceneInfra
      rustContext: RustContext
      kclManager: KclManager
      sketchId: number
    },
    events: {} as ToolEvents,
    input: {} as {
      sceneInfra: SceneInfra
      rustContext: RustContext
      kclManager: KclManager
      sketchId: number
    },
  },
  actions: {
    'add point listener': ({ self, context }) => {
      context.sceneInfra.setCallbacks({
        onClick: (args) => {
          if (!args) return
          if (args.mouseEvent.which !== 1) return // Only left click

          const twoD = args.intersectionPoint?.twoD
          if (twoD) {
            // Send the add point event with the clicked coordinates
            self.send({
              type: 'add point',
              data: [twoD.x, twoD.y],
            })
          }
        },
      })
    },
    'remove point listener': ({ context }) => {
      console.log('should be exiting point tool now')
      // Reset callbacks to remove the onClick listener
      context.sceneInfra.setCallbacks({
        onClick: () => {},
      })
    },
    'send result to parent': ({ event, self }) => {
      if (event.type !== CONFIRMING_DIMENSIONS_DONE) {
        return
      }
      self._parent?.send({
        type: 'update sketch outcome',
        data: event.output,
      })
    },
  },
  actors: {
    modAndSolve: fromPromise(
      async ({
        input,
      }: {
        input: {
          pointData: [number, number]
          rustContext: RustContext
          kclManager: KclManager
          sketchId: number
        }
      }) => {
        const { pointData, rustContext, kclManager, sketchId } = input
        const [x, y] = pointData

        try {
          // Get the current unit from file settings, defaulting to mm if not set
          const units = baseUnitToNumericSuffix(
            kclManager.fileSettings.defaultLengthUnit
          )

          // Note: x and y come from intersectionPoint.twoD which is in world coordinates and scaled to match current units
          const segmentCtor: SegmentCtor = {
            type: 'Point',
            position: {
              x: { type: 'Var', value: roundOff(x), units },
              y: { type: 'Var', value: roundOff(y), units },
            },
          }

          // Call the addSegment method using the rustContext from context
          const result = await rustContext.addSegment(
            0, // version - TODO: Get this from actual context
            sketchId, // sketchId from context
            segmentCtor,
            'point-tool-point', // label
            await jsAppSettings()
          )

          console.log('Point segment added successfully:', result)

          return result
        } catch (error) {
          console.error('Failed to add point segment:', error)
          return {
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        }
      }
    ),
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QAUD2BLAdgFwATdVQBsBiAV0zAEcz0AHAbQAYBdRUO1WdbdVTdiAAeiAIwAmcaIB0AZgCcANlniAHAHZZAVkXilAGhABPRABZp61VvWnFW8Uy0KdogL6vDaLHgLFydCABDbDBcWDAiMABjXn5mNiQQTm5YgUSRBAVxaUVRJlU1JwL5UWtDEwQAWkLpJiZxbVN1ayY7VUV3TwwcfEIiaQAnMECII1wAM1QB3DJw6aiidCiAaxIRiFxOb3jBZJ4+NNAM3VVpeXtVUtL81QVysVVzZrrZK815JU6QLx7ffoBhfjjdADAC2WCguAg6FBYEw3H4sBIEH4YGkWAAbqhlmifj4+tJAZhgWCIVCYXCEfCEJjUFFggd4jtEntUoJjhJpKIrKJTKYmOpRIpFOpxPcEE1pPzZE1rKomKIFKYvnjesRCUCQeDMJDobD4QckWABgMptI6ERgpMwdJVX8NcStWS9ZTDTTMFj6akmaxdlx9vx2WJHKd2iLwzKdKpVOLuYppOJTB95PKlJdzu4PCBMKgIHBBHa+n6Ugcg5lROoLA5FKZ5fZRBXxOpxZUJJWpKZI0wVKJ5LW3FnC+qhiMxtaZnNcAslstiwHDsJELI7FXWrXHFJG83jGJcgmtHVxC1a69TOIVd18eqiSTtbqKQbEXO2elEAUZImZRWtPJHEwSrGe5Hoe6jyLIqjJimF7eGq-QUNQtB0HQELPqWr4IG28gJio4g1kwph5PI6iKLGfL7nUCpNsUpj2JmrhAA */
  context: ({ input }) => ({
    sceneInfra: input.sceneInfra,
    rustContext: input.rustContext,
    kclManager: input.kclManager,
    sketchId: input.sketchId,
  }),
  id: TOOL_ID,
  initial: 'ready for user click',
  on: {
    unequip: {
      // target: `#${TOOL_ID}.unequipping`, // using TOOL_ID breaks the xstate visualizer
      target: `#Point tool.unequipping`,
      description:
        "can be requested from the outside, but we want this tool to have the final say on when it's done.",
    },
  },
  description: 'Creates a point',
  states: {
    'ready for user click': {
      entry: 'add point listener',

      on: {
        'add point': CONFIRMING_DIMENSIONS,
        escape: {
          target: 'unequipping',
          description: 'ESC in ready state unequips the tool',
        },
      },
    },

    [CONFIRMING_DIMENSIONS]: {
      invoke: {
        input: ({ event, context }) => {
          assertEvent(event, 'add point')
          return {
            pointData: event.data,
            rustContext: context.rustContext,
            kclManager: context.kclManager,
            sketchId: context.sketchId,
          }
        },
        onDone: {
          target: 'ready for user click',
          reenter: true,
          actions: 'send result to parent',
        },
        onError: {
          target: 'unequipping',
        },
        onExit: {
          actions: 'send result to parent',
        },
        src: 'modAndSolve',
      },
    },

    unequipping: {
      type: 'final',
      entry: 'remove point listener',
      description: 'Any teardown logic should go here.',
    },
  },
})
