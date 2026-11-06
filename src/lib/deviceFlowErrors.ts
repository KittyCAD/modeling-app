import { isErr } from '@src/lib/trap'

const MAX_DEVICE_FLOW_ERRORS = 10

export function getDeviceFlowError(error: unknown): Error {
  const details: string[] = []
  const seen = new Set<Error>()

  // A little defensive but they can technically be nested sometimes and repeated
  // so here we're bubbling up to 10 unique ones.
  const append = (value: unknown) => {
    if (
      !isErr(value) ||
      seen.has(value) ||
      details.length >= MAX_DEVICE_FLOW_ERRORS
    ) {
      return
    }

    seen.add(value)
    const code =
      'code' in value && typeof value.code === 'string'
        ? ` [${value.code}]`
        : ''
    details.push(`${value.name}${code}: ${value.message}`)
    append(value.cause)
    if (value instanceof AggregateError) {
      for (const nested of value.errors) {
        append(nested)
      }
    }
  }

  append(error)
  return new Error(details.join('\nCaused by: ') || String(error), {
    cause: error,
  })
}
