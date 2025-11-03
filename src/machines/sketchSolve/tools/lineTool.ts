import { assertEvent, assign, fromPromise, setup } from 'xstate'

import { sceneInfra, rustContext } from '@src/lib/singletons'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import type {
  SceneGraphDelta,
  SegmentCtor,
  SketchExecOutcome,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { roundOff } from '@src/lib/utils'

const TOOL_ID = 'Line tool'
const CONFIRMING_DIMENSIONS = 'Confirming dimensions'
const ADDING_POINT = `xstate.done.actor.0.${TOOL_ID}.Adding point`

type ToolEvents =
  | { type: 'unequip' }
  | { type: 'add point'; data: [x: number, y: number] }
  | { type: 'update selection' }
  | {
      type: `xstate.done.actor.0.${typeof TOOL_ID}.Adding point`
      output: {
        kclSource: SourceDelta
        sketchExecOutcome: SketchExecOutcome
        sceneGraphDelta: SceneGraphDelta
      }
    }

type ToolContext = {
  draftPointId?: number
  sceneGraphDelta: SceneGraphDelta
}

export const machine = setup({
  types: {
    context: {} as ToolContext,
    events: {} as ToolEvents,
  },
  actions: {
    'animate draft segment listener': ({ self, context }) => {
      // let isDragging = false
      let isEditInProgress = false
      // let latestTwoD: Vector2 | null = null
      // let lastAppliedTwoD: Vector2 | null = null
      sceneInfra.setCallbacks({
        onMove: async (args) => {
          if (!args || !context.draftPointId) return
          const twoD = args.intersectionPoint?.twoD
          const ctor = context.sceneGraphDelta.new_graph.objects.find(
            (obj) => obj.id === context.draftPointId
          )
          console.log('draft segment ctor', ctor, ctor?.kind)
          if (
            twoD &&
            !isEditInProgress &&
            ctor?.kind.type === 'Segment' &&
            ctor.kind.segment.type === 'Line'
          ) {
            const innerCtor = ctor.kind.segment.ctor
            if (innerCtor.type !== 'Line') {
              return
            }
            const startX =
              innerCtor.start.x.type === 'Number' ? innerCtor.start.x.value : 0
            const startY =
              innerCtor.start.y.type === 'Number' ? innerCtor.start.y.value : 0
            // Send the add point event with the clicked coordinates
            try {
              isEditInProgress = true
              const settings = await jsAppSettings()
              const result = await rustContext.editSegments(
                0,
                0,
                [
                  {
                    id: context.draftPointId,
                    ctor: {
                      type: 'Line',
                      start: {
                        x: {
                          type: 'Var',
                          value: roundOff(startX),
                          units: 'Mm',
                        },
                        y: {
                          type: 'Var',
                          value: roundOff(startY),
                          units: 'Mm',
                        },
                      },
                      end: {
                        x: {
                          type: 'Var',
                          value: roundOff(twoD.x),
                          units: 'Mm',
                        },
                        y: {
                          type: 'Var',
                          value: roundOff(twoD.y),
                          units: 'Mm',
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
      })
    },
    'add point listener': ({ self }) => {
      console.log('Line tool ready for user click')

      sceneInfra.setCallbacks({
        onClick: (args) => {
          if (!args) return
          if (args.mouseEvent.which !== 1) return // Only left click

          const twoD = args.intersectionPoint?.twoD
          if (twoD) {
            // Send the add point event with the clicked coordinates
            self.send({
              type: 'add point',
              data: [twoD.x, twoD.y] as [number, number],
            })
          }
        },
      })
    },
    'show draft geometry': () => {
      // Add your action code here
      // ...
    },
    'remove point listener': () => {
      console.log('should be exiting point tool now')
      // Reset callbacks to remove the onClick listener
      sceneInfra.setCallbacks({
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
            obj.kind.segment.type === 'Line' &&
            obj.id
          ) {
            return true
          }
          return false
        })
      console.log('id of point', id)
      if (id) {
        return {
          draftPointId: id,
          sceneGraphDelta: event.output.sceneGraphDelta,
        }
      }
      return {}
      // return  {
      //   sketchExecOutcome: event.output
      // }
    }),
  },
  actors: {
    modAndSolveFirstPoint: fromPromise(
      async ({ input }: { input: { pointData: [number, number] } }) => {
        const { pointData } = input
        const [x, y] = pointData

        try {
          // TODO not sure if we should be sending through units with this
          const segmentCtor: SegmentCtor = {
            type: 'Line',
            start: {
              x: { type: 'Var', value: roundOff(x), units: 'Mm' },
              y: { type: 'Var', value: roundOff(y), units: 'Mm' },
            },
            end: {
              x: { type: 'Var', value: roundOff(x), units: 'Mm' },
              y: { type: 'Var', value: roundOff(y), units: 'Mm' },
            },
          }

          console.log('Adding point segment:', segmentCtor)

          // Call the addSegment method using the singleton rustContext
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
      async ({ input }: { input: { pointData: [number, number] } }) => {}
    ),
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QBkCWA7MACALgezwBsBiAV0wEdTUAHAbQAYBdRUGvWVHVPdVkAB6IAjAGZhDAHQMATKJkA2ABwAWAJzyA7EoCsAGhABPRAFo1mycqUMdylZoYqVDTQF9XBtJlwESpGhAAhjjYsGCEYADG3LyMLEgg7JwxfAnGCCaKKgZCCBIqSu6eGNj4RJIATmCBEIZYAGZ4FVikYc2RhKiRANbENRBY7Bg4cfxJXDypoLmZajqSMgyiqqI6BQoMwpr6RoiaFkqiS8I6mzrWKqJqRSBepb6SAMK89agVALYYUFgQqO9g6E4vFgxAgvDAkgwADc8N0IXcfOVnuhXh8vj8-gCgYCENC8JFgpM4qMEuMUvxcipJEo1BsTjpNKJRAoFAZ0iYVDIFmo5DIZCodDpRE5NAKbgiyoQni83p90N9fv9AZMQWAKhUmpIaIRgo0PpIJQ9kai5QrMcrgbj0DCCSlicwxhwJrwKSJhCphJJNMIlNsXJpzCoFNldghRQstmIFEco9Zrh5biVEVKAIIQX7ywZ4Yag8GQ62w+FJyWSNMZ75DdA4K02wmxZgkthO8kJXJRyTCTtbeRbRbiGRsxC2SSrUTbRRzYRqdS2cXFh5l9GVnDENUaipanU4PXvA3z8qLzPLmv4uvoe3xJvJSaujIxyS2TTKVY2f2DjJTkcnRmc0UMJS+ioc7eCWADKAAWeAAO4ACIVIE9Q4HcfTplmwyNokzY3q2ezhkowbLDyMjugySjvvs1JHOIpwnBcVzuAm6B4BAcD8IaRCOteLo4RkOgaNIHreoRApKHy76ZDIaiWABjguKJ9iKDowH3OUVQ1HUeotG0WAdF03Scc6UyCKYazzI4kbCecYmhmsI5UZswjEdsY6FAm7FSsasrooqWIqgZLbTIgRGWAoGjRr6jI6DImjvrZTJLIoDBzGsCidspyaSOQYBULQNBfP52GBXkzIHHxxH8qJCj7O+8gRkJwaXPyZzpSWh4VtmVYFdxRUmO6UmbCyVz-gwSzaLFVLxWOGyXGIDBVS1DwQdBcEIUhJRdUZlIyPMjm2Jy22hRotLjXZxxUVcvoaEpDFAA */
  context: {} as ToolContext,
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
        input: ({ event }) => {
          assertEvent(event, 'add point')
          return { pointData: event.data }
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
        input: ({ event }) => {
          assertEvent(event, 'add point')
          return { pointData: event.data }
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

// "Failed to edit segment in sketch: Error { msg: "Line not found in sketch: point=ObjectId(2), sketch=Sketch { args: SketchArgs { on: Default(Xy) }, segments: [ObjectId(3)], constraints: [] }" }"
