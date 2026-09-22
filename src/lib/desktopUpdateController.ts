import { EventEmitter } from 'node:events'
import { isErr } from '@src/lib/trap'
import type { AppUpdater, UpdateDownloadedEvent } from 'electron-updater'

interface UpdateSource {
  checkForUpdates: AppUpdater['checkForUpdates']
  quitAndInstall: AppUpdater['quitAndInstall']
  on(
    event: 'update-downloaded',
    listener: (info: UpdateDownloadedEvent) => void
  ): void
  on(event: 'error', listener: (error: Error) => void): void
}

interface NativeUpdateSource {
  on(event: 'update-downloaded', listener: () => void): void
}

interface UpdateAttempt {
  info?: UpdateDownloadedEvent
  nativeReady: boolean
  ready: boolean
  installing: boolean
  restore?: () => void
  error?: Error
}

/** Own one update through download, native staging, and installation. */
export class DesktopUpdateController extends EventEmitter<{
  'update-downloaded': [UpdateDownloadedEvent]
  'update-error': [Error]
}> {
  private attempt?: UpdateAttempt
  private checkPromise?: Promise<void>

  constructor(
    private readonly updater: UpdateSource,
    private readonly nativeUpdater?: NativeUpdateSource
  ) {
    super()
    updater.on('update-downloaded', (info) => {
      if (!this.attempt) return
      this.attempt.info = info
      this.publishReady()
    })
    updater.on('error', (error) => this.fail(error))
    nativeUpdater?.on('update-downloaded', () => {
      if (!this.attempt) return
      this.attempt.nativeReady = true
      this.publishReady()
    })
  }

  get isInstalling() {
    return this.attempt?.installing ?? false
  }

  checkForUpdates(): Promise<void> {
    if (this.checkPromise) return this.checkPromise
    // MacUpdater recreates Squirrel on every check, even for a cached ZIP.
    // That can delete the staged bundle while its old ready flag remains set.
    if (this.attempt) {
      // A newly opened window may have missed the original notification.
      if (this.attempt.ready && !this.attempt.installing && this.attempt.info) {
        this.emit('update-downloaded', this.attempt.info)
      }
      return Promise.resolve()
    }

    const attempt: UpdateAttempt = {
      nativeReady: false,
      ready: false,
      installing: false,
    }
    this.attempt = attempt
    const checkPromise = Promise.resolve()
      .then(() => this.updater.checkForUpdates())
      .then(async (result) => {
        // Checking resolves before downloading. On macOS even downloadPromise
        // resolves before native staging, so readiness belongs to the events.
        await result?.downloadPromise
        if (
          this.attempt === attempt &&
          (!result || !result.isUpdateAvailable)
        ) {
          this.attempt = undefined
        }
      })
      .catch((reason: unknown) => {
        const error = isErr(reason) ? reason : new Error(String(reason))
        // The updater also emits errors. Do not report the same failure twice
        // or let an old promise clear a later attempt.
        if (this.attempt === attempt) this.fail(error)
        return Promise.reject(error)
      })
      .finally(() => {
        if (this.checkPromise === checkPromise) this.checkPromise = undefined
      })
    this.checkPromise = checkPromise
    return checkPromise
  }

  install(prepare?: () => () => void): Error | undefined {
    const attempt = this.attempt
    if (attempt?.installing) return
    if (!attempt?.ready) return new Error('The update is not ready to install.')

    attempt.installing = true
    try {
      attempt.restore = prepare?.()
      this.updater.quitAndInstall()
      // Some platform updaters emit an error synchronously without throwing.
      return attempt.error
    } catch (reason) {
      const error = isErr(reason) ? reason : new Error(String(reason))
      this.fail(error)
      return error
    }
  }

  private publishReady() {
    const attempt = this.attempt
    if (
      !attempt?.info ||
      attempt.ready ||
      (this.nativeUpdater && !attempt.nativeReady)
    ) {
      return
    }
    attempt.ready = true
    this.emit('update-downloaded', attempt.info)
  }

  private fail(error: Error) {
    const attempt = this.attempt
    if (!attempt) return
    attempt.error = error
    this.attempt = undefined
    try {
      attempt.restore?.()
    } catch (restoreError) {
      console.error(
        'Failed to restore update lifecycle listeners',
        restoreError
      )
    }
    this.emit('update-error', error)
  }
}
