import { EventEmitter } from 'node:events'
import type {
  AppUpdater,
  UpdateCheckResult,
  UpdateDownloadedEvent,
} from 'electron-updater'
import { describe, expect, it, vi } from 'vitest'

import { DesktopUpdateController } from '@src/lib/desktopUpdateController'

const update: UpdateDownloadedEvent = {
  version: '2.0.0',
  files: [],
  releaseDate: '2026-09-22T00:00:00.000Z',
  releaseNotes: 'Update fixes',
  downloadedFile: '/tmp/update.zip',
  path: 'update.zip',
  sha512: 'checksum',
}

function updateResult(
  downloadPromise = Promise.resolve<string[]>([])
): UpdateCheckResult {
  return {
    isUpdateAvailable: true,
    updateInfo: update,
    versionInfo: update,
    downloadPromise,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createUpdater() {
  return Object.assign(new EventEmitter(), {
    checkForUpdates: vi
      .fn<AppUpdater['checkForUpdates']>()
      .mockImplementation(async () => updateResult()),
    quitAndInstall: vi.fn<AppUpdater['quitAndInstall']>(),
  })
}

describe('DesktopUpdateController', () => {
  it('keeps one macOS update through checking, download, native staging, ready, and install', async () => {
    const updater = createUpdater()
    const nativeUpdater = new EventEmitter()
    const controller = new DesktopUpdateController(updater, nativeUpdater)
    const downloaded = vi.fn()
    controller.on('update-downloaded', downloaded)
    const check = deferred<UpdateCheckResult>()
    const download = deferred<string[]>()
    updater.checkForUpdates.mockReturnValueOnce(check.promise)

    const checking = controller.checkForUpdates()
    expect(controller.checkForUpdates()).toBe(checking)
    await Promise.resolve()
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()

    check.resolve(updateResult(download.promise))
    updater.emit('update-available', update)
    expect(controller.checkForUpdates()).toBe(checking)
    updater.emit('update-downloaded', update)
    expect(downloaded).not.toHaveBeenCalled()
    expect(controller.install()).toBeInstanceOf(Error)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()

    // The ZIP transfer finishes before Squirrel verifies and stages the app.
    download.resolve([])
    await checking
    await controller.checkForUpdates()
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
    expect(downloaded).not.toHaveBeenCalled()
    expect(controller.install()).toBeInstanceOf(Error)

    nativeUpdater.emit('update-downloaded')
    nativeUpdater.emit('update-downloaded')
    updater.emit('update-downloaded', update)
    expect(downloaded).toHaveBeenCalledExactlyOnceWith(update)
    await controller.checkForUpdates()
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()

    const prepare = vi.fn(() => vi.fn())
    expect(controller.install(prepare)).toBeUndefined()
    expect(controller.isInstalling).toBe(true)
    expect(controller.install(prepare)).toBeUndefined()
    await controller.checkForUpdates()
    expect(updater.quitAndInstall).toHaveBeenCalledOnce()
    expect(prepare).toHaveBeenCalledOnce()
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
  })

  it('accepts either event order while requiring both macOS readiness signals', async () => {
    const updater = createUpdater()
    const nativeUpdater = new EventEmitter()
    const controller = new DesktopUpdateController(updater, nativeUpdater)
    const downloaded = vi.fn()
    controller.on('update-downloaded', downloaded)
    await controller.checkForUpdates()

    nativeUpdater.emit('update-downloaded')
    expect(downloaded).not.toHaveBeenCalled()
    expect(controller.install()).toBeInstanceOf(Error)
    updater.emit('update-downloaded', update)

    expect(downloaded).toHaveBeenCalledExactlyOnceWith(update)
    expect(controller.install()).toBeUndefined()
    expect(updater.quitAndInstall).toHaveBeenCalledOnce()
  })

  it('uses wrapper readiness on platforms without native macOS staging', async () => {
    const updater = createUpdater()
    const controller = new DesktopUpdateController(updater)
    const downloaded = vi.fn()
    controller.on('update-downloaded', downloaded)
    await controller.checkForUpdates()

    updater.emit('update-downloaded', update)
    expect(downloaded).toHaveBeenCalledExactlyOnceWith(update)
    expect(controller.install()).toBeUndefined()
    expect(updater.quitAndInstall).toHaveBeenCalledOnce()
  })

  it('restores a failed install and requires fresh native readiness before retrying', async () => {
    const updater = createUpdater()
    const nativeUpdater = new EventEmitter()
    const controller = new DesktopUpdateController(updater, nativeUpdater)
    const downloaded = vi.fn()
    const failed = vi.fn()
    controller.on('update-downloaded', downloaded)
    controller.on('update-error', failed)
    await controller.checkForUpdates()
    updater.emit('update-downloaded', update)
    nativeUpdater.emit('update-downloaded')
    const restore = vi.fn()
    controller.install(() => restore)

    const error = new Error('The staged app could not be installed')
    updater.emit('error', error)
    expect(controller.isInstalling).toBe(false)
    expect(restore).toHaveBeenCalledOnce()
    expect(failed).toHaveBeenCalledExactlyOnceWith(error)
    expect(controller.install()).toBeInstanceOf(Error)

    // Completion from a failed attempt cannot preserve its old ready flag.
    nativeUpdater.emit('update-downloaded')
    updater.emit('update-downloaded', update)
    await controller.checkForUpdates()
    updater.emit('update-downloaded', update)
    expect(controller.install()).toBeInstanceOf(Error)
    expect(downloaded).toHaveBeenCalledOnce()
    expect(updater.quitAndInstall).toHaveBeenCalledOnce()

    nativeUpdater.emit('update-downloaded')
    expect(downloaded).toHaveBeenCalledTimes(2)
    expect(controller.install()).toBeUndefined()
    expect(controller.isInstalling).toBe(true)
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(2)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('restores lifecycle behavior when quitAndInstall throws synchronously', async () => {
    const updater = createUpdater()
    const controller = new DesktopUpdateController(updater)
    const failed = vi.fn()
    controller.on('update-error', failed)
    await controller.checkForUpdates()
    updater.emit('update-downloaded', update)
    const error = new Error('Install could not start')
    updater.quitAndInstall.mockImplementationOnce(() => {
      throw error
    })
    const restore = vi.fn()

    expect(controller.install(() => restore)).toBe(error)
    expect(controller.isInstalling).toBe(false)
    expect(restore).toHaveBeenCalledOnce()
    expect(failed).toHaveBeenCalledExactlyOnceWith(error)
    await controller.checkForUpdates()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('recovers when preparing installation throws', async () => {
    const updater = createUpdater()
    const controller = new DesktopUpdateController(updater)
    const failed = vi.fn()
    controller.on('update-error', failed)
    await controller.checkForUpdates()
    updater.emit('update-downloaded', update)
    const error = new Error('Could not prepare install')

    expect(
      controller.install(() => {
        throw error
      })
    ).toBe(error)
    expect(controller.isInstalling).toBe(false)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    expect(failed).toHaveBeenCalledExactlyOnceWith(error)
    await controller.checkForUpdates()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('returns synchronous emitted install errors and restores the attempt', async () => {
    const updater = createUpdater()
    const controller = new DesktopUpdateController(updater)
    const failed = vi.fn()
    controller.on('update-error', failed)
    await controller.checkForUpdates()
    updater.emit('update-downloaded', update)
    const error = new Error('Installer could not start')
    updater.quitAndInstall.mockImplementationOnce(() => {
      updater.emit('error', error)
    })
    const restore = vi.fn()

    expect(controller.install(() => restore)).toBe(error)
    expect(controller.isInstalling).toBe(false)
    expect(restore).toHaveBeenCalledOnce()
    expect(failed).toHaveBeenCalledExactlyOnceWith(error)
  })

  it.each([
    ['no update', { ...updateResult(), isUpdateAvailable: false }],
    ['disabled updater', null],
  ] as const)('permits later checks after %s', async (_label, result) => {
    const updater = createUpdater()
    updater.checkForUpdates.mockResolvedValue(result)
    const controller = new DesktopUpdateController(updater)

    await controller.checkForUpdates()
    await controller.checkForUpdates()

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(controller.install()).toBeInstanceOf(Error)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'observes download rejection and reports it once (also emitted: %s)',
    async (emitError) => {
      const updater = createUpdater()
      const download = deferred<string[]>()
      updater.checkForUpdates.mockResolvedValueOnce(
        updateResult(download.promise)
      )
      const controller = new DesktopUpdateController(updater)
      const failed = vi.fn()
      controller.on('update-error', failed)
      const error = new Error('Archive transfer failed')
      const completion = expect(controller.checkForUpdates()).rejects.toBe(
        error
      )
      await Promise.resolve()

      if (emitError) updater.emit('error', error)
      download.reject(error)
      await completion

      expect(failed).toHaveBeenCalledExactlyOnceWith(error)
      expect(controller.install()).toBeInstanceOf(Error)
      await controller.checkForUpdates()
      expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
    }
  )
})
