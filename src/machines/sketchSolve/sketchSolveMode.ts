import {
  assertEvent,
  assign,
  createMachine,
  sendParent,
  sendTo,
  setup,
} from 'xstate'
import type { ActorRefFrom } from 'xstate'
import type { SetSelections } from '@src/machines/modelingSharedTypes'
import { machine as centerRectTool } from '@src/machines/sketchSolve/tools/centerRectTool'
import { machine as dimensionTool } from '@src/machines/sketchSolve/tools/dimensionTool'
import { machine as pointTool } from '@src/machines/sketchSolve/tools/pointTool'
import type {
  SketchExecOutcome,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'

const equipTools = Object.freeze({
  centerRectTool,
  dimensionTool,
  pointTool,
})

const CHILD_TOOL_ID = 'child tool'
const CHILD_TOOL_DONE_EVENT = `xstate.done.actor.${CHILD_TOOL_ID}`

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
  | { type: typeof CHILD_TOOL_DONE_EVENT }
  | {
      type: 'update sketch outcome'
      data: {
        kclSource: SourceDelta
        sketchExecOutcome: SketchExecOutcome
      }
    }

type SketchSolveContext = {
  sketchSolveToolName: EquipTool | null
  pendingToolName?: EquipTool
  sketchExecOutcome?: {
    kclSource: SourceDelta
    sketchExecOutcome: SketchExecOutcome
  }
}

export const sketchSolveMachine = setup({
  types: {
    context: {} as SketchSolveContext,
    events: {} as SketchSolveMachineEvent,
  },
  actions: {
    'send unequip to tool': sendTo(CHILD_TOOL_ID, { type: 'unequip' }),
    'send update selection to equipped tool': sendTo(CHILD_TOOL_ID, {
      type: 'update selection',
    }),
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
    'update sketch outcome': assign(({ event }) => {
      assertEvent(event, 'update sketch outcome')
      return { sketchExecOutcome: event.data }
    }),
    'spawn tool': assign(({ event, spawn, context }) => {
      // Determine which tool to spawn based on event type
      let nameOfToolToSpawn: EquipTool

      if (event.type === 'equip tool') {
        nameOfToolToSpawn = event.data.tool
      } else if (
        event.type === CHILD_TOOL_DONE_EVENT &&
        context.pendingToolName
      ) {
        nameOfToolToSpawn = context.pendingToolName
      } else {
        console.error('Cannot determine tool to spawn')
        return {}
      }
      // this type-annotation informs spawn tool of the association between the EquipTools type and the machines in equipTools
      // It's not an type assertion. TS still checks that _spawn is assignable to SpawnToolActor.
      const typedSpawn: SpawnToolActor = spawn
      typedSpawn(nameOfToolToSpawn, { id: CHILD_TOOL_ID })

      return {
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
  /** @xstate-layout N4IgpgJg5mDOIC5QGUDWYAuBjAFgAmQHsAbANzDwFlCIwBiMADwEsMBtABgF1FQAHQrFbNCAO14hGiAIwB2ABwBWAHTyAbAGZFAFiXyOAJg0BOADQgAnolkrpHQwe1rFz59I0BfD+bSZcBEnIqGnoAVz4IAEMMClgwYjAsDBFRTh4kEAEhZLEJKQRZY1lVWWk1YzV5A3ltDg1tcysEAFoDI2UDWQ4lNWk5A0Uqz28QX2x8IjIKalo6cKiYvFh0cbxCUOxCAFswNIks4VyM-OkBg2VjU40a6-ljF0VGxFbpY2Uug0ubTp07rx8Vv5JkEZmFRGAAI6hZh8PAYQgkPYZA45cTHRDaRQqGoDWROeocWRqBqWZ5GaTKDS9eQ2eTyaSDUraf6jQETQLTELKLaEIKRUQQJbxRIYOgQMRgZTMUSkQjobm8sAAFQRxCR-EEhzRoBOnwpGipPw42jkZlJBTUykGBjUxMG3Q0xpZYyBHOCtAVfIFQoSSQYACd-YR-co+MRogAzYNbT3K1XqzKa1F5GSfc72KrU2R47QDJ4IU7aVQ2+nlS4uDinZ1sgJTd2SnlewVxX2iyHQ2HwxHcfZJlIpgt2ZSE+7GeQaapFLHyfMGdyqQbGOqVNqKG3Vvzsuug5ShISiKBw1VzcFQmFH7vpDXZfvogvG+SUsp49RdA3E-NaItY4y-3Mm20nRGF0txBLk92lQ8u2IBgz07eMe2RPsjh1RAigpT46m0XQTFkG01HzbQFHeLFZA0BQ6kUeppA3VZgU5D1YAAd1YXBIIvGDGFgDBoklcVwWUSIkmDZQExRW9UIQIpzjuCp9ExJdygI81iUfBk8InKi1AUOdaNdbdwNPDs+HY6C6C4niYmUfjJSE+EQzE5DtUkRAXEfFw83NBRimMXQyO0eoDEJNQDC8EZRBCeAMhA2swNoXsbxQlyEBC4dCkUMcJzuGxBnzZpTkpX9s0KXRn06PTQIYhtFTwflm2FJIEq1AdyOKNM8IZNQHE8po7HOHSlzaR1FEJCrYqq3d9yg1UmuTO8TBUapyXUaodEec1HXczpNC0NbFDG+j62UZjWJwUyZqQxLnPyT5v2MfDLgNExpBnFTOmUbCaXqQLgtC4Ca0OncmGEA9Zok5LpF0S0iO0gK-1tIp81-YtKmNHLfMceQDrdHdQiMmETIPDiwaS3VyOUV5ekqDKurKfMsSLUobAZRRCiqRQaLCoA */
  context: (): SketchSolveContext => ({
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
    'update sketch outcome': {
      actions: 'update sketch outcome',
      description:
        'Updates the sketch execution outcome in the context when tools complete operations',
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
        [CHILD_TOOL_DONE_EVENT]: {
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
        [CHILD_TOOL_DONE_EVENT]: {
          target: 'move and select',
          actions: ['send tool unequipped to parent'],
        },
      },

      description: `Intermediate state, same as the "switching tool" state, but for unequip`,
    },
  },
})
