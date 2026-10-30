import { EventEmitter } from 'node:events'
import type { App, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return { autoUpdater: new EventEmitter() }
})

import { prepareMacUpdateInstall } from '@src/lib/macUpdateInstall'

function createApp() {
  return Object.assign(new EventEmitter(), { exit: vi.fn() })
}

function createWindow() {
  return Object.assign(new EventEmitter(), {
    isDestroyed: vi.fn(() => false),
  })
}

beforeEach(() => {
  autoUpdater.removeAllListeners()
})

describe('prepareMacUpdateInstall', () => {
  it('saves window bounds before removing close listeners', () => {
    const browserWindow = createWindow()
    browserWindow.on('close', vi.fn())
    const saveWindowBounds = vi.fn(() => {
      expect(browserWindow.listenerCount('close')).toBe(1)
    })

    prepareMacUpdateInstall(
      createApp() as unknown as App,
      [browserWindow as unknown as BrowserWindow],
      saveWindowBounds
    )

    expect(saveWindowBounds).toHaveBeenCalledWith(browserWindow)
    expect(browserWindow.listenerCount('close')).toBe(0)
  })

  it('runs existing quit cleanup before forcing the update exit', () => {
    const calls: string[] = []
    const beforeQuitListener = vi.fn(() => calls.push('before quit cleanup'))
    const app = createApp()
    app.exit.mockImplementation(() => calls.push('exit'))
    app.on('before-quit', beforeQuitListener)

    prepareMacUpdateInstall(app as unknown as App, [], vi.fn())
    autoUpdater.emit('before-quit-for-update')

    expect(app.listenerCount('before-quit')).toBe(0)
    expect(beforeQuitListener).toHaveBeenCalledOnce()
    expect(app.exit).toHaveBeenCalledOnce()
    expect(calls).toEqual(['before quit cleanup', 'exit'])
  })

  it('restores close and quit behavior after a failed install without duplicating listeners', () => {
    const app = createApp()
    const browserWindow = createWindow()
    const beforeQuit = vi.fn()
    const close = vi.fn()
    const otherNativeListener = vi.fn()
    app.on('before-quit', beforeQuit)
    browserWindow.on('close', close)
    autoUpdater.on('before-quit-for-update', otherNativeListener)

    const restore = prepareMacUpdateInstall(
      app as unknown as App,
      [browserWindow as unknown as BrowserWindow],
      vi.fn()
    )
    expect(app.listenerCount('before-quit')).toBe(0)
    expect(browserWindow.listenerCount('close')).toBe(0)

    restore()
    restore()
    app.emit('before-quit')
    browserWindow.emit('close')
    autoUpdater.emit('before-quit-for-update')

    expect(beforeQuit).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    expect(otherNativeListener).toHaveBeenCalledOnce()
    expect(app.exit).not.toHaveBeenCalled()
  })

  it('preserves once listeners when a failed install is retried', () => {
    const app = createApp()
    const browserWindow = createWindow()
    const beforeQuit = vi.fn()
    const close = vi.fn()
    app.once('before-quit', beforeQuit)
    browserWindow.once('close', close)

    for (let attempt = 0; attempt < 2; attempt++) {
      const restore = prepareMacUpdateInstall(
        app as unknown as App,
        [browserWindow as unknown as BrowserWindow],
        vi.fn()
      )
      restore()
    }
    app.emit('before-quit')
    app.emit('before-quit')
    browserWindow.emit('close')
    browserWindow.emit('close')

    expect(beforeQuit).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    expect(app.listenerCount('before-quit')).toBe(0)
    expect(browserWindow.listenerCount('close')).toBe(0)
    expect(autoUpdater.listenerCount('before-quit-for-update')).toBe(0)
  })

  it('skips windows destroyed before preparation or during a failed install', () => {
    const alreadyDestroyed = createWindow()
    alreadyDestroyed.isDestroyed.mockReturnValue(true)
    const browserWindow = createWindow()
    browserWindow.on('close', vi.fn())
    const saveWindowBounds = vi.fn()

    const restore = prepareMacUpdateInstall(
      createApp() as unknown as App,
      [alreadyDestroyed, browserWindow] as unknown as BrowserWindow[],
      saveWindowBounds
    )
    browserWindow.isDestroyed.mockReturnValue(true)
    restore()

    expect(saveWindowBounds).toHaveBeenCalledExactlyOnceWith(browserWindow)
    expect(browserWindow.listenerCount('close')).toBe(0)
  })
})
