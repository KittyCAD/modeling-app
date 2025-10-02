import {
  assertEvent,
  assign,
  createMachine,
  sendParent,
  sendTo,
  setup,
} from 'xstate'
import type { ActorRefFrom } from 'xstate'
import { modelingMachineDefaultContext } from '@src/machines/modelingSharedContext'
import type {
  ModelingMachineContext,
  SetSelections,
} from '@src/machines/modelingSharedTypes'
import { machine as centerRectTool } from '@src/machines/sketchSolve/tools/centerRectTool'
import { machine as dimensionTool } from '@src/machines/sketchSolve/tools/dimensionTool'
import { machine as pointTool } from '@src/machines/sketchSolve/tools/pointTool'

const equipTools = Object.freeze({
  centerRectTool,
  dimensionTool,
  pointTool,
})

export type EquipTool = keyof typeof equipTools

// Type for the spawn function used in XState setup actions
// This provides better type safety by constraining the actor parameter to valid tool names
// and ensuring the return type matches the specific tool actor
type SpawnToolActor = <K extends EquipTool>(
  src: K,
  options?: { id?: string }
) => ActorRefFrom<(typeof equipTools)[K]>

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
  sketchSolveToolName: EquipTool | null
  pendingToolName?: EquipTool
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
      return { pendingToolName: event.data.tool }
    }),
    'send tool equipped to parent': sendParent(({ context }) => ({
      type: 'sketch solve tool changed',
      data: { tool: context.sketchSolveToolName },
    })),
    'send tool unequipped to parent': sendParent({
      type: 'sketch solve tool changed',
      data: { tool: null },
    }),
    'spawn tool': assign(({ event, spawn: _spawn, context }) => {
      // this type-annotation informs spawn tool of the association between the EquipTools type and the machines in equipTools
      // It's not an type assertion. TS still checks that _spawn is assignable to SpawnToolActor.
      const spawn: SpawnToolActor = _spawn
      // Determine which tool to spawn based on event type
      let nameOfToolToSpawn: EquipTool

      if (event.type === 'equip tool') {
        nameOfToolToSpawn = event.data.tool
      } else if (
        event.type === 'xstate.done.actor.tool' &&
        context.pendingToolName
      ) {
        nameOfToolToSpawn = context.pendingToolName
      } else {
        console.error('Cannot determine tool to spawn')
        return {}
      }

      return {
        toolActor: spawn(nameOfToolToSpawn, { id: 'tool' }),
        sketchSolveToolName: nameOfToolToSpawn,
        pendingToolName: undefined, // Clear the pending tool after spawning
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
  /** @xstate-layout N4IgpgJg5mDOIC5QGUDWYAuBjAFgAmQHsAbANzDwFlCIwBiMADwEsMBtABgF1FQAHQrFbNCAO14hGiAIwB2ABwBWAHTyAbAGZFAFiXyOAJg0BOADQgAnolkrpHQwe1rFz59I0BfD+bSZcBEnIqGnoAVz4IAEMMClgwYjAsDBFRTh4kEAEhZLEJKQRZY1lVWWk1YzV5A3ltDg1tcysEAFoDI2UDWQ4lNWk5A0Uqz28QX2x8IjIKalo6UNEwAEdQ5j48DEISNIks4VyM-O1FFRqB2Sd6jlk1BstEVo1pZQ1e+Rt5eWlB0u0vH3RxgEpsFaMoALaEIKRUQQPBxBJJOgQMRgZTMUSkQjocGQsAAFU2xG2GV2OXEBxkBmMTw0L06ig42jkZjuBTUykGBjUN0G3Q0jL+owB-kmQRmqIhUJhcPiiQwDAATgrCArlHxiNEAGYqsE48gErbcHaCPbk0D5aRUgzKexVV6yc7aAaNSnaVRcz7lakuDiWwVjEWBaYhPUUaGw+FyhjLVbrQnE-gmsl5GR2G2FRTGeQaapFY7yF0IAzuVSDYx1SptRRc-3CiZBkGo0JCURQOMkOYLGNrDaG9KJ7IpFMIOzcm19NTFqnSYwaT6FjTnZS6XqyAxXLpz5y1vz14Hi5TN9Ft3vEaMrHvxo0kpNDikIWfFTo1IpGF-OQsMt05xwcTTdQpZGGf5dyBMUQ1gAB3VhcGPdsz0YWAMGiVFkQWZRIiSFVlFPBNMlvfZzRkR4OUfRRrgZQZ1ELbQumUZxtEY7QTHXZjgKFUDRWDUF5iWC84NPOhEOQmJlDQ1FMI2VVcOvAdTWHOwmRtQYmX5IwgKAws5Dda5LV0P9pB6LQvBGUQQngDIAz3cDaGNQdCMkRBJ3TYxM2zXMbEGQtmktZ5jCKB0uRcAYqR3QEuMbUM8HDGUEQwOz5PvRcn2MTpix9NpnVZOxrQUKkHH5BlZDCwN9xDI9W3ghLk3vWoOGeNQ1w4HQ7EURdFAXGcOXURdaRMMoc3YqywO41EoJgnABMJaq7yIotjDdTMuXKdxaWpAtWUnYpGLeep6nXa4DBK6zRuUJhhFbGaHItFdl2uc4TAW7kikLfz3UqRlPIWxx5GOkbIt47sppIK6zUch8BmUQpqkeaQnRUjamk6J56Q+c4QocEyPCAA */
  context: ({ input }): SketchSolveContext => ({
    ...modelingMachineDefaultContext,
    sketchSolveToolName: null,
  }),
  id: 'Sketch Solve Mode',
  initial: 'move and select',
  on: {
    exit: {
      target: '#Sketch Solve Mode.exiting',
      actions: ['send unequip to tool', 'send tool unequipped to parent'],
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
      entry: [() => console.log('entered sketch mode')],
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
          target: 'unequipping tool',
          actions: ['send unequip to tool'],
          reenter: true,
        },

        'equip tool': {
          target: 'switching tool',
          actions: ['send unequip to tool', 'store pending tool'],
        },
      },

      description:
        'Tools are workflows that create or modify geometry in the sketch scene after conditions are met. Some, like the Dimension, Center Rectangle, and Tangent tools, are finite, which they signal by reaching a final state. Some, like the Spline tool, appear to be infinite. In these cases, it is up to the tool Actor to receive whatever signal (such as the Esc key for Spline) necessary to reach a final state and unequip itself.\n\nTools can request to be unequipped from the outside by a "unequip tool" event sent to the sketch machine. This will sendTo the toolInvoker actor.',

      entry: ['spawn tool', 'send tool equipped to parent'],
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

    'unequipping tool': {
      on: {
        'xstate.done.actor.tool': {
          target: 'move and select',
          actions: ['send tool unequipped to parent'],
        },
      },

      description: `Intermediate state, same as the "switching tool" state, but for unequip`,
    },
  },
})
