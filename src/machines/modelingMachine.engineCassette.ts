/* eslint-disable suggest-no-throw/suggest-no-throw -- Test infrastructure must fail on an unmatched or incomplete cassette. */
import type { WebSocketRequest, WebSocketResponse } from '@kittycad/lib'
import { isArray } from '@src/lib/utils'
import { v4 as uuid } from 'uuid'

export type EngineRequest = Extract<
  WebSocketRequest,
  { type: 'modeling_cmd_req' | 'modeling_cmd_batch_req' }
>

/** Wire exchanges contain engine responses, never interpreter results or credentials. */
export interface EngineExchange {
  request: EngineRequest
  responses: WebSocketResponse[]
}

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

function match(
  expected: unknown,
  actual: unknown,
  ids: Map<string, string>
): boolean {
  if (isUuid(expected)) {
    if (!isUuid(actual)) return false
    const mapped = ids.get(expected)
    if (mapped !== undefined) return mapped === actual
    if ([...ids.values()].includes(actual)) return false
    ids.set(expected, actual)
    return true
  }
  if (isArray(expected)) {
    return (
      isArray(actual) &&
      expected.length === actual.length &&
      expected.every((value, index) => match(value, actual[index], ids))
    )
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || isArray(actual))
      return false
    const values = actual as Record<string, unknown>
    return (
      Object.keys(expected).length === Object.keys(values).length &&
      Object.entries(expected).every(
        ([key, value]) =>
          Object.hasOwn(values, key) && match(value, values[key], ids)
      )
    )
  }
  return expected === actual
}

function substitute(value: unknown, ids: Map<string, string>): unknown {
  if (isUuid(value)) {
    if (!ids.has(value)) ids.set(value, uuid())
    return ids.get(value)
  }
  if (isArray(value)) return value.map((item) => substitute(item, ids))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        isUuid(key) ? substitute(key, ids) : key,
        substitute(item, ids),
      ])
    )
  }
  return value
}

/** UUID aliases survive across requests, geometry references, and batch response keys. */
export class EngineCassette {
  private ids = new Map<string, string>()
  private remaining: EngineExchange[]

  constructor(exchanges: EngineExchange[]) {
    this.remaining = [...exchanges]
  }

  reply(request: EngineRequest): WebSocketResponse[] {
    for (const [index, exchange] of this.remaining.entries()) {
      const bindings = new Map(this.ids)
      if (!match(exchange.request, request, bindings)) continue
      this.ids = bindings
      this.remaining.splice(index, 1)
      return exchange.responses.map(
        (response) => substitute(response, this.ids) as WebSocketResponse
      )
    }
    throw new Error(`Unrecorded engine request: ${JSON.stringify(request)}`)
  }

  assertConsumed() {
    if (this.remaining.length) {
      throw new Error(
        `Unconsumed engine requests: ${JSON.stringify(this.remaining.map((e) => e.request))}`
      )
    }
  }
}
