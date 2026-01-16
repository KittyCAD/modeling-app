import { describe, it, expect } from 'vitest'
import { createActor, waitFor, fromPromise } from 'xstate'
import { machine } from '@src/machines/sketchSolve/tools/rectTool'
import type { RectDraftIds } from '@src/machines/sketchSolve/tools/rectUtils'
import type {
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  createSceneGraphDelta,
  createMockSceneInfra,
  createMockRustContext,
  createMockKclManager,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'

function createTestMachine(mockActors?: {
  modAndSolveFirstClick?: (input: unknown) => Promise<
    | {
        kclSource: SourceDelta
        sceneGraphDelta: SceneGraphDelta
        draft: RectDraftIds
      }
    | { error: string }
  >
}) {
  const sceneInfra = createMockSceneInfra()
  const rustContext = createMockRustContext()
  const kclManager = createMockKclManager()

  const testMachine = machine.provide({
    actors: {
      modAndSolveFirstClick: fromPromise(
        mockActors?.modAndSolveFirstClick ||
          (async () => ({
            kclSource: { text: 'test' } as SourceDelta,
            sceneGraphDelta: createSceneGraphDelta([], []),
            draft: {
              lineIds: [1, 2, 3, 4],
              segmentIds: [1, 2, 3, 4],
              constraintIds: [10],
            },
          }))
      ),
    },
  })

  return {
    machine: testMachine,
    sceneInfra,
    rustContext,
    kclManager,
  }
}

describe('rectTool - XState', () => {
  describe('when initialized', () => {
    it('should have default context values', () => {
      const { machine, sceneInfra, rustContext, kclManager } =
        createTestMachine()
      const actor = createActor(machine, {
        input: {
          sceneInfra,
          rustContext,
          kclManager,
          sketchId: 0,
        },
      }).start()

      const context = actor.getSnapshot().context
      expect(context.origin).toEqual([0, 0])
      expect(context.rectOriginMode).toBe('corner')
      expect(context.sketchId).toBe(0)
      actor.stop()
    })

    it('should use center origin mode when toolVariant is center', () => {
      const { machine, sceneInfra, rustContext, kclManager } =
        createTestMachine()
      const actor = createActor(machine, {
        input: {
          sceneInfra,
          rustContext,
          kclManager,
          sketchId: 0,
          toolVariant: 'center',
        },
      }).start()

      const context = actor.getSnapshot().context
      expect(context.rectOriginMode).toBe('center')
      actor.stop()
    })

    it('should call setCallbacks on entry to awaiting first point', () => {
      const { machine, sceneInfra, rustContext, kclManager } =
        createTestMachine()
      const actor = createActor(machine, {
        input: {
          sceneInfra,
          rustContext,
          kclManager,
          sketchId: 0,
        },
      }).start()

      expect(sceneInfra.setCallbacks).toHaveBeenCalled()
      actor.stop()
    })
  })

  describe('adding points', () => {
    it('should transition to awaiting second point after first click', async () => {
      const { machine, sceneInfra, rustContext, kclManager } =
        createTestMachine()
      const actor = createActor(machine, {
        input: {
          sceneInfra,
          rustContext,
          kclManager,
          sketchId: 0,
        },
      }).start()

      actor.send({ type: 'add point', data: [1, 2] })

      await waitFor(actor, (state) => state.matches('awaiting second point'))
      expect(actor.getSnapshot().context.draft).toBeDefined()
      actor.stop()
    })
  })

  describe('escape handling', () => {
    it('should return to awaiting first point on escape after first click', async () => {
      const { machine, sceneInfra, rustContext, kclManager } =
        createTestMachine()
      const actor = createActor(machine, {
        input: {
          sceneInfra,
          rustContext,
          kclManager,
          sketchId: 0,
        },
      }).start()

      actor.send({ type: 'add point', data: [1, 2] })
      await waitFor(actor, (state) => state.matches('awaiting second point'))

      actor.send({ type: 'escape' })
      await waitFor(actor, (state) => state.matches('awaiting first point'))

      const context = actor.getSnapshot().context
      expect(context.origin).toEqual([0, 0])
      expect(context.draft).toBeUndefined()
      actor.stop()
    })
  })

  describe('finalize handling', () => {
    it('should clear draft and return to awaiting first point', async () => {
      const { machine, sceneInfra, rustContext, kclManager } =
        createTestMachine()
      const actor = createActor(machine, {
        input: {
          sceneInfra,
          rustContext,
          kclManager,
          sketchId: 0,
        },
      }).start()

      actor.send({ type: 'add point', data: [1, 2] })
      await waitFor(actor, (state) => state.matches('awaiting second point'))

      actor.send({ type: 'finalize' })
      await waitFor(actor, (state) => state.matches('awaiting first point'))

      const context = actor.getSnapshot().context
      expect(context.origin).toEqual([0, 0])
      expect(context.draft).toBeUndefined()
      actor.stop()
    })
  })
})
