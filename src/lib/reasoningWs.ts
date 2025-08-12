// wsReasoning.ts
// Logs every frame with the async-op `id`, closes on {"type":"end_of_stream"}

import { withWebSocketURL } from '@src/lib/withBaseURL'

export function connectReasoningStream(token: string, id: string): void {
  const url = withWebSocketURL('').replace(
    '/ws/modeling/commands',
    `/ws/ml/reasoning/${id}`
  )
  const ws = new WebSocket(url)
  const authMessage = {
    type: 'headers',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }

  ws.addEventListener('open', () => {
    console.log(`[${id}] open ${url}`)
    ws.send(JSON.stringify(authMessage)) // 🔸 send immediately
    console.log(`[${id}] →`, authMessage)
  })

  ws.addEventListener('message', (ev) => {
    console.log(`[${id}] raw`, ev.data)

    let msg: unknown
    try {
      msg = JSON.parse(ev.data as string)
    } catch {
      console.error(`[${id}] JSON parse error`, ev.data)
      return // non-JSON frame
    }

    if ('error' in (msg as any)) {
      ws.send(JSON.stringify(authMessage)) // 🔸 send immediately
      console.log(`[${id}] →`, authMessage)
    }

    if ('end_of_stream' in (msg as any)) {
      console.log(`[${id}] end_of_stream → closing`)
      ws.close(1000, 'done')
    }
  })

  ws.addEventListener('close', (e) =>
    console.log(`[${id}] close`, e.code, e.reason)
  )
  ws.addEventListener('error', console.error)
}
