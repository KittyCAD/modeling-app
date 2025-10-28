import { assertEvent, fromPromise, setup } from 'xstate'

import { sceneInfra, rustContext, kclManager } from '@src/lib/singletons'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import type {
  SegmentCtor,
  SketchExecOutcome,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'

const CONFIRMING_DIMENSIONS = 'Confirming dimensions'
const CONFIRMING_DIMENSIONS_DONE = `xstate.done.actor.0.Point tool.${CONFIRMING_DIMENSIONS}`

type PointEvent =
  | { type: 'unequip' }
  | { type: 'add point'; data: [x: number, y: number] }
  | { type: 'update selection' }
  | {
      type: `xstate.done.actor.0.Point tool.${typeof CONFIRMING_DIMENSIONS}`
      output: {
        kclSource: SourceDelta
        sketchExecOutcome: SketchExecOutcome
      }
    }

export const machine = setup({
  types: {
    context: {} as Record<string, unknown>,
    events: {} as PointEvent,
  },
  actions: {
    'add point listener': ({ self }) => {
      console.log('Point tool ready for user click')

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
      async ({ input }: { input: { pointData: [number, number] } }) => {
        const { pointData } = input
        const [x, y] = pointData

        try {
          await rustContext.hackSetProgram(
            kclManager.ast,
            await jsAppSettings()
          )
          // TODO not sure if we should be sending through units with this
          const segmentCtor: SegmentCtor = {
            type: 'Point',
            position: {
              x: { type: 'Number', value: x, units: 'Mm' },
              y: { type: 'Number', value: y, units: 'Mm' },
            },
          }

          console.log('Adding point segment:', segmentCtor)

          // Call the addSegment method using the singleton rustContext
          const result = await rustContext.addSegment(
            1, // version - TODO: Get this from actual context
            0, // sketchId - TODO: Get this from actual context
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
  /** @xstate-layout N4IgpgJg5mDOIC5QAUD2BLAdgFwATdVQBsBiAV0zAEcz0AHAbQAYBdRUO1WdbdVTdiAAeiAIwAmcaIB0AZgCcANlniAHAHZZAVkXilAGhABPRABZp61VvWnFW8Uy0KdogL6vDaLHgLFydCABDbDBcWDAiMABjXn5mNiQQTm5YgUSRBAVxaUVRJlU1JwL5UWtDEwQAWkLpJiZxbVN1ayY7VUV3TwwcfEIiaQBhfgAzdAAnAFssKFwIdAmwTG5+WBIIfjBpLAA3VABrTa8e336hzFHJ6dn5xeWlhB3UKOC+THj4wWSeV8EMnXlamolPI6g5lKZyogQdI1M1tIpTKokQpZJ0QEcfH1BiNxlNMDM5gslq9VmAxmNUGNpHQiMFhpSJtIMb1iNjzriroTbiSHphds9Uu9WJ8uN9+L8xI5VNJ2op1HLwTokZCEKJ2jDTPItaomEpVKJ5Fo0cyTtIxmBAhAjLh6WNcGRwnaokR0FE9iRLRBcJxvB9El9UhKELppYa1KVSvlVAoVWrzM06rII5otR00ZhUBA4IITX0RSkfulEEn1BYwYjHFJROpxOoVZUJKWpKZxLktPJZDX1ExTMbupjWebLdbbfbHbhna69vmxWlQBlZHYy60K-ZRNXa7HcjCtKCWoiky2+94WaccZd8dciXd4P7RYGiwgCjJxKZZKZq+3HLrRFuX7v6nUDtVC1bVj2OLEKGoWg6DoaYZwfecxFrAEGkkBEezyeR5VjUxzHEACmEbYpTHsdx3CAA */
  context: {},
  id: 'Point tool',
  initial: 'ready for user click',
  on: {
    unequip: {
      target: '#Point tool.unequipping',
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
        'add point': CONFIRMING_DIMENSIONS,
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
  },
  entry: async () => {
    // TODO: using newSketch or editSketch should make this hack redundant
    await rustContext.hackSetProgram(kclManager.ast, await jsAppSettings())
  },
})
