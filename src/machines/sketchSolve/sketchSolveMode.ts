import { assertEvent, assign, createMachine, sendTo, setup } from 'xstate'
import type { ActorRefFrom } from 'xstate'
import { modelingMachineDefaultContext } from '@src/machines/modelingSharedContext'
import type {
  ModelingMachineContext,
  SetSelections,
  MouseState,
  SegmentOverlayPayload,
} from '@src/machines/modelingSharedTypes'
import type { PathToNode } from '@src/lang/wasm'
import { machine as centerRectTool } from '@src/machines/sketchSolve/tools/centerRectTool'
import { machine as dimensionTool } from '@src/machines/sketchSolve/tools/dimensionTool'
import { machine as pointTool } from '@src/machines/sketchSolve/tools/pointTool'

const equipTools = {
  centerRectTool,
  dimensionTool,
  pointTool,
} as const

export type EquipTool = keyof typeof equipTools

export type SketchSolveMachineEvent =
  | { type: 'exit' }
  | { type: 'update selection'; data?: SetSelections }
  | { type: 'unequip tool' }
  | { type: 'equip tool'; data: { tool: EquipTool } }
  | { type: 'xstate.done.actor.tool' }

type ToolActorRef =
  | ActorRefFrom<typeof dimensionTool>
  | ActorRefFrom<typeof centerRectTool>
  | ActorRefFrom<typeof pointTool>

type SketchSolveContext = ModelingMachineContext & {
  toolActor?: ToolActorRef
  sketchSolveTool: EquipTool | 'moveTool'
  pendingTool?: EquipTool
}

export const sketchSolveMachine = setup({
  types: {
    context: {} as SketchSolveContext,
    events: {} as SketchSolveMachineEvent,
  },
  actions: {
    'send unequip to tool': sendTo(
      ({ context }) => context.toolActor || 'moveTool',
      {
        type: 'unequip',
      }
    ),
    'send update selection to equipped tool': sendTo(
      ({ context }) => context.toolActor || 'moveTool',
      {
        type: 'update selection',
      }
    ),
    'send updated selection to move tool': sendTo('moveTool', {
      type: 'update selection',
    }),
    'store pending tool': assign(({ event }) => {
      assertEvent(event, 'equip tool')
      return { pendingTool: event.data.tool }
    }),
    'spawn tool': assign(({ event, spawn, context }) => {
      // Determine which tool to spawn based on event type
      let toolToSpawn: EquipTool

      if (event.type === 'equip tool') {
        toolToSpawn = event.data.tool
      } else if (
        event.type === 'xstate.done.actor.tool' &&
        context.pendingTool
      ) {
        toolToSpawn = context.pendingTool
      } else {
        console.error('Cannot determine tool to spawn')
        return {}
      }

      let toolActor
      switch (toolToSpawn) {
        case 'dimensionTool':
          toolActor = spawn(toolToSpawn, { id: 'tool' })
          break
        case 'centerRectTool':
          toolActor = spawn(toolToSpawn, { id: 'tool' })
          break
        case 'pointTool':
          toolActor = spawn(toolToSpawn, { id: 'tool' })
          break
        default:
          const _exhaustiveCheck: never = toolToSpawn
      }
      console.log('spawned tool?')

      return {
        toolActor,
        sketchSolveTool: toolToSpawn,
        pendingTool: undefined, // Clear the pending tool after spawning
      }
    }),
  },
  actors: {
    moveToolActor: createMachine({
      /* ... */
    }),
    ...equipTools,
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QGUDWYAuBjAFgAmQHsAbANzDwFlCIwBiMADwEsMBtABgF1FQAHQrFbNCAO14hGiAIwB2ABwBWAHTyAbAGZFAFiXyOAJg0BOADQgAnolkrpHQwe1rFz59I0BfD+bSZcBEnIqGnoAVz4IAEMMClgwYjAsDBFRTh4kEAEhZLEJKQRZY1lVWWk1YzV5A3ltDg1tcysEAFoDI2UDWQ4lNWk5A0Uqz28QX2x8IjIKalo6UNEwAEdQ5j48DEISNIks4VyM-O1FFRqB2Sd6jlk1BstEVo1pZQ1e+Rt5eWlB0u0vH3RxgEpsFaMoALaEIKRUQQPBxBJJOgQMRgZTMUSkQjocGQsAAFU2xG2GV2OXEBxkfRUbU67k0dhuakaMkcqgMalkNk5Gnsxg0w3+fgmgWmIRxUJhcPiiQwDAATnLCHLlHxiNEAGZKsHi-GE4n8QR7cmgfLSAzGAzKexVV6c7TaTrMhBm7RsyqGB32i3yAWjAH+SZBGaoiES2HwmUMZardZ67g7Q1kvKUjhWwqKYw+6pFY7yJ0GdyqQbGOqVNqKdl-P1CoFBsWhISiKCxkhzBbRtYbLbxkmJlLJhAVYzKBQmMoKezSYy3JqPDRW+pyY6KEyVKtjAMikGohvo5td4hRladuPpA3ZfsUwcaYqdGpFIz35xOxQcV0aNq1TTdQqyX0b4VgWDZRYAAd1YXA9xbQ9GFgDBolRZEFmUSIkiVZQD31TI+32E0ZB5ZQKg-RROXOUoOCZO4EG0LpnmqD8bzUZx5GMMovBGUQQngDIANrUVaATC9cMkRA1EtK5jAzLMWJsQYnWaM1nmMIpCjNAspPXf1ALrUFQwoaFw2lJJBKNAcb1vC1ZHUtQHAGJ07EtBRzQcHlX1kTSa0Dfid0bfdCRMpMrxMFQxLEjgXHZJxJKdD9igozQrOUmpPjUDzAS87cQPA8YoIPALLzwhBzVdDN2XKdx+VYvMqLE4p7Teep6gMK4xLSzcgLFJhhCbfLhNNXQ1GUGiOW0ExpyYoonWUt19Bo45p0ceR2I8IA */
  context: ({ input }): SketchSolveContext => ({
    ...modelingMachineDefaultContext,
    sketchSolveTool: 'moveTool',
  }),
  id: 'Sketch Solve Mode',
  initial: 'move and select',
  on: {
    exit: {
      target: '#Sketch Solve Mode.exiting',
      actions: 'send unequip to tool',
      description:
        'the outside world can request that sketch mode exit, but it needs to handle its own teardown first.',
    },
    'update selection': {
      actions: [
        'send update selection to equipped tool',
        'send updated selection to move tool',
      ],
      description:
        'sketch mode consumes the current selection from its source of truth (currently modelingMachine). Whenever it receives',
    },
    'unequip tool': {
      actions: 'send unequip to tool',
    },
  },
  states: {
    'move and select': {
      entry: () => console.log('entered sketch mode'),
      on: {
        'equip tool': {
          target: 'using tool',
          actions: 'store pending tool',
        },
      },
      invoke: {
        id: 'moveTool',
        input: {},
        onDone: {
          target: 'exiting',
        },
        onError: {
          target: 'exiting',
        },
        src: 'moveToolActor',
      },
      description:
        'The base state of sketch mode is to all the user to move around the scene and select geometry.',
    },

    'using tool': {
      on: {
        'unequip tool': {
          target: 'move and select',
          actions: 'send unequip to tool',
        },

        'equip tool': {
          target: 'switching tool',
          actions: ['send unequip to tool', 'store pending tool'],
        },
      },

      description:
        'Tools are workflows that create or modify geometry in the sketch scene after conditions are met. Some, like the Dimension, Center Rectangle, and Tangent tools, are finite, which they signal by reaching a final state. Some, like the Spline tool, appear to be infinite. In these cases, it is up to the tool Actor to receive whatever signal (such as the Esc key for Spline) necessary to reach a final state and unequip itself.\n\nTools can request to be unequipped from the outside by a "unequip tool" event sent to the sketch machine. This will sendTo the toolInvoker actor.',

      entry: 'spawn tool',
    },

    'switching tool': {
      on: {
        'xstate.done.actor.tool': {
          target: 'using tool',
          actions: [
            () => console.log('switched tools with xstate.done.actor.tool'),
          ],
        },
      },

      description:
        'Intermediate state while the current tool is cleaning up before spawning a new tool.',

      exit: [() => console.log('exiting switching tool')],
    },

    exiting: {
      type: 'final',
      description: 'Place any teardown code here.',
    },
  },
})
