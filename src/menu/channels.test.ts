import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Channel } from '@src/channels'
import {
  type WebContentSendPayload,
  typeSafeWebContentsSend,
} from '@src/menu/channels'

const { getFocusedWindow } = vi.hoisted(() => ({
  getFocusedWindow: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getFocusedWindow,
  },
}))

const payload: WebContentSendPayload = {
  menuLabel: 'View.Standard views.Reset view',
}

function createTargetWindow() {
  return {
    webContents: {
      send: vi.fn((channel: Channel, payload: WebContentSendPayload) => {
        return { channel, payload }
      }),
    },
  }
}

describe('typeSafeWebContentsSend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends menu actions to the focused window', () => {
    const fallbackWindow = createTargetWindow()
    const focusedWindow = createTargetWindow()
    getFocusedWindow.mockReturnValue(focusedWindow)

    typeSafeWebContentsSend(fallbackWindow, 'menu-action-clicked', payload)

    expect(focusedWindow.webContents.send).toHaveBeenCalledWith(
      'menu-action-clicked',
      payload
    )
    expect(fallbackWindow.webContents.send).not.toHaveBeenCalled()
  })

  it('falls back to the window captured by the menu builder', () => {
    const fallbackWindow = createTargetWindow()
    getFocusedWindow.mockReturnValue(null)

    typeSafeWebContentsSend(fallbackWindow, 'menu-action-clicked', payload)

    expect(fallbackWindow.webContents.send).toHaveBeenCalledWith(
      'menu-action-clicked',
      payload
    )
  })
})
