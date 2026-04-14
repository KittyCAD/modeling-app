import { assertEvent, fromPromise, setup } from 'xstate'

import type {
  SceneGraphDelta,
  SegmentCtor,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { KclManager } from '@src/lang/KclManager'
import type { Coords2d } from '@src/lang/util'
import { baseUnitToNumericSuffix } from '@src/lang/wasm'
import type RustContext from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { roundOff } from '@src/lib/utils'
import { isPointSegment } from '@src/machines/sketchSolve/constraints/constraintUtils'
import {
  isSketchSolveErrorOutput,
  toastSketchSolveError,
} from '@src/machines/sketchSolve/sketchSolveErrors'
import type {
  SketchSolveMachineEvent,
  ToolInput,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import {
  getConstraintForSnapTarget,
  type SnapTarget,
} from '@src/machines/sketchSolve/snapping'
import type { BaseToolEvent } from '@src/machines/sketchSolve/tools/sharedToolTypes'
import {
  clearToolSnappingState,
  getBestSnappingCandidate,
  sendHoveredSnappingCandidate,
  updateToolSnappingPreview,
} from '@src/machines/sketchSolve/tools/toolSnappingUtils'

const TOOL_ID = 'Point tool'
const CONFIRMING_DIMENSIONS = 'Confirming dimensions'
const CONFIRMING_DIMENSIONS_DONE = `xstate.done.actor.0.${TOOL_ID}.${CONFIRMING_DIMENSIONS}`

function getPointToolSnappingCandidate({
  self,
  sceneInfra,
  sketchId,
  mousePosition,
  mouseEvent,
}: {
  self: Parameters<typeof sendHoveredSnappingCandidate>[0]
  sceneInfra: SceneInfra
  sketchId: number
  mousePosition: Coords2d
  mouseEvent: MouseEvent
}) {
  const candidate = getBestSnappingCandidate({
    self,
    sceneInfra,
    sketchId,
    mousePosition,
    mouseEvent,
  })

  return candidate
}

type ToolEvents =
  | BaseToolEvent
  | {
      type: `xstate.done.actor.0.${typeof TOOL_ID}.${typeof CONFIRMING_DIMENSIONS}`
      output: {
        kclSource: SourceDelta
        sceneGraphDelta: SceneGraphDelta
        checkpointId?: number | null
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
    input: {} as ToolInput,
  },
  guards: {
    'invoke output has error': ({ event }) =>
      'output' in event && isSketchSolveErrorOutput(event.output),
  },
  actions: {
    'add point listener': ({ self, context }) => {
      context.sceneInfra.setCallbacks({
        onClick: (args) => {
          if (!args) return
          if (args.mouseEvent.which !== 1) return // Only left click

          const twoD = args.intersectionPoint?.twoD
          if (twoD) {
            const mousePosition = [twoD.x, twoD.y] as Coords2d
            const snappingCandidate = getPointToolSnappingCandidate({
              self,
              sceneInfra: context.sceneInfra,
              sketchId: context.sketchId,
              mousePosition,
              mouseEvent: args.mouseEvent,
            })
            const [x, y] = snappingCandidate?.position ?? mousePosition
            self.send({
              type: 'add point',
              data: [x, y],
              snapTarget: snappingCandidate?.target,
            })
          }
        },
        onMove: (args) => {
          const twoD = args?.intersectionPoint?.twoD
          if (!twoD) {
            clearToolSnappingState({
              self,
              sceneInfra: context.sceneInfra,
            })
            return
          }

          const snappingCandidate = getPointToolSnappingCandidate({
            self,
            sceneInfra: context.sceneInfra,
            sketchId: context.sketchId,
            mousePosition: [twoD.x, twoD.y],
            mouseEvent: args.mouseEvent,
          })
          sendHoveredSnappingCandidate(self, snappingCandidate)
          updateToolSnappingPreview({
            sceneInfra: context.sceneInfra,
            target: snappingCandidate,
          })
        },
      })
    },
    'remove point listener': ({ context, self }) => {
      clearToolSnappingState({
        self,
        sceneInfra: context.sceneInfra,
      })
      // Reset callbacks to remove the onClick and onMove listeners
      context.sceneInfra.setCallbacks({
        onClick: () => {},
        onMove: () => {},
      })
    },
    'send result to parent': ({ event, self }) => {
      if (event.type !== CONFIRMING_DIMENSIONS_DONE) {
        return
      }
      const output = event.output as {
        kclSource: SourceDelta
        sceneGraphDelta: SceneGraphDelta
      }
      const sendData: SketchSolveMachineEvent = {
        type: 'update sketch outcome',
        data: {
          sourceDelta: output.kclSource,
          sceneGraphDelta: output.sceneGraphDelta,
        },
      }
      self._parent?.send(sendData)
    },
    'toast sketch solve error': ({ event }) => {
      toastSketchSolveError(event)
    },
  },
  actors: {
    modAndSolve: fromPromise(
      async ({
        input,
      }: {
        input: {
          pointData: [number, number]
          snapTarget?: SnapTarget
          rustContext: RustContext
          kclManager: KclManager
          sketchId: number
        }
      }) => {
        const { pointData, snapTarget, rustContext, kclManager, sketchId } =
          input
        const [x, y] = pointData

        try {
          // Get the current unit from file settings, defaulting to mm if not set
          const units = baseUnitToNumericSuffix(
            kclManager.fileSettings.defaultLengthUnit
          )
          const settings = jsAppSettings(rustContext.settingsActor)

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
            settings
          )

          if (snapTarget === undefined) {
            return result
          }

          const pointId = result.sceneGraphDelta.new_objects.find((objId) => {
            const obj = result.sceneGraphDelta.new_graph.objects[objId]
            return isPointSegment(obj)
          })

          if (pointId === undefined) {
            return {
              error: 'Point tool expected a newly created point to exist.',
            }
          }

          const snapConstraint = getConstraintForSnapTarget(
            pointId,
            snapTarget,
            units
          )
          if (snapConstraint === null) {
            return result
          }

          const snapResult = await rustContext.addConstraint(
            0,
            sketchId,
            snapConstraint,
            settings
          )

          return {
            kclSource: snapResult.kclSource,
            sceneGraphDelta: {
              ...snapResult.sceneGraphDelta,
              new_objects: [
                ...result.sceneGraphDelta.new_objects,
                ...snapResult.sceneGraphDelta.new_objects,
              ],
            },
            checkpointId:
              snapResult.checkpointId ?? result.checkpointId ?? null,
          }
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
            snapTarget: event.snapTarget,
            rustContext: context.rustContext,
            kclManager: context.kclManager,
            sketchId: context.sketchId,
          }
        },
        onDone: [
          {
            guard: 'invoke output has error',
            target: 'unequipping',
            actions: 'toast sketch solve error',
          },
          {
            target: 'ready for user click',
            reenter: true,
            actions: 'send result to parent',
          },
        ],
        onError: {
          target: 'unequipping',
          actions: 'toast sketch solve error',
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
