import { describe, expect, it } from 'vitest'

import type { Channel } from '@src/channels'
import {
  type WebContentSendPayload,
  sendMenuAction,
  typeSafeWebContentsSend,
} from '@src/menu/channels'

const payload: WebContentSendPayload = {
  menuLabel: 'View.Standard views.Reset view',
}

function createTargetWindow() {
  const sentMessages: Array<{
    channel: Channel
    payload: WebContentSendPayload
  }> = []

  return {
    sentMessages,
    webContents: {
      send: (channel: Channel, payload: WebContentSendPayload) => {
        sentMessages.push({ channel, payload })
      },
    },
  }
}

describe('typeSafeWebContentsSend', () => {
  it('sends menu actions to the clicked window when Electron provides one', () => {
    const fallbackWindow = createTargetWindow()
    const clickedWindow = createTargetWindow()

    typeSafeWebContentsSend(
      fallbackWindow,
      'menu-action-clicked',
      payload,
      clickedWindow
    )

    expect(clickedWindow.sentMessages).toStrictEqual([
      { channel: 'menu-action-clicked', payload },
    ])
    expect(fallbackWindow.sentMessages).toStrictEqual([])
  })

  it('falls back to the window captured by the menu builder', () => {
    const fallbackWindow = createTargetWindow()

    typeSafeWebContentsSend(fallbackWindow, 'menu-action-clicked', payload)

    expect(fallbackWindow.sentMessages).toStrictEqual([
      { channel: 'menu-action-clicked', payload },
    ])
  })

  it('ignores non-window click targets and falls back safely', () => {
    const fallbackWindow = createTargetWindow()

    typeSafeWebContentsSend(fallbackWindow, 'menu-action-clicked', payload, {
      webContents: {},
    })

    expect(fallbackWindow.sentMessages).toStrictEqual([
      { channel: 'menu-action-clicked', payload },
    ])
  })
})

describe('sendMenuAction', () => {
  it('builds an Electron menu click handler scoped to the clicked window', () => {
    const fallbackWindow = createTargetWindow()
    const clickedWindow = createTargetWindow()
    const click = sendMenuAction(fallbackWindow, 'Design.Start sketch')

    Reflect.apply(click, undefined, [undefined, clickedWindow, undefined])

    expect(clickedWindow.sentMessages).toStrictEqual([
      {
        channel: 'menu-action-clicked',
        payload: { menuLabel: 'Design.Start sketch' },
      },
    ])
    expect(fallbackWindow.sentMessages).toStrictEqual([])
  })
})
