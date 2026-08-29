/**
 * What went wrong, out of whatever the WASM boundary threw.
 *
 * kcl-lib rejects with `JsValue::from_serde(&error)` — a plain object, the
 * serialised Rust error — or with a bare string for the failures it formats
 * itself. Neither is an `Error`, so the obvious `caught instanceof Error ?
 * caught.message : 'something went wrong'` throws away every word the engine
 * said and reports the fallback. That is worth a module of its own because it is
 * silent: the code looks careful and produces nothing.
 */

interface Detailed {
  msg?: unknown
  message?: unknown
  details?: { msg?: unknown }
  error?: Detailed
}

/** The deepest `msg` this shape has, following the one nesting kcl-lib uses. */
function messageIn(value: Detailed, depth = 0): string | null {
  // `KclErrorWithOutputs` wraps `KclError` wraps `KclErrorDetails`, so three is
  // the whole ladder. The bound stops a cyclic object rather than a deep one.
  if (depth > 4) return null

  const nested = value.error ? messageIn(value.error, depth + 1) : null
  if (nested) return nested

  const detail = value.details?.msg
  if (typeof detail === 'string' && detail !== '') return detail

  for (const candidate of [value.msg, value.message]) {
    if (typeof candidate === 'string' && candidate !== '') return candidate
  }

  return null
}

/**
 * A message worth showing someone, and a console record of the rest.
 *
 * The raw value is logged because the message is the smallest part of what
 * kcl-lib sends back: the source ranges, the non-fatal issues and the partial
 * scene graph are all in there, and all of them matter when the message alone is
 * not enough.
 */
export function kclErrorMessage(caught: unknown, fallback: string): string {
  if (caught instanceof Error) return caught.message
  if (typeof caught === 'string' && caught !== '') return caught

  if (caught !== null && typeof caught === 'object') {
    const found = messageIn(caught as Detailed)
    if (found) return found
  }

  console.error('kcl: unrecognised failure', caught)
  return fallback
}
