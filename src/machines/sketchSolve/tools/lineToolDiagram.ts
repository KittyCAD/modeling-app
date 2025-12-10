import { assertEvent, assign, fromPromise, setup } from 'xstate'

import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
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
  removePointListener,
  sendResultToParent,
  storePendingSketchOutcome,
  sendStoredResultToParent,
} from '@src/machines/sketchSolve/tools/lineToolImpl'

// This might seem a bit redundant, but this xstate visualizer stops working
// when I use TOOL_ID and CONFIRMING_DIMENSIONS directly when they're imported.
export const toolId: typeof TOOL_ID = 'Line tool'
export const confirmingDimensions: typeof CONFIRMING_DIMENSIONS =
  'Confirming dimensions'

export const machine = setup({
  types: {
    context: {} as ToolContext,
    events: {} as ToolEvents,
    input: {} as {
      sceneInfra: SceneInfra
      rustContext: RustContext
      kclManager: KclManager
      sketchId: number
      sceneGraphDelta?: SceneGraphDelta
    },
  },
  actions: {
    'animate draft segment listener': animateDraftSegmentListener,
    'add point listener': addPointListener,
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
          rustContext: RustContext
          kclManager: KclManager
          sketchId: number
        }
      }) => {
        const { pointData, rustContext, kclManager, sketchId } = input
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

          // Call the addSegment method using the rustContext from context
          const result = await rustContext.addSegment(
            0, // version - TODO: Get this from actual context
            sketchId, // sketchId from context
            segmentCtor,
            'line-segment', // label
            await jsAppSettings()
          )

          return result
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
          isDoubleClick: boolean
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
          pointData,
          id,
          isDoubleClick,
          rustContext,
          kclManager,
          sketchId,
        } = input
        const [x, y] = pointData
        const units = baseUnitToNumericSuffix(
          kclManager.fileSettings.defaultLengthUnit
        )

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
            await jsAppSettings()
          )

          // After updating the point, create a new line segment chained from it (unless double-click)
          // The updated point (id) becomes the start of the new line segment
          if (!isDoubleClick) {
            const newLineCtor: SegmentCtor = {
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

            // Add the new line segment
            const lineResult = await rustContext.addSegment(
              0,
              sketchId,
              newLineCtor,
              'line-segment',
              await jsAppSettings()
            )

            // Extract point IDs from the new line segment
            // new_objects contains [startPointId, endPointId, lineId]
            const newLinePointIds =
              lineResult.sceneGraphDelta.new_objects.filter((objId) => {
                const obj = lineResult.sceneGraphDelta.new_graph.objects[objId]
                return (
                  obj?.kind.type === 'Segment' &&
                  obj.kind.segment.type === 'Point'
                )
              })
            const newLine = lineResult.sceneGraphDelta.new_objects.find(
              (objId) => {
                const obj = lineResult.sceneGraphDelta.new_graph.objects[objId]
                return (
                  obj?.kind.type === 'Segment' &&
                  obj.kind.segment.type === 'Line'
                )
              }
            )

            const newLineStartPointId = newLinePointIds[0]
            const newLineEndPointId = newLinePointIds[1]

            // Track newly created entities that might need to be deleted on double-click
            const newlyAddedEntities: {
              segmentIds: Array<number>
              constraintIds: Array<number>
            } = {
              segmentIds: [],
              constraintIds: [],
            }

            // Add the new line segment ID to tracking
            if (newLine !== undefined) {
              newlyAddedEntities.segmentIds.push(newLine)
            }

            // Make the previous line's end point (id) coincident with the new line's start point
            if (newLineStartPointId !== undefined) {
              const constraintResult = await rustContext.addConstraint(
                0,
                sketchId,
                {
                  type: 'Coincident',
                  points: [id, newLineStartPointId],
                },
                await jsAppSettings()
              )

              if (constraintResult) {
                // Find the constraint ID from the new objects
                // objects array is indexed by ObjectId, so we can access directly
                const constraintId =
                  constraintResult.sceneGraphDelta.new_objects.find((objId) => {
                    const obj =
                      constraintResult.sceneGraphDelta.new_graph.objects[objId]
                    return obj?.kind.type === 'Constraint'
                  })

                if (constraintId !== undefined) {
                  newlyAddedEntities.constraintIds.push(constraintId)
                }

                // Merge all results: point update + new line + constraint
                return {
                  kclSource: constraintResult.kclSource,
                  sceneGraphDelta: {
                    ...constraintResult.sceneGraphDelta,
                    new_objects: [
                      ...result.sceneGraphDelta.new_objects,
                      ...lineResult.sceneGraphDelta.new_objects,
                      ...constraintResult.sceneGraphDelta.new_objects,
                    ],
                  },
                  newLineEndPointId, // Return the new line's end point ID for context update
                  newlyAddedEntities, // Track entities that might need deletion
                }
              }
            }

            // If constraint failed, still return the line result
            return {
              kclSource: lineResult.kclSource,
              sceneGraphDelta: {
                ...lineResult.sceneGraphDelta,
                new_objects: [
                  ...result.sceneGraphDelta.new_objects,
                  ...lineResult.sceneGraphDelta.new_objects,
                ],
              },
              newLineEndPointId, // Return the new line's end point ID for context update
              newlyAddedEntities, // Track entities that might need deletion
            }
          }

          // On double-click, just return the point update result without chaining
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
  /** @xstate-layout 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-2fEXSOE-OFCwNRDkIRbLbZ0qgS4BJoDQTkCKVGoRyBoNQhQXwRMuF2AupJgXXFUCC6SagS7IzOsLHAFKHqnN4l7NCKsnB5BbHot2UyFq0xcJkbRJcy4T1+AKuOvZGzsokGivimQ0TfUih8WoQ5cS9izjTSFYjvGT0kcg6RPCaBqvSNiHujQZDET9O+Qc30aY1GwtkZwFxeJPGLpkoAA */
  context: ({ input }): ToolContext => ({
    draftPointId: undefined,
    lastLineEndPointId: undefined,
    isDoubleClick: undefined,
    pendingDoubleClick: undefined,
    pendingSketchOutcome: undefined,
    deleteFromEscape: undefined,
    sceneGraphDelta: {} as SceneGraphDelta,
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
      entry: assign(({ event }) => {
        // Set pendingDoubleClick flag if this event is a double-click
        // This flag will cause any pending results to be deleted instead of sent
        if (event.type === 'add point' && event.isDoubleClick) {
          return { pendingDoubleClick: true }
        }
        return {}
      }),
      on: {
        // Handle the flag-setting event even while modAndSolve is running
        // This is critical: when the second click (detail=2) arrives while the first click's
        // modAndSolve is still running, we set the flag here, and then when modAndSolve
        // completes, it will see the flag and delete instead of send
        'set pending double click': {
          actions: assign({
            pendingDoubleClick: true,
          }),
        },
      },
      invoke: {
        input: ({ event, context }) => {
          assertEvent(event, 'add point')
          return {
            pointData: event.data,
            id: event.id || 0,
            isDoubleClick: event.isDoubleClick || false,
            rustContext: context.rustContext,
            kclManager: context.kclManager,
            sketchId: context.sketchId,
          }
        },

        onDone: {
          target: 'check double click',
          actions: [
            assign(({ event, self }) =>
              storePendingSketchOutcome({ event, self })
            ),
          ],
        },
        onError: {
          target: 'unequipping',
        },
        src: 'modAndSolve',
      },
    },
    'check double click': {
      always: [
        {
          guard: ({ context }) => context.pendingDoubleClick === true,
          target: 'delete newly added entities',
        },
        {
          target: 'ShowDraftLine',
          actions: [
            sendStoredResultToParent,
            assign({
              pendingDoubleClick: undefined, // Clear the flag AFTER checking
              pendingSketchOutcome: undefined, // Clear after sending
            }),
            'send result to parent', // Update context with draftPointId
          ],
        },
      ],
    },
    'delete newly added entities': {
      entry: ({ self }) => {
        // Request parent to delete draft entities
        self._parent?.send({ type: 'delete draft entities' })
      },
      always: {
        target: 'ready for user click',
        actions: [
          assign({
            pendingDoubleClick: undefined, // Clear the flag
            lastLineEndPointId: undefined, // Clear on double-click to stop chaining
            pendingSketchOutcome: undefined, // Clear stored result
          }),
        ],
      },
    },

    unequipping: {
      type: 'final',
      entry: [
        'remove point listener',
        ({ self }) => {
          // Clear draft entities when unequipping normally
          self._parent?.send({ type: 'clear draft entities' })
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
        'set pending double click': {
          // Set flag immediately - this will cause any pending modAndSolve results to be deleted
          actions: assign({
            pendingDoubleClick: true,
          }),
        },
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
        // Request parent to delete draft entities
        self._parent?.send({ type: 'delete draft entities' })
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
