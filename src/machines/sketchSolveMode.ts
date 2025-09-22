import { createMachine, fromPromise, sendTo, setup } from 'xstate'
import { modelingMachineDefaultContext } from '@src/machines/modelingSharedContext'
import type {
  ModelingMachineContext,
  SetSelections,
  MouseState,
  SegmentOverlayPayload,
} from '@src/machines/modelingSharedTypes'
import type { PathToNode } from '@src/lang/wasm'
import { machine as centerRectToolMachine } from '@src/machines/centerRectTool'
import { machine as dimensionToolMachine } from '@src/machines/dimensionTool'

const toolRegistry = {
  'center rectangle': centerRectToolMachine,
  dimension: dimensionToolMachine,
} as const

type EquipTool = keyof typeof toolRegistry

// Helper function to get tool machine
const getToolMachine = (tool: EquipTool) =>
  toolRegistry[tool] || dimensionToolMachine

export type SketchSolveMachineEvent =
  | { type: 'exit' }
  | { type: 'update selection'; data?: SetSelections }
  | { type: 'unequip tool' }
  | { type: 'equip tool'; data: { tool: EquipTool } }
  | { type: 'Set mouse state'; data: MouseState }
  | { type: 'Set Segment Overlays'; data: SegmentOverlayPayload }
  | { type: 'Delete segment'; data: PathToNode }
  | { type: 'change tool'; data: { tool: EquipTool } }
  | { type: 'click in scene'; data: [x: number, y: number] }

export const sketchSolveMachine = setup({
  types: {
    context: {} as ModelingMachineContext,
    events: {} as SketchSolveMachineEvent,
  },
  actions: {
    'send unequip to tool': sendTo('toolInvoker', {
      type: 'unequip',
    }),
    'send update selection to equipped tool': sendTo('toolInvoker', {
      type: 'update selection',
    }),
    'send updated selection to move tool': sendTo('moveTool', {
      type: 'update selection',
    }),
  },
  actors: {
    moveToolActor: createMachine({
      /* ... */
    }),
    toolInvoker: fromPromise(({ input }: { input: { tool: EquipTool } }) =>
      Promise.resolve(getToolMachine(input.tool))
    ),
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QGUDWYAuBjAFgAmQHsAbANzDwFlCIwBiMADwEsMBtABgF1FQAHQrFbNCAO14hGiAIwAmAKwAOAHQcAzABZFGgGwBOebL16A7LIA0IAJ6INencs0a7ixTvUdpAXy+W0mXAIScioaegBXPggAQwwKWDBiMCwMEVFOHiQQASFUsQkpBHk1RwV7WTVFWVlFaR0dSxsEAFpqjmVZXT0OWXcTeQMenz90bHwiMgpqWjpw0TAAR3DmPjwMQhIMiRzhfKzCkx15ZSOOHu61fpNGxBM1dqOdGsNXRRNpRWGQfzGgydDaMoALaEELRUQQPAJJIpOgQMRgZTMUSkQjoYGgsAAFQ2xC2WR2eXE+xkFWkylc-SMT3kdWkNwQ1RKHHebxqeiqtXk8i+P0CExC00RILBEKhiWSGAYACdpYRpco+MRYgAzeVAjHkHGbbjbQS7YmgQpyNTkymGcq0nT06wyEwmDo1OQmDTSV33T6+b6jfnBKZhTUUcGQ6GShhLFZrXH4-j6okFWwsxzSHpPWQmDnp+QM6TydqKDg6S5FgxKRRqXk+8Z+gGI8JCURQKMkOEIpEotGI9YkACSHfQ0pj2TjaQTRSLymMlxM5cLprU2dtjOtJw+h08edddUrAWr-yFynryKb3eIMrlCqVqvVylPfdRA6HhNHJPHJSn9tnRekC5zpmUdg6G47xqO40hmBoPheqIYTwFkfJ7oKYR6rkL5Gog6b5pc8gaD0dzdB8DJqHojq1J0Sg1JUrg7r8Ar+oCIpBmKoYpChBpjncJRqAuejEQMhxcjmvTKGYZHaBwWgKP0NG+vuAZHo2zbEGx8avqaKjlv0uHpsRniKERSgAWcP6KHosi5jOnojLufxIYCTDCI2KloZIMjESoroKO5FRFn+Dr1G8ubyGYOFPBWUFAA */
  context: ({ input }): ModelingMachineContext => ({
    ...modelingMachineDefaultContext,
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
      invoke: {
        id: 'toolInvoker',
        input: ({
          event,
        }: { event: SketchSolveMachineEvent }): { tool: EquipTool } => ({
          tool: event.type === 'equip tool' ? event.data.tool : 'dimension',
        }),
        onDone: {
          target: 'move and select',
        },
        onError: {
          target: 'move and select',
        },
        src: 'toolInvoker',
      },
      description:
        'Tools are workflows that create or modify geometry in the sketch scene after conditions are met. Some, like the Dimension, Center Rectangle, and Tangent tools, are finite, which they signal by reaching a final state. Some, like the Spline tool, appear to be infinite. In these cases, it is up to the tool Actor to receive whatever signal (such as the Esc key for Spline) necessary to reach a final state and unequip itself.\n\nTools can request to be unequipped from the outside by a "unequip tool" event sent to the sketch machine. This will sendTo the toolInvoker actor.',
    },
    exiting: {
      type: 'final',
      description: 'Place any teardown code here.',
    },
  },
})
