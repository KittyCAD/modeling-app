import { fromCallback, sendTo, setup } from 'xstate'
import type {
  ToolInput,
  SketchSolveContext,
  SketchSolveMachineEvent,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import { createLegacyCircleInteraction } from '@src/machines/sketchSolve/tools/circleLegacyAdapter'
import { reportRejection } from '@src/lib/trap'

/** A lifecycle envelope for the legacy tool invoker; all Circle phases live in the shared controller. */
export const machine = setup({
  types: {
    context: {} as ToolInput,
    input: {} as ToolInput,
    events: {} as { type: 'escape' | 'unequip' | 'finished' },
  },
  actors: {
    interaction: fromCallback<
      { type: 'escape' | 'unequip' },
      ToolInput & {
        parent?: {
          getSnapshot: () => {
            context: Pick<SketchSolveContext, 'sketchExecOutcome'>
          }
          send: (event: SketchSolveMachineEvent) => void
        }
      }
    >(({ input, receive, sendBack }) => {
      if (!input.parent) {
        sendBack({ type: 'finished' })
        return
      }
      const circle = createLegacyCircleInteraction(input, input.parent)
      receive(() => {
        void circle
          .dispose()
          .then(() => sendBack({ type: 'finished' }))
          .catch(reportRejection)
      })
      return () => {
        void circle.dispose().catch(reportRejection)
      }
    }),
  },
}).createMachine({
  id: 'Circle tool',
  context: ({ input }) => input,
  initial: 'active',
  states: {
    active: {
      invoke: {
        id: 'interaction',
        src: 'interaction',
        input: ({ context, self }) => ({ ...context, parent: self._parent }),
      },
      on: {
        escape: { actions: sendTo('interaction', { type: 'escape' }) },
        unequip: { actions: sendTo('interaction', { type: 'unequip' }) },
        finished: 'done',
      },
    },
    done: { type: 'final' },
  },
})
