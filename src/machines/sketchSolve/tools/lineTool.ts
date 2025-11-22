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
import type { KclManager } from '@src/lang/KclSingleton'

const TOOL_ID = 'Line tool'
const CONFIRMING_DIMENSIONS = 'Confirming dimensions'
const ADDING_POINT = `xstate.done.actor.0.${TOOL_ID}.Adding point`

type ToolEvents =
  | { type: 'unequip' }
  | { type: 'add point'; data: [x: number, y: number]; id?: number }
  | { type: 'update selection' }
  | {
      type: `xstate.done.actor.0.${typeof TOOL_ID}.Adding point`
      output: {
        kclSource: SourceDelta
        sceneGraphDelta: SceneGraphDelta
      }
    }

type ToolContext = {
  draftPointId?: number
  sceneGraphDelta: SceneGraphDelta
  sceneInfra: SceneInfra
  rustContext: RustContext
  kclManager: KclManager
}

export const machine = setup({
  types: {
    context: {} as ToolContext,
    events: {} as ToolEvents,
    input: {} as {
      sceneInfra: SceneInfra
      rustContext: RustContext
      kclManager: KclManager
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
                0,
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
            self.send({
              type: 'add point',
              data: [twoD.x, twoD.y],
              id: context.draftPointId,
            })
          }
        },
      })
    },
    'add point listener': ({ self, context }) => {
      console.log('Line tool ready for user click')

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
        onMove: () => {},
      })
    },
    'show draft geometry': () => {
      // Add your action code here
      // ...
    },
    'remove point listener': ({ context }) => {
      console.log('should be exiting point tool now')
      // Reset callbacks to remove the onClick listener
      context.sceneInfra.setCallbacks({
        onClick: () => {},
      })
    },
    'send result to parent': assign(({ event, self }) => {
      if (event.type !== ADDING_POINT) {
        return {}
      }
      self._parent?.send({
        type: 'update sketch outcome',
        data: event.output,
      })
      const id = [...event.output.sceneGraphDelta.new_objects]
        .reverse()
        .find((objId) => {
          const obj = event.output.sceneGraphDelta.new_graph.objects.find(
            (o) => o.id === objId
          )
          if (!obj) return false
          if (
            obj.kind.type === 'Segment' &&
            obj.kind.segment.type === 'Point' &&
            obj.id
          ) {
            return true
          }
          return false
        })
      if (id) {
        return {
          draftPointId: id,
          sceneGraphDelta: event.output.sceneGraphDelta,
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
        }
      }) => {
        const { pointData, rustContext, kclManager } = input
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

          console.log('Adding point segment:', segmentCtor)

          // Call the addSegment method using the rustContext from context
          const result = await rustContext.addSegment(
            0, // version - TODO: Get this from actual context
            0, // sketchId - TODO: Get this from actual context
            segmentCtor,
            'line-segment', // label
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
    modAndSolve: fromPromise(
      async ({
        input,
      }: {
        input: {
          pointData: [number, number]
          id: number
          rustContext: RustContext
          kclManager: KclManager
        }
      }) => {
        const { pointData, id, rustContext, kclManager } = input
        console.log('input', input)
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

          console.log('Adding point segment:', segmentCtor)

          // Call the editSegments method using the rustContext from context
          const result = await rustContext.editSegments(
            0, // version - TODO: Get this from actual context
            0, // sketchId - TODO: Get this from actual context
            [
              {
                id,
                ctor: segmentCtor,
              },
            ],
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
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QBkCWA7MACALgezwBsBiAV0wEdTUAHAbQAYBdRUGvWVHVPdVkAB6IAjAGZhDAHQMATKJkA2ABwAWAJzyA7EoCsAGhABPRAFo1mycqUMdylZoYqVDTQF9XBtJlwESpGhAAhjjYsGCEYADG3LyMLEgg7JwxfAnGCCaKKgZCCBIqSu6eGNj4RJIATmCBEIZYAGZ4FVikYc2RhKiRANbENRBY7Bg4cfxJXDypoLmZajqSMgyiqqI6BQoMwpr6RoiaFkqiS8I6mzrWKqJqRSBepb6SAMK89agVALYYUFgQqO9g6E4vFgxAgvDAkgwADc8N0IXcfOVnuhXh8vj8-gCgYCENC8JFgpM4qMEuMUvxcipJEo1BsTjpNKJRAoFAZ0iYVDIFmo5DIZCodDpRE5NAKbgiyoQni83p90N9fv9AZMQWAKhUmpIaIRgo0PpIJQ9kai5QrMcrgbj0DCCSlicwxhwJrwKSJhCphJJNMIlNsXJpzCoFNldghRQstmIFEco9Zrh5biVEVKAIIQX7ywZ4Yag8GQ62w+FJyWSNMZ75DdA4K02wmxZgkthO8kJXJRyTCTtbeRbRbiGRsxC2SSrUTbRRzYRqdS2cXFh5l9GVnDENUaipanU4PXvA3z8qLzPLmv4uvoe3xJvJSaujIxyS2TTKVY2f2DjJTkcnRmc0UMJS+ioc7eCWADKAAWeAAO4ACIVIE9Q4HcfTplmwyNokzY3q2ezhkowbLDyMjugySjvvs1JHOIpwnBcVzuAm6B4BAcD8IaRCOteLo4RkOgaNIHreoRApKHy76ZDIaiWABjguKJ9iKDowH3OUVQ1HUeotG0WAdF03Scc6UyCKYazzI4kbCecYmhmsI5UZswjEdsY6FAm7FSsasrooqWIqgZLbTIgRGWAoGjRr6jI6DImjvrZTJLIoDBzGsCidspyaSOQYBULQNBfP52GBXkzIHHxxH8qJCj7O+8gRkJwaXPyZzpSWh4VtmVYFdxRUmO6UmbCyVz-gwSzaLFVLxWOGyXGIDBVS1DwQdBcEIUhJRdUZlIyPMjm2Jy22hRotLjXZxxUVcvoaEpDFAA */
  context: ({ input }): ToolContext => ({
    draftPointId: undefined,
    sceneGraphDelta: {} as SceneGraphDelta,
    sceneInfra: input.sceneInfra,
    rustContext: input.rustContext,
    kclManager: input.kclManager,
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
      invoke: {
        input: ({ event, context }) => {
          assertEvent(event, 'add point')
          return {
            pointData: event.data,
            id: event.id || 0,
            rustContext: context.rustContext,
            kclManager: context.kclManager,
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

    'Adding point': {
      invoke: {
        src: 'modAndSolveFirstPoint',
        input: ({ event, context }) => {
          assertEvent(event, 'add point')
          return {
            pointData: event.data,
            rustContext: context.rustContext,
            kclManager: context.kclManager,
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
      },

      entry: 'animate draft segment listener',
    },
  },
})
