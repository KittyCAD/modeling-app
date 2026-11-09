/** The SDK's public message hook exposes replies without reaching into its worker. */
export interface ViewerTransport {
  send(message: string): Promise<unknown>
  iceOnMessage(message: { type: 'message'; data: unknown }): void
}

/** Correlate replies: camera/ICE traffic must never complete a KCL command's request. */
export function bindViewerTransport(
  rtc: ViewerTransport,
  parseMessage: (message: { data: unknown }) => unknown
) {
  const pending = new Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timeout: ReturnType<typeof setTimeout>
    }
  >()
  const originalSend = rtc.send.bind(rtc)
  const originalMessage = rtc.iceOnMessage.bind(rtc)
  let closed = false
  rtc.iceOnMessage = (message) => {
    const response = parseMessage(message)
    if (
      response &&
      typeof response === 'object' &&
      'request_id' in response &&
      typeof response.request_id === 'string'
    ) {
      const request = pending.get(response.request_id)
      if (request) {
        clearTimeout(request.timeout)
        pending.delete(response.request_id)
        request.resolve(response)
      }
    }
    originalMessage(message)
  }
  rtc.send = (message) => {
    if (closed) return Promise.reject(new Error('The engine session closed'))
    const request = JSON.parse(message)
    const id: unknown = request.cmd_id ?? request.batch_id
    // Camera/resize commands use a reserved ID and their callers do not await replies.
    if (
      id === '00000000-0000-0000-0000-000000000000' ||
      request.responses === false
    )
      return originalSend(message)
    if (typeof id !== 'string') return originalSend(message)
    if (pending.has(id))
      return Promise.reject(
        new Error('An engine request is already pending with this ID')
      )
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id)
        reject(new Error('The engine request timed out'))
      }, 30_000)
      pending.set(id, { resolve, reject, timeout })
      // send also installs the SDK's next-message listener; its result is not correlated.
      originalSend(message).catch((error: unknown) => {
        const request = pending.get(id)
        if (!request) return
        clearTimeout(request.timeout)
        pending.delete(id)
        reject(error)
      })
    })
  }
  return () => {
    closed = true
    rtc.iceOnMessage = originalMessage
    for (const request of pending.values()) {
      clearTimeout(request.timeout)
      request.reject(new Error('The engine session closed'))
    }
    pending.clear()
  }
}
