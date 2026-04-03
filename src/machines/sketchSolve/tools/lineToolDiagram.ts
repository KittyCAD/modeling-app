import { assertEvent, assign, fromPromise, setup } from 'xstate'

import type RustContext from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import type {
  SceneGraphDelta,
  SegmentCtor,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { roundOff } from '@src/lib/utils'
import { baseUnitToNumericSuffix } from '@src/lang/wasm'
import type { KclManager } from '@src/lang/KclManager'
import {
  type ToolEvents,
  type ToolContext,
  type TOOL_ID,
  type CONFIRMING_DIMENSIONS,
  animateDraftSegmentListener,
  addPointListener,
  addNextDraftLineListener,
  removePointListener,
  sendResultToParent,
  storePendingSketchOutcome,
  sendStoredResultToParent,
} from '@src/machines/sketchSolve/tools/lineToolImpl'
import type {
  SketchSolveMachineEvent,
  ToolInput,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import {
  isLineSegment,
  isPointSegment,
  pointToCoords2d,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import {
  getConstraintForSnapTarget,
  toApiConstraint,
  type SnapTarget,
} from '@src/machines/sketchSolve/snapping'

// This might seem a bit redundant, but this xstate visualizer stops working
// when TOOL_ID and constants are imported directly
export const toolId: typeof TOOL_ID = 'Line tool'

export const confirmingDimensions: typeof CONFIRMING_DIMENSIONS =
  'Confirming dimensions'

export const machine = setup({
  types: {
    context: {} as ToolContext,
    events: {} as ToolEvents,
    input: {} as ToolInput,
  },
  actions: {
    'animate draft segment listener': animateDraftSegmentListener,
    'add point listener': addPointListener,
    'add next draft line listener': addNextDraftLineListener,
    'remove point listener': removePointListener,
    'send result to parent': assign(sendResultToParent),
  },
  actors: {
    modAndSolveFirstClick: fromPromise(
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
      }): Promise<
        | {
            kclSource: SourceDelta
            sceneGraphDelta: SceneGraphDelta
            newlyAddedEntities?: {
              segmentIds: Array<number>
              constraintIds: Array<number>
            }
          }
        | {
            error: string
          }
      > => {
        const { pointData, snapTarget, rustContext, kclManager, sketchId } =
          input
        const [x, y] = pointData

        const units = baseUnitToNumericSuffix(
          kclManager.fileSettings.defaultLengthUnit
        )

        try {
          // Note: x and y come from intersectionPoint.twoD which is in world coordinates, and scaled to units
          // we're creating a line with the same start and end point initially
          // that's because we'll then 'animate' the line by moving the endpoint with the user's mouse
          const segmentCtor: SegmentCtor = {
            type: 'Line',
            start: {
              x: { type: 'Var', value: roundOff(x), units },
              y: { type: 'Var', value: roundOff(y), units },
            },
            end: {
              x: { type: 'Var', value: roundOff(x), units },
              y: { type: 'Var', value: roundOff(y), units },
            },
          }

          const settings = jsAppSettings(rustContext.settingsActor)
          const result = await rustContext.addSegment(
            0, // version - TODO: Get this from actual context
            sketchId, // sketchId from context
            segmentCtor,
            'line-segment', // label
            settings
          )

          const startPointId = result.sceneGraphDelta.new_objects.find(
            (objId) => {
              const obj = result.sceneGraphDelta.new_graph.objects[objId]
              return isPointSegment(obj)
            }
          )

          if (startPointId === undefined) {
            return {
              error:
                'startPointId should be defined when snapping the first line point.',
            }
          }

          const snapConstraint = getConstraintForSnapTarget(
            startPointId,
            snapTarget,
            units
          )
          if (snapConstraint === null) {
            return result
          }

          const snapResult = await rustContext.addConstraint(
            0,
            sketchId,
            toApiConstraint(snapConstraint),
            settings
          )

          const segmentIds = result.sceneGraphDelta.new_objects.filter(
            (objId) => {
              const obj = result.sceneGraphDelta.new_graph.objects[objId]
              return obj?.kind.type === 'Segment'
            }
          )
          const constraintIds = snapResult.sceneGraphDelta.new_objects.filter(
            (objId) => {
              const obj = snapResult.sceneGraphDelta.new_graph.objects[objId]
              return obj?.kind.type === 'Constraint'
            }
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
            newlyAddedEntities: {
              segmentIds,
              constraintIds,
            },
          }
        } catch (error) {
          console.error('Failed to add point segment:', error)
          return {
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        }
      }
    ),
    modAndSolve: fromPromise(
      async ({
        input,
      }: {
        input: {
          pointData: [number, number]
          id: number
          snapTarget?: SnapTarget
          isDoubleClick?: boolean
          rustContext: RustContext
          kclManager: KclManager
          sketchId: number
        }
      }): Promise<
        | {
            kclSource: SourceDelta
            sceneGraphDelta: SceneGraphDelta
            lastPointId?: number
          }
        | {
            error: string
          }
      > => {
        const {
          pointData,
          id,
          snapTarget,
          isDoubleClick,
          rustContext,
          kclManager,
          sketchId,
        } = input
        const [x, y] = pointData
        const units = baseUnitToNumericSuffix(
          kclManager.fileSettings.defaultLengthUnit
        )
        const settings = jsAppSettings(rustContext.settingsActor)

        try {
          // Note: x and y come from intersectionPoint.unscaledTwoD which is in world coordinates, and always mm
          const segmentCtor: SegmentCtor = {
            type: 'Point',
            position: {
              x: { type: 'Var', value: roundOff(x), units },
              y: { type: 'Var', value: roundOff(y), units },
            },
          }

          // Call the editSegments method to update the point position
          const result = await rustContext.editSegments(
            0, // version - TODO: Get this from actual context
            sketchId, // sketchId from context
            [
              {
                id,
                ctor: segmentCtor,
              },
            ],
            settings
          )

          let latestKclSource = result.kclSource
          let latestSceneGraphDelta = result.sceneGraphDelta
          let snapConstraintNewObjects: Array<number> = []

          const snapConstraint = getConstraintForSnapTarget(
            id,
            snapTarget,
            units
          )
          if (snapConstraint !== null) {
            const snapResult = await rustContext.addConstraint(
              0,
              sketchId,
              toApiConstraint(snapConstraint),
              settings
            )
            latestKclSource = snapResult.kclSource
            latestSceneGraphDelta = snapResult.sceneGraphDelta
            snapConstraintNewObjects = snapResult.sceneGraphDelta.new_objects
          }

          return {
            kclSource: latestKclSource,
            sceneGraphDelta: {
              ...latestSceneGraphDelta,
              new_objects: [
                ...result.sceneGraphDelta.new_objects,
                ...snapConstraintNewObjects,
              ],
            },
            lastPointId:
              snapConstraint === null && isDoubleClick !== true
                ? id
                : undefined,
          }
        } catch (error) {
          console.error('Failed to add point segment:', error)
          return {
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        }
      }
    ),
    startNextDraftLine: fromPromise(
      async ({
        input,
      }: {
        input: {
          lastPointId?: number
          sceneGraphDelta?: SceneGraphDelta
          draftPointData: [number, number]
          rustContext: RustContext
          kclManager: KclManager
          sketchId: number
        }
      }): Promise<
        | {
            kclSource: SourceDelta
            sceneGraphDelta: SceneGraphDelta
            newLineEndPointId?: number
            newlyAddedEntities?: {
              segmentIds: Array<number>
              constraintIds: Array<number>
            }
          }
        | {
            error: string
          }
      > => {
        const {
          lastPointId,
          sceneGraphDelta,
          draftPointData,
          rustContext,
          kclManager,
          sketchId,
        } = input

        if (lastPointId === undefined) {
          return {
            error:
              'lastPointId should be defined when starting the next draft line.',
          }
        }

        const graphPoint = sceneGraphDelta?.new_graph.objects[lastPointId]
        if (!isPointSegment(graphPoint)) {
          return {
            error:
              'lastPointId should resolve to a point segment when starting the next draft line.',
          }
        }

        const [startX, startY] = pointToCoords2d(graphPoint)
        const [endX, endY] = draftPointData
        const units = baseUnitToNumericSuffix(
          kclManager.fileSettings.defaultLengthUnit
        )
        const settings = jsAppSettings(rustContext.settingsActor)

        try {
          const newLineCtor: SegmentCtor = {
            type: 'Line',
            start: {
              x: { type: 'Var', value: roundOff(startX), units },
              y: { type: 'Var', value: roundOff(startY), units },
            },
            end: {
              x: { type: 'Var', value: roundOff(endX), units },
              y: { type: 'Var', value: roundOff(endY), units },
            },
          }

          const chainResult = await rustContext.chainSegment(
            0,
            sketchId,
            lastPointId,
            newLineCtor,
            'line-segment',
            settings
          )

          const newLine = chainResult.sceneGraphDelta.new_objects.find(
            (objId) => {
              const obj = chainResult.sceneGraphDelta.new_graph.objects[objId]
              return isLineSegment(obj)
            }
          )

          let newLineEndPointId: number | undefined
          if (newLine !== undefined) {
            const lineObj =
              chainResult.sceneGraphDelta.new_graph.objects[newLine]
            if (isLineSegment(lineObj)) {
              newLineEndPointId = lineObj.kind.segment.end
            }
          }

          const constraintId = chainResult.sceneGraphDelta.new_objects.find(
            (objId) => {
              const obj = chainResult.sceneGraphDelta.new_graph.objects[objId]
              return obj?.kind.type === 'Constraint'
            }
          )

          const newlyAddedEntities: {
            segmentIds: Array<number>
            constraintIds: Array<number>
          } = {
            segmentIds: [],
            constraintIds: [],
          }

          if (newLine !== undefined) {
            newlyAddedEntities.segmentIds.push(newLine)
          }
          if (constraintId !== undefined) {
            newlyAddedEntities.constraintIds.push(constraintId)
          }

          return {
            kclSource: chainResult.kclSource,
            sceneGraphDelta: chainResult.sceneGraphDelta,
            newLineEndPointId,
            newlyAddedEntities,
          }
        } catch (error) {
          console.error('Failed to start next draft line:', error)
          return {
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        }
      }
    ),
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QBkCWA7MACALgezwBsBiAV0wEdTUAHAbQAYBdRUGvWVHVPdVkAB6IAjABYArAwB0AdmHzx44QE4AHADYATOvUAaEAE9EAWgDMm5VI0N1o0euUNVo8wF9X+tJlwESpGhAAhjjYsGCEYADG3LyMLEgg7JwxfAlCCMKmqpqyDE4uLjpyovpGCMbqpuJS4lqaMjKqGva17p4Y2PhEUgBOYIEQBlgAZng9WKRh45GEqJEA1sQDEFjsGDhx-ElcPKmg6cYW1ZoMWS7iotbCMuKliA1WpqfCki+qDC7KbSBenb69-UGIzGEymWBmc0WcEigRoYE2CW2KX46U01xqcgsMgY4my2lxd3KVRkUkqOnqjXJWnU31+Pm6AGFeMNUD0ALYYKBYCCoNlgdCcXiwYgQXhgKQYABueHm4rpXUIUiZ6BZ7M53N5-MFAoQUrwMJScQRbA4O14KMQ6kyUmutnsmlMVvUDGEhMO2ik2muFjR6my6nEtI69MVytVHPQXJ5fIFu2FYB6PTGUhohGCo3ZUnl-zDrIjUc1saFuvQ0oNuyNzC2puRaREKlEpLsphkOkkTwcbpeJNMvatogYmnErbRpiD3gVSuZefV0a1ceIYRwq35PMj3LwpAARhFwbMFsbEjXdhaEGppDJ7MINCoG9pCVorDdxBZlMOmqYVOO-t1IgALKJ5g3bddwhBZiEPJETzrDJNByZRnWdUQHVEYRnXvQwTGEQdZFUYQLF7BhlAsJoaQ8H5g0nf9AOAndsDAxY6GEeITWSaD9nrHsHQQ0RlFQ2o8OUN1cU9QdHVOYdGnER0yPaCd-ggcIwBCLBMAAd0IIZlkgLB+W4bg4BFMUJVLGU5UohSlJU9TNKwbSVj0nY4BLMtggrZhIOPc0YOMRRGyeAcqhfHR3hkQkTlMKQsh0MQNFxWwqm-EMpEUiJrLADStIgRSHPQfTUEMhMkx6FM0xwDM2SzCzulS5TsBsrKct0vKnNgFz9Tc2IPKrREvL2QQsIYEltEvYdrytJ4hsJKpIpigMniCgNA3I7NugAQWy9U1jyozMBM6VZSq+T1s29dtpwdryy6phPLY7yOIya8bQDN8huI7JkM0Ql5BJOx-ROIc7BdJLJw2tcuXO4giuTVN0zGSrVsVMGtrwdZLs69BKxYo87v6g5zH8uKrXEYirzdGRIuUN91FbIiaZOVsQf+ABlP88DUgARHpAmGHBfiWbLVlRvLbrNPH7guT0ZG46SXUULJCUsBbKnPBDsJcJnulZ9muZ5vmOkXZSV3QcHaNA-d5lF2sHoHao7EkWw0LOPjbkw8p8NUKQ8kpPtLgcCRNcVbXOe53n+fIMAqFoK32IGhAXEiy8nDkbIgs-PQ3bQ6RNHOSoWmUaXRBkQOpGD3Ww4N6FYXhHrWLF084JyGxbGll0bBbMK3aHdQopeexLmcWxNBL2qVIgUPl0cgzYCwXgJkoagaF28U9UOxGUqs7Bx715r8rgWf0HnyPF-Rw1uuxqD7rjlPSVHYmpNUYdpoHKwBNMVC0Ok64xxW6rFVHreE9d6tQPkfKOS9RR7VXuZY6-9N7ciAVPAqM854R3AafdyN1mLVlxqeeQOcpDKGinYQG9Qppu3ftIR+fp7CqEvGoLIP85I-jgWlQBO8kH71QQvWgUNEwwzKhVI6LCN5sIQRwlq09QFoJPnqK6mNz44PrjBbC+EpC8XkHhGw0tPyqEJPYHuJMWxqBithJQy1mHJQAeI3mwCpHcOPrw6GJVYblXhsIqx8Dt62M4Sgw+MjaAYOukxC+fU8GmAQlFcwWgiGXiaKcfROgaixJMVaMxLx3DkXQHgRS8AEiIyUdbOOFQcIBQksFP05CyjGEuJYMkTorREWltcEufQBhDAzKCBMe5ISFNjgcC41QPjXEyKoF2eJCSS0Ik8fB1xpKNBLrmNU645xFgFH0q+6Q3yWFqbxZQmRJASFdG7Yw15pAOApjnOJlx7Yl2ogsM29ELYbPFggXs1Rpa4mofIRwVy3RomkFTAuTxiJ8WdFkEe8CGp2WyjpXxLzTzGEflE-2fEXSOE-OFCwNRDkIRbLbZ0qgS4BJoDQTkCKVGoRyBoNQhQXwRMuF2AupJgXXFUCC6SagS7IzOsLHAFKHqnN4l7NCKsnB5BbHot2UyFq0xcJkbRJcy4T1+AKuOvZGzsokGivimQ0TfUih8WoQ5cS9izjTSFYjvGT0kcg6RPCaBqvSNiHujQZDET9O+Qc30aY1GwtkZwFxeJPGLpkoAA */
  context: ({ input }): ToolContext => ({
    draftPointId: undefined,
    pendingSketchOutcome: undefined,
    deleteFromEscape: undefined,
    sceneInfra: input.sceneInfra,
    rustContext: input.rustContext,
    kclManager: input.kclManager,
    sketchId: input.sketchId || 0,
  }),
  id: toolId,
  initial: 'ready for user click',
  on: {
    unequip: {
      // target: `#${TOOL_ID}.unequipping`, // using TOOL_ID breaks the xstate visualizer
      target: `#Line tool.unequipping`,
      description:
        "can be requested from the outside, but we want this tool to have the final say on when it's done.",
    },
  },
  description: 'Creates a point',
  states: {
    'ready for user click': {
      entry: 'add point listener',

      on: {
        'add point': 'Adding point',
        escape: {
          target: 'unequipping',
          description: 'ESC in ready state unequips the tool',
        },
      },
    },

    [confirmingDimensions]: {
      invoke: {
        input: ({ event, context }) => {
          assertEvent(event, 'add point')
          return {
            pointData: event.data,
            id: event.id || 0,
            snapTarget: event.snapTarget,
            isDoubleClick: event.isDoubleClick,
            rustContext: context.rustContext,
            kclManager: context.kclManager,
            sketchId: context.sketchId,
          }
        },

        onDone: {
          target: 'check whether to stop drawing',
          actions: [
            assign(({ event }) => storePendingSketchOutcome({ event })),
          ],
        },
        onError: {
          target: 'unequipping',
        },
        src: 'modAndSolve',
      },
    },
    'check whether to stop drawing': {
      always: [
        {
          guard: ({ context }) =>
            context.pendingSketchOutcome?.lastPointId === undefined,
          target: 'ready for user click',
          actions: [
            sendStoredResultToParent,
            assign({
              draftPointId: undefined,
              pendingSketchOutcome: undefined,
            }),
          ],
        },
        {
          target: 'waiting to start next draft line',
          actions: [
            sendStoredResultToParent,
            assign({
              draftPointId: undefined,
            }),
          ],
        },
      ],
    },

    'waiting to start next draft line': {
      entry: 'add next draft line listener',
      exit: 'remove point listener',
      on: {
        'finish line chain': {
          target: 'ready for user click',
          actions: assign({
            pendingSketchOutcome: undefined,
          }),
        },
        'start next draft line': 'Starting next draft line',
        escape: {
          target: 'ready for user click',
          actions: assign({
            pendingSketchOutcome: undefined,
          }),
        },
      },
    },

    'Starting next draft line': {
      invoke: {
        src: 'startNextDraftLine',
        input: ({ event, context }) => {
          assertEvent(event, 'start next draft line')
          return {
            lastPointId: context.pendingSketchOutcome?.lastPointId,
            sceneGraphDelta: context.pendingSketchOutcome?.sceneGraphDelta,
            draftPointData: event.data,
            rustContext: context.rustContext,
            kclManager: context.kclManager,
            sketchId: context.sketchId,
          }
        },
        onDone: {
          target: 'ShowDraftLine',
          actions: [
            'send result to parent',
            assign({
              pendingSketchOutcome: undefined,
            }),
          ],
        },
        onError: {
          target: 'ready for user click',
          actions: assign({
            pendingSketchOutcome: undefined,
          }),
        },
      },
    },

    unequipping: {
      type: 'final',
      entry: [
        'remove point listener',
        ({ self }) => {
          const sendData: SketchSolveMachineEvent = {
            type: 'clear draft entities',
          }
          self._parent?.send(sendData)
        },
      ],
      description: 'Any teardown logic should go here.',
    },

    'Adding point': {
      invoke: {
        src: 'modAndSolveFirstClick',
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
        onDone: {
          target: 'ShowDraftLine',
          actions: 'send result to parent',
        },
        onError: 'ready for user click',
      },
    },

    ShowDraftLine: {
      on: {
        'add point': 'Confirming dimensions',
        unequip: {
          target: 'delete draft entities on unequip',
          actions: assign({
            deleteFromEscape: false, // Mark as unequip, not escape
          }),
        },
        escape: {
          target: 'delete draft entities on unequip',
          actions: assign({
            deleteFromEscape: true, // Mark as escape so we return to ready state
          }),
          description:
            'ESC in ShowDraftLine deletes draft segment and returns to ready state',
        },
      },

      entry: 'animate draft segment listener',
      exit: 'remove point listener', // Stop the onMove listener when leaving this state
    },
    'delete draft entities on unequip': {
      entry: ({ self }) => {
        const sendData: SketchSolveMachineEvent = {
          type: 'delete draft entities',
        }
        self._parent?.send(sendData)
      },
      always: [
        {
          // If this was triggered by escape (not unequip), go back to ready state
          guard: ({ context }) => context.deleteFromEscape === true,
          target: 'ready for user click',
          actions: [
            assign({
              draftPointId: undefined, // Clear draftPointId so onMove won't try to edit deleted segment
              deleteFromEscape: undefined, // Clear flag
            }),
          ],
        },
        {
          // Default: unequip (for actual unequip events)
          target: 'unequipping',
          actions: [
            assign({
              draftPointId: undefined, // Clear draftPointId so onMove won't try to edit deleted segment
              deleteFromEscape: undefined, // Clear flag
            }),
          ],
        },
      ],
    },
  },
})
