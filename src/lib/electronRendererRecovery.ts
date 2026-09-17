import type { ElectronProcessGoneReason } from '@src/lib/electronLifecycle'

const AUTOMATIC_RELOAD_REASONS = new Set<ElectronProcessGoneReason>([
  'abnormal-exit',
  'killed',
  'crashed',
  'oom',
])

export type ElectronRendererRecoveryAction = 'restart' | 'quit' | 'dismiss'

export type ElectronRendererRecoveryTarget = {
  id: number
  isDestroyed: () => boolean
  webContents: {
    id: number
    isDestroyed: () => boolean
  }
}

export type ElectronRendererRecoveryLog = {
  action:
    | 'automatic-reload-scheduled'
    | 'automatic-reload-started'
    | 'manual-recovery-scheduled'
    | 'manual-recovery-shown'
    | 'manual-recovery-action'
    | 'recovery-abandoned'
    | 'recovery-failed'
    | 'recovery-suppressed'
  error?: unknown
  reason: ElectronProcessGoneReason
  recoveryAction?: ElectronRendererRecoveryAction
  windowId: number
  webContentsId: number
}

type ElectronRendererRecoveryOptions<
  Target extends ElectronRendererRecoveryTarget,
> = {
  canRecover: () => boolean
  defer: (callback: () => void) => void
  log?: (event: ElectronRendererRecoveryLog) => void
  prompt: (
    reason: ElectronProcessGoneReason
  ) => Promise<ElectronRendererRecoveryAction>
  quitApp: () => void
  reload: (target: Target) => void
  restartApp: () => void
}

type ElectronRendererRecoveryState = {
  automaticReloadAttempted: boolean
  manualRecoveryOffered: boolean
  reloadPending: boolean
}

/**
 * Recovers top-level Electron windows without reacting synchronously inside
 * `render-process-gone`. Electron 40 can crash its browser process when a
 * reload or navigation re-enters Chromium from that callback.
 */
export class ElectronRendererRecovery<
  Target extends
    ElectronRendererRecoveryTarget = ElectronRendererRecoveryTarget,
> {
  private readonly states = new WeakMap<Target, ElectronRendererRecoveryState>()
  private promptPending = false
  private stopped = false

  constructor(
    private readonly options: ElectronRendererRecoveryOptions<Target>
  ) {}

  handleRenderProcessGone(target: Target, reason: ElectronProcessGoneReason) {
    if (reason === 'clean-exit' || !this.canUseTarget(target)) {
      return
    }

    const state = this.getState(target)
    if (state.reloadPending || state.manualRecoveryOffered) {
      this.log(target, reason, 'recovery-suppressed')
      return
    }

    if (
      AUTOMATIC_RELOAD_REASONS.has(reason) &&
      !state.automaticReloadAttempted
    ) {
      this.scheduleAutomaticReload(target, reason, state)
      return
    }

    this.scheduleManualRecovery(target, reason, state)
  }

  stop() {
    this.stopped = true
  }

  private getState(target: Target) {
    let state = this.states.get(target)
    if (!state) {
      state = {
        automaticReloadAttempted: false,
        manualRecoveryOffered: false,
        reloadPending: false,
      }
      this.states.set(target, state)
    }
    return state
  }

  private canUseTarget(target: Target) {
    return (
      this.canRecover() &&
      !target.isDestroyed() &&
      !target.webContents.isDestroyed()
    )
  }

  private canRecover() {
    return !this.stopped && this.options.canRecover()
  }

  private scheduleAutomaticReload(
    target: Target,
    reason: ElectronProcessGoneReason,
    state: ElectronRendererRecoveryState
  ) {
    state.automaticReloadAttempted = true
    state.reloadPending = true
    this.log(target, reason, 'automatic-reload-scheduled')

    const scheduled = this.defer(target, reason, () => {
      state.reloadPending = false
      if (!this.canUseTarget(target)) {
        this.log(target, reason, 'recovery-abandoned')
        return
      }

      try {
        this.log(target, reason, 'automatic-reload-started')
        this.options.reload(target)
      } catch (error) {
        this.log(target, reason, 'recovery-failed', { error })
        this.scheduleManualRecovery(target, reason, state)
      }
    })

    if (!scheduled) {
      state.reloadPending = false
      this.scheduleManualRecovery(target, reason, state)
    }
  }

  private scheduleManualRecovery(
    target: Target,
    reason: ElectronProcessGoneReason,
    state: ElectronRendererRecoveryState
  ) {
    if (state.manualRecoveryOffered || this.promptPending) {
      this.log(target, reason, 'recovery-suppressed')
      return
    }

    state.manualRecoveryOffered = true
    this.promptPending = true
    this.log(target, reason, 'manual-recovery-scheduled')

    const scheduled = this.defer(target, reason, () => {
      // The fallback is deliberately app-wide: it can still help when the
      // originating window disappears, and one prompt covers concurrent
      // renderer failures in multiple windows.
      if (!this.canRecover()) {
        this.promptPending = false
        this.log(target, reason, 'recovery-abandoned')
        return
      }

      this.log(target, reason, 'manual-recovery-shown')
      this.options
        .prompt(reason)
        .then((recoveryAction) => {
          this.log(target, reason, 'manual-recovery-action', {
            recoveryAction,
          })
          if (!this.canRecover()) {
            return
          }

          if (recoveryAction === 'restart') {
            this.stop()
            this.options.restartApp()
          } else if (recoveryAction === 'quit') {
            this.stop()
            this.options.quitApp()
          }
        })
        .catch((error) => {
          this.log(target, reason, 'recovery-failed', { error })
        })
        .finally(() => {
          this.promptPending = false
        })
    })

    if (!scheduled) {
      state.manualRecoveryOffered = false
      this.promptPending = false
    }
  }

  private defer(
    target: Target,
    reason: ElectronProcessGoneReason,
    callback: () => void
  ) {
    try {
      this.options.defer(callback)
      return true
    } catch (error) {
      this.log(target, reason, 'recovery-failed', { error })
      return false
    }
  }

  private log(
    target: Target,
    reason: ElectronProcessGoneReason,
    action: ElectronRendererRecoveryLog['action'],
    extra?: Pick<ElectronRendererRecoveryLog, 'error' | 'recoveryAction'>
  ) {
    this.options.log?.({
      action,
      reason,
      windowId: target.id,
      webContentsId: target.webContents.id,
      ...extra,
    })
  }
}
