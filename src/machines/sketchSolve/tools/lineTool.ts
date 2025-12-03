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

const TOOL_ID = 'Line tool'
const CONFIRMING_DIMENSIONS = 'Confirming dimensions'
const ADDING_POINT = `xstate.done.actor.0.${TOOL_ID}.Adding point`
const CONFIRMING_DIMENSIONS_EVENT = `xstate.done.actor.0.${TOOL_ID}.${CONFIRMING_DIMENSIONS}`

type ToolEvents =
  | { type: 'unequip' }
  | {
      type: 'add point'
      data: [x: number, y: number]
      id?: number
      isDoubleClick?: boolean
    }
  | { type: 'update selection' }
  | { type: 'set pending double click' }
  | {
      type: typeof ADDING_POINT | typeof CONFIRMING_DIMENSIONS_EVENT
      output: {
        kclSource: SourceDelta
        sceneGraphDelta: SceneGraphDelta
      }
    }

type ToolContext = {
  draftPointId?: number
  lastLineEndPointId?: number
  isDoubleClick?: boolean
  pendingDoubleClick?: boolean
  newlyAddedSketchEntities?: {
    segmentIds: Array<number>
    constraintIds: Array<number>
  }
  pendingSketchOutcome?: {
    kclSource: SourceDelta
    sceneGraphDelta: SceneGraphDelta
  }
  sceneGraphDelta: SceneGraphDelta
  sceneInfra: SceneInfra
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
}

export const machine = setup({
  types: {
    context: {} as ToolContext,
    events: {} as ToolEvents,
    input: {} as {
      sceneInfra: SceneInfra
      rustContext: RustContext
      kclManager: KclManager
      sketchId: number
    },
  },
  actions: {
    'animate draft segment listener': ({ self, context }) => {
      let isEditInProgress = false
      context.sceneInfra.setCallbacks({
        onMove: async (args) => {
          if (!args || !context.draftPointId) return
          const twoD = args.intersectionPoint?.twoD
          if (twoD && !isEditInProgress) {
            // Send the add point event with the clicked coordinates

            const units = baseUnitToNumericSuffix(
              context.kclManager.fileSettings.defaultLengthUnit
            )
            try {
              isEditInProgress = true
              const settings = await jsAppSettings()
              // Note: twoD comes from intersectionPoint.unscaledTwoD which is in world coordinates, and always mm
              const result = await context.rustContext.editSegments(
                0,
                context.sketchId,
                [
                  {
                    id: context.draftPointId,
                    ctor: {
                      type: 'Point',
                      position: {
                        x: {
                          type: 'Var',
                          value: roundOff(twoD.x),
                          units,
                        },
                        y: {
                          type: 'Var',
                          value: roundOff(twoD.y),
                          units,
                        },
                      },
                    },
                  },
                ],
                settings
              )
              self._parent?.send({
                type: 'update sketch outcome',
                data: result,
              })
            } catch (err) {
              console.error('failed to edit segment', err)
            } finally {
              isEditInProgress = false
            }
          }
        },
        onClick: async (args) => {
          if (!args || !context.draftPointId) return
          const twoD = args.intersectionPoint?.twoD
          if (twoD) {
            const isDoubleClick = args.mouseEvent.detail === 2
            // Set pending double-click flag immediately if detected
            if (isDoubleClick) {
              self.send({
                type: 'set pending double click',
              })
            }
            self.send({
              type: 'add point',
              data: [twoD.x, twoD.y],
              id: context.draftPointId,
              isDoubleClick,
            })
          }
        },
      })
    },
    'add point listener': ({ self, context }) => {
      context.sceneInfra.setCallbacks({
        onClick: (args) => {
          if (!args) return
          if (args.mouseEvent.which !== 1) return // Only left click

          const twoD = args.intersectionPoint?.twoD
          if (twoD) {
            const isDoubleClick = args.mouseEvent.detail === 2
            // If it's a double-click, set the flag immediately BEFORE sending the event
            // This ensures any pending operations from the first click will be cancelled
            if (isDoubleClick) {
              // Send the flag-setting event first, synchronously
              self.send({ type: 'set pending double click' })
            }
            // Send the add point event with the clicked coordinates
            self.send({
              type: 'add point',
              data: [twoD.x, twoD.y],
              isDoubleClick,
            })
          }
        },
        onMove: () => {},
      })
    },
    'show draft geometry': () => {
      // Add your action code here
      // ...
    },
    'remove point listener': ({ context }) => {
      // Reset callbacks to remove the onClick listener
      context.sceneInfra.setCallbacks({
        onClick: () => {},
      })
    },
    'send result to parent': assign(({ event, self }) => {
      if (
        event.type !== ADDING_POINT &&
        event.type !== CONFIRMING_DIMENSIONS_EVENT
      ) {
        // Handle delete result or other events
        if ('output' in event && event.output) {
          const output = event.output as {
            kclSource?: SourceDelta
            sceneGraphDelta?: SceneGraphDelta
            error?: string
          }

          if (output.error) {
            return {}
          }

          // Send result to parent if we have valid data
          if (output.kclSource && output.sceneGraphDelta) {
            self._parent?.send({
              type: 'update sketch outcome',
              data: {
                kclSource: output.kclSource,
                sceneGraphDelta: output.sceneGraphDelta,
              },
            })
          }
        }
        return {}
      }

      // Check if the output has a newLineEndPointId (from modAndSolve when chaining)
      const output = event.output as {
        kclSource?: SourceDelta
        sceneGraphDelta?: SceneGraphDelta
        newLineEndPointId?: number
        error?: string
      }

      // If there's an error, don't update context
      if (output.error) {
        return {}
      }

      // Don't send result to parent here - we'll send it after checking double-click flag
      // This prevents editor flicker by only updating once we know if we're keeping or deleting

      // If we have a newLineEndPointId from chaining, use that as the draftPointId
      if (output.newLineEndPointId !== undefined) {
        // Find the line segment to get its end point ID for tracking
        const lineId = [...output.sceneGraphDelta!.new_objects]
          .reverse()
          .find((objId) => {
            const obj = output.sceneGraphDelta!.new_graph.objects.find(
              (o) => o.id === objId
            )
            if (!obj) return false
            return (
              obj.kind.type === 'Segment' && obj.kind.segment.type === 'Line'
            )
          })

        let lastLineEndPointId: number | undefined
        if (lineId !== undefined) {
          const lineObj = output.sceneGraphDelta!.new_graph.objects.find(
            (o) => o.id === lineId
          )
          if (
            lineObj?.kind.type === 'Segment' &&
            lineObj.kind.segment.type === 'Line'
          ) {
            // The end point ID is stored in the Line segment
            lastLineEndPointId = lineObj.kind.segment.end
          }
        }
        return {
          draftPointId: output.newLineEndPointId,
          lastLineEndPointId,
          sceneGraphDelta: output.sceneGraphDelta,
        }
      }

      // For the first point creation, find the point ID normally
      const pointIds =
        output.sceneGraphDelta?.new_objects.filter((objId) => {
          const obj = output.sceneGraphDelta!.new_graph.objects.find(
            (o) => o.id === objId
          )
          if (!obj) return false
          return (
            obj.kind.type === 'Segment' && obj.kind.segment.type === 'Point'
          )
        }) || []

      // The last point ID is the end point of the newly created line
      const pointId = pointIds[pointIds.length - 1]

      // Find the line segment to get its end point ID
      const lineId = [...(output.sceneGraphDelta?.new_objects || [])]
        .reverse()
        .find((objId) => {
          const obj = output.sceneGraphDelta!.new_graph.objects.find(
            (o) => o.id === objId
          )
          if (!obj) return false
          return obj.kind.type === 'Segment' && obj.kind.segment.type === 'Line'
        })

      let lastLineEndPointId: number | undefined
      if (lineId !== undefined && output.sceneGraphDelta) {
        const lineObj = output.sceneGraphDelta.new_graph.objects.find(
          (o) => o.id === lineId
        )
        if (
          lineObj?.kind.type === 'Segment' &&
          lineObj.kind.segment.type === 'Line'
        ) {
          // The end point ID is stored in the Line segment
          lastLineEndPointId = lineObj.kind.segment.end
        }
      }

      if (pointId !== undefined && output.sceneGraphDelta) {
        return {
          draftPointId: pointId,
          lastLineEndPointId,
          sceneGraphDelta: output.sceneGraphDelta,
        }
      }
      return {}
    }),
  },
  actors: {
    modAndSolveFirstPoint: fromPromise(
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
    deleteNewlyAddedEntities: fromPromise(
      async ({
        input,
      }: {
        input: {
          sketchId: number
          segmentIds: Array<number>
          constraintIds: Array<number>
          rustContext: RustContext
        }
      }) => {
        const { sketchId, segmentIds, constraintIds, rustContext } = input

        // Delete the newly created entities
        const deleteResult = await rustContext.deleteObjects(
          0,
          sketchId,
          constraintIds,
          segmentIds,
          await jsAppSettings()
        )

        return deleteResult
      }
    ),
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QBkCWA7MACALgezwBsBiAV0wEdTUAHAbQAYBdRUGvWVHVPdVkAB6IAjAGZhDAHQMATKJkA2ABwAWAJzyA7EoCsAGhABPRAFo1mycqUMdylZoYqVDTQF9XBtJlwESpGhAAhjjYsGCEYADG3LyMLEgg7JwxfAlCCMJiUsoKKjIM5sIKDKoGxggmoipKksJO+TI6ojqaOsJqCu6eGNj4RJIATmCBEIZYAGZ4A1ikYdORhKiRANbEIxBY7Bg4cfxJXDypoOkmMmo6kvmiqs3VxcKtZYiaFkqiDOI6DMI61iqiai6IC8vV8kgAwrxxqgBgBbDBQLAQVCwsDoTi8WDECC8MCSDAANzwyzxIJ8-Uh6GhcIRSJRaIx6IQhLwkWChziuwS+xS-HSCjEtU0uRUCjkAvuTwqMkUlwFmjOMiKSkUOiBZL6hAhUJh8PQiORqPRhyxOMw+PQRJJkg1YMp1L1BvpxsxzMtrPZsWYdGE8TYHAOvD5iHkCmkb2c5zqYvFUtOssUD2aYvONiU6p65K19t1tMNDJNxDAAwGU0kNEIwUmcJtmc12qpuf1dKNjNgbqJbJSnOYewDvLSImEShqmRV7wUOlF5n0RhEUmsogU10TY7Fwgz3nrAEEIMjm1t0DhsbiLVbSXWwbv94jDzgOx7u97e9z+4dgxlqpY1DJNPZ-n+DjCFKuSSLY7QqjK7zvD+m6gv0160neRYlmWFZVlMsK1luV57kheDbA+XYcs+fqJG+QaDhU8gqJI1yTgKOg-qKwFzhUmiiJIajnAowoFLx+TCnBWaSAAygAFngADuAAiAyBOMOAgmse6bARR5cv6yTvlRLwWDI1Q2GoLjLiodQgZxDACtxBkfAK+Tph4wKXv0EnSXJClKT0KkbHePpkTyOnHM8mhqJIdzvCOSh1GIShxmFchqMOnyTvIPwbkC6B4BAcD8LaRB9tplHBRUTGWWZmixWoKi-DKcZLmGGg6HIorqCqGgqMJ9ZDCMYzVjMcxYAsSzLIVgZHIIphThcjgPFVNWQVKU50dB3zCEqrSiNoXV2jqNLNvmLromNA4lecYXVNV3FiF8NWseUpxVFxzS2U4k7Vc1O39OQYBULQNAIidQWTRkS6vExSoGSqvGaFK8iXHNS5ODR3xqk5+VaohB7qTgQPFSDJh1GF3wKMuxnWB82hLbRojQXx-xZLxX1am5snyYpIJ4xN6R5Bc622HkjQKNxAIKNTK0fFktNqEooXNO47hAA */
  context: ({ input }): ToolContext => ({
    draftPointId: undefined,
    lastLineEndPointId: undefined,
    isDoubleClick: undefined,
    pendingDoubleClick: undefined,
    newlyAddedSketchEntities: undefined,
    pendingSketchOutcome: undefined,
    sceneGraphDelta: {} as SceneGraphDelta,
    sceneInfra: input.sceneInfra,
    rustContext: input.rustContext,
    kclManager: input.kclManager,
    sketchId: input.sketchId || 0,
  }),
  id: TOOL_ID,
  initial: 'ready for user click',
  on: {
    unequip: {
      // target: `#${TOOL_ID}.unequipping`, // using TOOL_ID breaks the xstate visualizer
      target: `#Line tool.unequipping`,
      description:
        "can be requested from the outside, but we want this tool to have the final say on when it's done.",
    },
    'update selection': {
      description: 'Handle selection updates from the sketch solve machine.',
    },
  },
  description: 'Creates a point',
  states: {
    'ready for user click': {
      entry: 'add point listener',

      on: {
        'add point': 'Adding point',
      },
    },

    [CONFIRMING_DIMENSIONS]: {
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
            assign(({ event }) => {
              const output = event.output as {
                kclSource?: SourceDelta
                sceneGraphDelta?: SceneGraphDelta
                newLineEndPointId?: number
                newlyAddedEntities?: {
                  segmentIds: Array<number>
                  constraintIds: Array<number>
                }
                error?: string
              }

              const result: Partial<ToolContext> = {}

              if (output.newlyAddedEntities) {
                result.newlyAddedSketchEntities = output.newlyAddedEntities
              }

              // Store the result, but DON'T send it yet - we'll check the flag in 'check double click' state
              // The key insight: if pendingDoubleClick is already true (set by the second click),
              // we should delete this result instead of sending it
              if (output.kclSource && output.sceneGraphDelta && !output.error) {
                result.pendingSketchOutcome = {
                  kclSource: output.kclSource,
                  sceneGraphDelta: output.sceneGraphDelta,
                }
              }

              return result
            }),
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
            ({ context, self }) => {
              // Send the stored result to parent (with new entities)
              // Note: We only reach this action if pendingDoubleClick is false (the guard above routes
              // double-clicks to the delete path). The debounceEditorUpdate flag allows the parent to
              // cancel this update if a subsequent double-click is detected within the debounce window.
              if (context.pendingSketchOutcome) {
                self._parent?.send({
                  type: 'update sketch outcome',
                  data: {
                    ...context.pendingSketchOutcome,
                    debounceEditorUpdate: true, // Debounce to allow cancellation if double-click is detected
                  },
                })
              }
              return {}
            },
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
      invoke: {
        src: 'deleteNewlyAddedEntities',
        input: ({ context }) => {
          const entities = context.newlyAddedSketchEntities || {
            segmentIds: [],
            constraintIds: [],
          }
          return {
            sketchId: context.sketchId,
            segmentIds: entities.segmentIds,
            constraintIds: entities.constraintIds,
            rustContext: context.rustContext,
          }
        },
        onDone: {
          target: 'ready for user click',
          actions: [
            assign({
              pendingDoubleClick: undefined, // Clear the flag
              newlyAddedSketchEntities: undefined, // Clear tracking
              lastLineEndPointId: undefined, // Clear on double-click to stop chaining
              pendingSketchOutcome: undefined, // Clear stored result
            }),
            ({ event, self }) => {
              // Send the delete result to parent (this removes the entities)
              if ('output' in event && event.output) {
                const output = event.output as {
                  kclSource?: SourceDelta
                  sceneGraphDelta?: SceneGraphDelta
                }
                if (output.kclSource && output.sceneGraphDelta) {
                  self._parent?.send({
                    type: 'update sketch outcome',
                    data: {
                      kclSource: output.kclSource,
                      sceneGraphDelta: output.sceneGraphDelta,
                      debounceEditorUpdate: true, // Debounce to allow cancellation if needed
                    },
                  })
                }
              }
              return {}
            },
          ],
        },
        onError: {
          target: 'ready for user click',
          actions: [
            assign({
              pendingDoubleClick: undefined,
              newlyAddedSketchEntities: undefined,
            }),
          ],
        },
      },
    },

    unequipping: {
      type: 'final',
      entry: 'remove point listener',
      description: 'Any teardown logic should go here.',
    },

    'Adding point': {
      invoke: {
        src: 'modAndSolveFirstPoint',
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
      },

      entry: 'animate draft segment listener',
    },
  },
})
