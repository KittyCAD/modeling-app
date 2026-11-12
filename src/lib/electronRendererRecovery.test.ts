import type { ElectronProcessGoneReason } from '@src/lib/electronLifecycle'
import {
  ElectronRendererRecovery,
  type ElectronRendererRecoveryAction,
  type ElectronRendererRecoveryTarget,
} from '@src/lib/electronRendererRecovery'
import { describe, expect, it, vi } from 'vitest'

type FakeRecoveryTarget = ElectronRendererRecoveryTarget & {
  destroyed: boolean
  rendererDestroyed: boolean
}

const createTarget = (id = 1): FakeRecoveryTarget => {
  const target: FakeRecoveryTarget = {
    destroyed: false,
    id,
    isDestroyed: () => target.destroyed,
    rendererDestroyed: false,
    webContents: {
      id: id + 100,
      isDestroyed: () => target.rendererDestroyed,
    },
  }
  return target
}

const createHarness = () => {
  const deferred: Array<() => void> = []
  let canRecover = true
  const log = vi.fn()
  const prompt = vi.fn(
    async (): Promise<ElectronRendererRecoveryAction> => 'dismiss'
  )
  const quitApp = vi.fn()
  const reload = vi.fn()
  const restartApp = vi.fn()
  const recovery = new ElectronRendererRecovery<FakeRecoveryTarget>({
    canRecover: () => canRecover,
    defer: (callback) => deferred.push(callback),
    log,
    prompt,
    quitApp,
    reload,
    restartApp,
  })

  const flushDeferred = async () => {
    while (deferred.length > 0) {
      deferred.shift()?.()
      await Promise.resolve()
    }
    await Promise.resolve()
    await Promise.resolve()
  }

  return {
    deferred,
    flushDeferred,
    log,
    prompt,
    quitApp,
    recovery,
    reload,
    restartApp,
    setCanRecover: (nextCanRecover: boolean) => {
      canRecover = nextCanRecover
    },
  }
}

describe('ElectronRendererRecovery', () => {
  it('defers the first automatic reload off the process-gone callback stack', async () => {
    const harness = createHarness()
    const target = createTarget()

    harness.recovery.handleRenderProcessGone(target, 'crashed')

    expect(harness.reload).not.toHaveBeenCalled()
    expect(harness.prompt).not.toHaveBeenCalled()
    expect(harness.deferred).toHaveLength(1)

    await harness.flushDeferred()

    expect(harness.reload).toHaveBeenCalledOnce()
    expect(harness.reload).toHaveBeenCalledWith(target)
  })

  it('coalesces duplicate exit notifications before the deferred reload', async () => {
    const harness = createHarness()
    const target = createTarget()

    harness.recovery.handleRenderProcessGone(target, 'crashed')
    harness.recovery.handleRenderProcessGone(target, 'crashed')

    expect(harness.deferred).toHaveLength(1)
    await harness.flushDeferred()

    expect(harness.reload).toHaveBeenCalledOnce()
    expect(harness.prompt).not.toHaveBeenCalled()
  })

  it('offers manual recovery once after the automatic reload was used', async () => {
    const harness = createHarness()
    const target = createTarget()

    harness.recovery.handleRenderProcessGone(target, 'crashed')
    await harness.flushDeferred()
    harness.recovery.handleRenderProcessGone(target, 'crashed')

    expect(harness.prompt).not.toHaveBeenCalled()
    expect(harness.deferred).toHaveLength(1)
    await harness.flushDeferred()

    expect(harness.reload).toHaveBeenCalledOnce()
    expect(harness.prompt).toHaveBeenCalledOnce()
    expect(harness.prompt).toHaveBeenCalledWith('crashed')

    harness.recovery.handleRenderProcessGone(target, 'crashed')
    await harness.flushDeferred()
    expect(harness.prompt).toHaveBeenCalledOnce()
  })

  it.each(['launch-failed', 'integrity-failure', 'memory-eviction'] as const)(
    'sends %s directly to deferred manual recovery',
    async (reason) => {
      const harness = createHarness()
      const target = createTarget()

      harness.recovery.handleRenderProcessGone(target, reason)

      expect(harness.reload).not.toHaveBeenCalled()
      expect(harness.prompt).not.toHaveBeenCalled()
      await harness.flushDeferred()

      expect(harness.reload).not.toHaveBeenCalled()
      expect(harness.prompt).toHaveBeenCalledWith(reason)
    }
  )

  it('gives each window one automatic reload budget', async () => {
    const harness = createHarness()
    const firstTarget = createTarget(1)
    const secondTarget = createTarget(2)

    harness.recovery.handleRenderProcessGone(firstTarget, 'oom')
    harness.recovery.handleRenderProcessGone(secondTarget, 'oom')
    await harness.flushDeferred()

    expect(harness.reload).toHaveBeenCalledTimes(2)
    expect(harness.reload).toHaveBeenCalledWith(firstTarget)
    expect(harness.reload).toHaveBeenCalledWith(secondTarget)
  })

  it('uses one app-wide recovery prompt for simultaneous failures', async () => {
    const harness = createHarness()
    const firstTarget = createTarget(1)
    const secondTarget = createTarget(2)
    let resolvePrompt:
      | ((action: ElectronRendererRecoveryAction) => void)
      | undefined
    harness.prompt.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePrompt = resolve
        })
    )

    harness.recovery.handleRenderProcessGone(firstTarget, 'crashed')
    harness.recovery.handleRenderProcessGone(secondTarget, 'crashed')
    await harness.flushDeferred()
    harness.recovery.handleRenderProcessGone(firstTarget, 'crashed')
    harness.recovery.handleRenderProcessGone(secondTarget, 'crashed')
    await harness.flushDeferred()

    expect(harness.prompt).toHaveBeenCalledOnce()
    resolvePrompt?.('dismiss')
    await Promise.resolve()
  })

  it('can show app-wide recovery after the originating window disappears', async () => {
    const harness = createHarness()
    const target = createTarget()

    harness.recovery.handleRenderProcessGone(target, 'launch-failed')
    target.destroyed = true
    target.rendererDestroyed = true
    await harness.flushDeferred()

    expect(harness.prompt).toHaveBeenCalledOnce()
  })

  it('abandons deferred recovery when shutdown or destruction starts', async () => {
    const shutdownHarness = createHarness()
    const shutdownTarget = createTarget(1)
    shutdownHarness.recovery.handleRenderProcessGone(shutdownTarget, 'crashed')
    shutdownHarness.setCanRecover(false)
    await shutdownHarness.flushDeferred()
    expect(shutdownHarness.reload).not.toHaveBeenCalled()

    const destroyedHarness = createHarness()
    const destroyedTarget = createTarget(2)
    destroyedHarness.recovery.handleRenderProcessGone(
      destroyedTarget,
      'crashed'
    )
    destroyedTarget.rendererDestroyed = true
    await destroyedHarness.flushDeferred()
    expect(destroyedHarness.reload).not.toHaveBeenCalled()
  })

  it('falls back to manual recovery when the automatic reload throws', async () => {
    const harness = createHarness()
    const target = createTarget()
    harness.reload.mockImplementation(() => {
      throw new Error('reload failed')
    })

    harness.recovery.handleRenderProcessGone(target, 'crashed')
    await harness.flushDeferred()

    expect(harness.reload).toHaveBeenCalledOnce()
    expect(harness.prompt).toHaveBeenCalledOnce()
    expect(harness.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recovery-failed',
        error: expect.any(Error),
      })
    )
  })

  it.each([
    ['restart', 'restartApp'],
    ['quit', 'quitApp'],
  ] as const)(
    'runs the %s action selected in the native prompt',
    async (action, expectedCallback) => {
      const harness = createHarness()
      const target = createTarget()
      harness.prompt.mockResolvedValue(action)

      harness.recovery.handleRenderProcessGone(target, 'launch-failed')
      await harness.flushDeferred()

      expect(harness[expectedCallback]).toHaveBeenCalledOnce()
    }
  )

  it('contains a rejected native prompt and ignores clean exits', async () => {
    const harness = createHarness()
    const target = createTarget()
    harness.prompt.mockRejectedValue(new Error('dialog failed'))

    harness.recovery.handleRenderProcessGone(target, 'clean-exit')
    expect(harness.deferred).toHaveLength(0)

    harness.recovery.handleRenderProcessGone(
      target,
      'launch-failed' satisfies ElectronProcessGoneReason
    )
    await harness.flushDeferred()

    expect(harness.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recovery-failed',
        error: expect.any(Error),
      })
    )
  })

  it('can be stopped before deferred recovery runs', async () => {
    const harness = createHarness()
    const target = createTarget()

    harness.recovery.handleRenderProcessGone(target, 'crashed')
    harness.recovery.stop()
    await harness.flushDeferred()

    expect(harness.reload).not.toHaveBeenCalled()
    expect(harness.prompt).not.toHaveBeenCalled()
  })
})
