import { assign, assertEvent, createMachine, sendTo, setup } from 'xstate'
import type { AnyActorRef } from 'xstate'
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

type EquipTool = 'dimension' | 'center rectangle'

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
  | { type: 'tool completed' }

type SketchSolveContext = ModelingMachineContext & {
  toolActor?: AnyActorRef
  sketchSolveTool: EquipTool | 'moveTool'
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
    'spawn tool': assign(({ event, spawn }) => {
      assertEvent(event, 'equip tool')
      const actorName =
        event.data.tool === 'dimension'
          ? 'dimensionToolActor'
          : 'centerRectToolActor'

      const spawnedActor = spawn(actorName, { id: `tool-${event.data.tool}` })

      return {
        toolActor: spawnedActor,
        sketchSolveTool: event.data.tool,
      }
    }),
    'stop tool': assign(({ context }) => {
      return { toolActor: undefined }
    }),
  },
  actors: {
    moveToolActor: createMachine({
      /* ... */
    }),
    dimensionToolActor: dimensionToolMachine,
    centerRectToolActor: centerRectToolMachine,
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QGUDWYAuBjAFgAmQHsAbANzDwFlCIwBiMADwEsMBtABgF1FQAHQrFbNCAO14hGiAIwAmAKwAOAHQcAzABZFGgGwBOebL16A7LIA0IAJ6INencs0a7ixTvUdpAXy+W0mXAIScioaegBXPggAQwwKWDBiMCwMEVFOHiQQASFUsQkpBHk1RwV7WTVFWVlFaR0dSxsEAFpqjmVZXT0OWXcTeQMenz90bHwiMgpqWjpw0TAAR3DmPjwMQhIMiRzhfKzCkx15ZSOOHu61fpNGxBM1dqOdGsNXRRNpRWGQfzGgydDaMoALaEELRUQQPAJJIpOgQMRgZTMUSkQjoYGgsAAFQ2xC2WR2eXE+xkChU0j0Gg4OkqHD0H3eNwQsk8ylc0k09RM9jeei+P0CExC00RILBEKhiWSGAYACdZYRZco+MRYgAzRVAjHkHGbbjbQS7YmgQpyPSyVQcKo6BkmZyya7WUkaNm9RQ9DSdOw1NT80aC4JTMLaijgyHQ6UMJYrNa4-H8Q1Egq2DgmRzSHpPB16Kr9JnSeTtd00w5qAxKRS+3zff3jQMAxHhISiKCxkizebR1brPWZBO5NLJopVRwmExnJ7Sb13JnVaRss4ffTyOyXT7VgV1-4i5RN5GtnvEOiMWAYWKI+HzZTRFKK5SH5oAKnj2UTg5JCHZynkjw0hicGZqEyag6C68gmNo9zVEYtSdD41aiGE8BZJufzCmEBoDnsJqIA6RaXCuPR3N0Hz5i6OhmPIK46Io4GKOaZh+gEW7oYCYqhhKEYpJhRpDtyYE9AWdL1OaDROggGbzocNJWhwzhWh8TG-EKQaAnuLZtsQPFJh+agfGyBFUg6ZaeIowFKMoVKeJU5oFhB64jMxaGqYiTDCC22nvjhEllioGhyMUOYVDS+amCcNHvFRlG6BU8FeEAA */
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
          actions: ['spawn tool'],
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
        'xstate.done.actor.tool-*': {
          target: 'move and select',
          actions: 'stop tool',
        },
        'unequip tool': {
          target: 'move and select',
          actions: 'stop tool',
        },
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
