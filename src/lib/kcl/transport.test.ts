import {
  bindViewerTransport,
  type ViewerTransport,
} from '@src/lib/kcl/transport'
import { expect, it, vi } from 'vitest'

it('correlates out-of-order replies while preserving the viewer ICE handler', async () => {
  const ice = vi.fn()
  const rtc: ViewerTransport = {
    send: async () => undefined,
    iceOnMessage: ice,
  }
  const close = bindViewerTransport(rtc, (message) => message.data)
  try {
    const first = rtc.send(JSON.stringify({ cmd_id: 'first' }))
    const batch = rtc.send(JSON.stringify({ batch_id: 'batch' }))
    let completed = false
    void first.then(() => {
      completed = true
    })
    rtc.iceOnMessage({
      type: 'message',
      data: { success: true, resp: { type: 'ice_server_info' } },
    })
    rtc.iceOnMessage({
      type: 'message',
      data: {
        request_id: 'batch',
        success: false,
        errors: [{ message: 'invalid geometry' }],
      },
    })
    expect(await batch).toMatchObject({
      success: false,
      errors: [{ message: 'invalid geometry' }],
    })
    expect(completed).toBe(false)
    rtc.iceOnMessage({
      type: 'message',
      data: { request_id: 'first', success: true },
    })
    expect(await first).toMatchObject({ request_id: 'first' })
    expect(ice).toHaveBeenCalledWith({
      type: 'message',
      data: { success: true, resp: { type: 'ice_server_info' } },
    })
  } finally {
    close()
  }
})

it('rejects pending and future requests when the viewer closes', async () => {
  const rtc: ViewerTransport = {
    send: async () => undefined,
    iceOnMessage() {},
  }
  const close = bindViewerTransport(rtc, (message) => message.data)
  const pending = rtc.send(JSON.stringify({ cmd_id: 'pending' }))
  const rejected = expect(pending).rejects.toThrow('closed')
  close()
  await rejected
  await expect(rtc.send(JSON.stringify({ cmd_id: 'later' }))).rejects.toThrow(
    'closed'
  )
})
