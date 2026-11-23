import { createActor, fromPromise, waitFor } from 'xstate'
import { expect, it, vi } from 'vitest'
vi.mock('@src/lib/boot', () => ({
  app: {},
  useApp: vi.fn(),
  useSingletons: vi.fn(),
}))
import { modelingMachine } from '@src/machines/modelingMachine'
import { buildModelingMachineInput } from '@src/unitTestUtils'

it.each(['scene', 'document'] as const)(
  'waits for both legacy sketch cleanup tasks when %s finishes first',
  async (first) => {
    const scene = Promise.withResolvers<undefined>()
    const document = Promise.withResolvers<undefined>()
    const machine = modelingMachine.provide({
      actors: {
        sketchExit: fromPromise(async () => {
          await scene.promise
        }),
        'AST-undo-startSketchOn': fromPromise(() => document.promise),
      },
      actions: {
        'set modeling idle double-click callback': () => {},
        'restore modeling camera controls': () => {},
        'reset client scene mouse handlers': () => {},
        'hide default planes': () => {},
      },
    })
    const input = await buildModelingMachineInput()
    const initial = createActor(machine, { input }).getSnapshot()
    const actor = createActor(machine, {
      input,
      snapshot: machine.resolveState({
        value: { Sketch: { SketchIdle: 'scene drawn' } },
        context: initial.context,
      }),
    }).start()
    try {
      actor.send({ type: 'Cancel' })
      const completed = first === 'scene' ? scene : document
      const pending = first === 'scene' ? document : scene
      completed.resolve(undefined)
      await completed.promise
      await Promise.resolve(undefined)
      expect(actor.getSnapshot().matches('Sketch')).toBe(true)
      pending.resolve(undefined)
      await waitFor(actor, (snapshot) => snapshot.matches('idle'), {
        timeout: 1000,
      })
    } finally {
      scene.resolve(undefined)
      document.resolve(undefined)
      actor.stop()
    }
  }
)
