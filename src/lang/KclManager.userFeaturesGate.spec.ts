import {
  UserFeaturesState,
  type UserFeaturesSettleService,
  type UserFeaturesSettleSnapshot,
} from '@src/machines/userFeaturesMachine'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { describe, expect, it, vi } from 'vitest'

/**
 * A user-features service whose settlement the test controls, standing in for
 * the network fetch that races the first execution in the real app.
 */
function createControllableUserFeatures() {
  const listeners = new Set<(snapshot: UserFeaturesSettleSnapshot) => void>()
  let isSettled = false
  const snapshot = (): UserFeaturesSettleSnapshot => ({
    matches: (state) => isSettled && state === UserFeaturesState.Ready,
    context: {},
  })
  const service: UserFeaturesSettleService = {
    actor: {
      getSnapshot: snapshot,
      subscribe: (listener) => {
        listeners.add(listener)
        return { unsubscribe: () => listeners.delete(listener) }
      },
    },
  }
  return {
    service,
    settle: () => {
      isSettled = true
      for (const listener of listeners) {
        listener(snapshot())
      }
    },
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('KclManager.executeCode user-features gate', () => {
  it('does not parse or execute until user features settle', async () => {
    const features = createControllableUserFeatures()
    const { kclManager } = await buildTheWorldAndNoEngineConnection(
      false,
      features.service
    )
    // Let the constructor's initial wasm-then chain (which parses the initial
    // code) finish before spying, so the spies only observe executeCode.
    await flush()

    kclManager.engineCommandManager.started = true
    const executeAstSpy = vi
      .spyOn(kclManager, 'executeAst')
      .mockResolvedValue(undefined)
    const safeParseSpy = vi.spyOn(kclManager, 'safeParse')

    const executed = kclManager.executeCode('x = 1')
    await flush()
    expect(safeParseSpy).not.toHaveBeenCalled()
    expect(executeAstSpy).not.toHaveBeenCalled()

    features.settle()
    await executed
    expect(safeParseSpy).toHaveBeenCalledTimes(1)
    expect(executeAstSpy).toHaveBeenCalledTimes(1)
  })

  it('executes immediately when user features are already settled', async () => {
    const features = createControllableUserFeatures()
    features.settle()
    const { kclManager } = await buildTheWorldAndNoEngineConnection(
      false,
      features.service
    )
    await flush()

    kclManager.engineCommandManager.started = true
    const executeAstSpy = vi
      .spyOn(kclManager, 'executeAst')
      .mockResolvedValue(undefined)

    await kclManager.executeCode('x = 1')
    expect(executeAstSpy).toHaveBeenCalledTimes(1)
  })
})
