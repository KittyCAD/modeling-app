import { EventEmitter } from 'node:events'
import type { App, BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  nativeUpdaterOnce: vi.fn(),
}))

vi.mock('electron', () => ({
  autoUpdater: {
    once: electronMocks.nativeUpdaterOnce,
  },
}))

import { prepareMacUpdateInstall } from '@src/lib/macUpdateInstall'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('prepareMacUpdateInstall', () => {
  it('saves window bounds before removing close listeners', () => {
    const calls: string[] = []
    const browserWindow = {
      removeAllListeners: vi.fn(() => calls.push('remove close listeners')),
    }
    const saveWindowBounds = vi.fn(() => calls.push('save window bounds'))
    const app = {
      exit: vi.fn(),
      listeners: vi.fn(() => []),
      removeAllListeners: vi.fn(),
    } as unknown as App

    prepareMacUpdateInstall(
      app,
      [browserWindow as unknown as BrowserWindow],
      saveWindowBounds
    )

    expect(saveWindowBounds).toHaveBeenCalledWith(browserWindow)
    expect(browserWindow.removeAllListeners).toHaveBeenCalledWith('close')
    expect(calls).toEqual(['save window bounds', 'remove close listeners'])
  })

  it('runs existing quit cleanup before forcing the update exit', () => {
    const calls: string[] = []
    const beforeQuitListener = vi.fn(() => calls.push('before quit cleanup'))
    const exit = vi.fn(() => calls.push('exit'))
    const app = Object.assign(new EventEmitter(), { exit })
    app.on('before-quit', beforeQuitListener)
    let beforeQuitForUpdate: (() => void) | undefined
    electronMocks.nativeUpdaterOnce.mockImplementationOnce(
      (eventName: string, listener: () => void) => {
        expect(eventName).toBe('before-quit-for-update')
        beforeQuitForUpdate = listener
      }
    )

    prepareMacUpdateInstall(app as unknown as App, [], vi.fn())
    beforeQuitForUpdate?.()

    expect(app.listenerCount('before-quit')).toBe(0)
    expect(beforeQuitListener).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledOnce()
    expect(calls).toEqual(['before quit cleanup', 'exit'])
  })
})
