import { isErr } from '@src/lib/trap'

// Electron IPC only preserves an error's message, so include network causes there.
export function getDeviceFlowError(error: unknown): Error {
  const details: string[] = []
  const seen = new Set<Error>()

  const append = (value: unknown) => {
    if (!isErr(value) || seen.has(value) || details.length >= 8) return
    seen.add(value)

    const code =
      'code' in value && typeof value.code === 'string'
        ? ` [${value.code}]`
        : ''
    details.push(`${value.name}${code}: ${value.message}`)
    append(value.cause)

    // Node can wrap multiple failed IPv4/IPv6 connection attempts in one error.
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
