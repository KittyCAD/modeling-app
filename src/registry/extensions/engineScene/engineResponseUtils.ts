import { isModelingResponse } from '@src/lib/kcSdkGuards'
import { isArray } from '@src/lib/utils'

export type ModelingDataResult =
  | { type: 'data'; data: unknown }
  | { type: 'error'; error: Error }

/**
 * Pulls a human readable message out of whatever `sendSceneCommand` resolved
 * with. It resolves with an Error or a `[failureMessage]` array instead of
 * rejecting, so both shapes have to be handled here.
 */
export function getResponseErrorMessage(
  response: unknown,
  fallbackMessage: string
): string {
  if (response instanceof Error) {
    return response.message
  }

  if (isArray(response)) {
    for (const item of response) {
      if (
        typeof item !== 'object' ||
        item === null ||
        !('errors' in item) ||
        !isArray(item.errors)
      ) {
        continue
      }

      const [firstError] = item.errors
      if (
        typeof firstError === 'object' &&
        firstError !== null &&
        'message' in firstError &&
        typeof firstError.message === 'string'
      ) {
        return firstError.message
      }
    }
  }

  return fallbackMessage
}

export function getModelingData(
  response: unknown,
  expectedType: string,
  fallbackMessage: string
): ModelingDataResult {
  if (!isModelingResponse(response)) {
    return {
      type: 'error',
      error: new Error(getResponseErrorMessage(response, fallbackMessage)),
    }
  }

  const modelingResponse = response.resp.data.modeling_response
  if (modelingResponse.type !== expectedType || !('data' in modelingResponse)) {
    return { type: 'error', error: new Error(fallbackMessage) }
  }

  return { type: 'data', data: modelingResponse.data }
}
