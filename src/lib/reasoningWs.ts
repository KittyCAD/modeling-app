// wsReasoning.ts
// Logs every frame with the async-op `id`, closes on {"type":"end_of_stream"}

import env from '@src/env'
import { withWebSocketURL } from '@src/lib/withBaseURL'

export function connectReasoningStream(id: string): void {
  const url = withWebSocketURL('').replace(
    '/ws/modeling/commands',
    `/ws/ml/reasoning/${id}`
  )
  const ws = new WebSocket(url)

  ws.addEventListener('open', () => {
    console.log(`[${id}] open ${url}`)
    const authMessage = {
      type: 'headers',
      headers: {
        Authorization: `Bearer ${env().VITE_KITTYCAD_API_TOKEN}`,
      },
    }
    ws.send(JSON.stringify(authMessage)) // 🔸 send immediately
    console.log(`[${id}] →`, authMessage)
  })

  ws.addEventListener('message', (ev) => {
    console.log(`[${id}] raw`, ev.data)

    let msg: unknown
    try {
      msg = JSON.parse(ev.data as string)
      const extra =
        typeof msg === 'object' && msg !== null && 'id' in msg
          ? ` (msg.id=${(msg as any).id})`
          : ''
      console.dir(msg, { depth: null })
      console.log(`[${id}] parsed${extra}`)
    } catch {
      return // non-JSON frame
    }

    if ((msg as any)?.type === 'end_of_stream') {
      console.log(`[${id}] end_of_stream → closing`)
      ws.close(1000, 'done')
    }
  })

  ws.addEventListener('close', (e) =>
    console.log(`[${id}] close`, e.code, e.reason)
  )
  ws.addEventListener('error', console.error)
}
