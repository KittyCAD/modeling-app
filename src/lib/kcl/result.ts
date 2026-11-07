import { isArray } from '@src/lib/utils'
import { isErr } from '@src/lib/trap'

/** The SDK returns WASM failures as values, sometimes serialized, rather than rejecting submit. */
export function readKclResult(value: unknown): { result: unknown } | Error {
  if (isErr(value)) return value
  let result = value
  if (typeof value === 'string') {
    try {
      result = JSON.parse(value) as unknown
    } catch {
      return new Error(value)
    }
  }
  if (result && typeof result === 'object') {
    const error = 'error' in result ? result.error : undefined
    const errors = 'errors' in result ? result.errors : undefined
    if (error) return new Error(errorMessage(error))
    if (isArray(errors) && errors.length > 0)
      return new Error(errors.map(errorMessage).join('\n'))
    if ('success' in result && result.success === false)
      return new Error('The engine rejected the execution')
  }
  return { result }
}
function errorMessage(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    if ('message' in value && typeof value.message === 'string')
      return value.message
    if ('msg' in value && typeof value.msg === 'string') return value.msg
  }
  return JSON.stringify(value) ?? 'KCL execution failed'
}
