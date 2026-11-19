/* eslint-disable suggest-no-throw/suggest-no-throw -- Test infrastructure must fail on an unmatched or incomplete cassette. */
import type { WebSocketResponse } from '@kittycad/lib'
import {
  EngineCassette,
  type EngineExchange,
  type EngineRequest,
} from '@src/machines/modelingMachine.engineCassette'
import { readFile } from 'node:fs/promises'
import { http, HttpResponse, passthrough, ws } from 'msw'
import { setupServer } from 'msw/node'
import { expect, vi } from 'vitest'

/** MSW owns interception and pass-through; Vitest owns cassette storage and updates. */
export function engineSocket(recording: boolean) {
  let exchanges: EngineExchange[] = []
  let cassette: EngineCassette | undefined
  let pending = new Map<string, EngineExchange>()
  let failures: unknown[] = []
  let replies = new Set<Promise<void>>()
  let intercept:
    | ((
        request: EngineRequest,
        response: WebSocketResponse
      ) => Promise<WebSocketResponse>)
    | undefined

  const service = ws.link('*')
  const server = setupServer(
    http.get('*/user/features', () => HttpResponse.error()),
    ...(recording
      ? [http.get(/\/ws\/modeling\/commands/, () => passthrough())]
      : []),
    service.addEventListener('connection', ({ client, server }) => {
      const deliver = (request: EngineRequest, response: WebSocketResponse) => {
        const reply = (async () => {
          client.send(
            JSON.stringify(
              intercept ? await intercept(request, response) : response
            )
          )
        })().catch((error: unknown) => {
          failures.push(error)
        })
        replies.add(reply)
        void reply.finally(() => replies.delete(reply))
      }
      client.addEventListener('message', (event) => {
        const request = JSON.parse(String(event.data))
        if (
          request.type === 'modeling_cmd_req' ||
          request.type === 'modeling_cmd_batch_req'
        ) {
          if (recording) {
            const exchange = { request, responses: [] }
            exchanges.push(exchange)
            pending.set(request.cmd_id ?? request.batch_id, exchange)
          } else {
            try {
              if (!cassette) throw new Error('No active engine cassette')
              for (const response of cassette.reply(request))
                deliver(request, response)
            } catch (error) {
              failures.push(error)
              client.close(1011, 'Unrecorded engine request')
            }
          }
        } else if (!recording && request.type === 'headers') {
          client.send(
            JSON.stringify({
              success: true,
              resp: { type: 'modeling_session_data', data: {} },
            })
          )
        } else if (!recording && request.type === 'ping') {
          client.send(
            JSON.stringify({ success: true, resp: { type: 'pong', data: {} } })
          )
        } else if (!recording) {
          failures.push(
            new Error(`Unexpected socket control message: ${request.type}`)
          )
        }
      })
      if (recording) {
        server.addEventListener('message', (event) => {
          const response: WebSocketResponse = JSON.parse(String(event.data))
          const exchange =
            response.request_id && pending.get(response.request_id)
          if (exchange) {
            event.preventDefault()
            exchange.responses.push(response)
            pending.delete(response.request_id!)
            deliver(exchange.request, response)
          }
        })
        server.connect()
      }
    })
  )
  return {
    listen: () => server.listen({ onUnhandledRequest: 'error' }),
    close: () => server.close(),
    async begin(path: string) {
      exchanges = []
      pending = new Map()
      failures = []
      intercept = undefined
      cassette = recording
        ? undefined
        : new EngineCassette(JSON.parse(await readFile(path, 'utf8')))
    },
    intercept(handler: typeof intercept) {
      intercept = handler
    },
    async finish() {
      await Promise.all(replies)
      if (failures.length)
        throw new AggregateError(failures, 'Engine cassette failed')
      await vi.waitFor(
        () =>
          expect([...pending.keys()], 'Engine responses still pending').toEqual(
            []
          ),
        { timeout: 5000 }
      )
      cassette?.assertConsumed()
      return `${JSON.stringify(exchanges, null, 2)}\n`
    },
  }
}
