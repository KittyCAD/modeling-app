import toast from 'react-hot-toast'

export const SKETCH_SOLVE_ERROR_TOAST_ID = 'sketch-solve-error'

function getDirectErrorMessage(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  if (value instanceof Error) {
    const trimmed = value.message.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  return undefined
}

export function getSketchSolveErrorMessage(
  input: unknown,
  fallback = 'Sketch solve failed'
): string {
  const directMessage = getDirectErrorMessage(input)
  if (directMessage) {
    return directMessage
  }

  if (typeof input === 'object' && input !== null) {
    for (const key of ['error', 'message', 'data', 'output', 'reason']) {
      if (!(key in input)) {
        continue
      }

      const nestedMessage = getSketchSolveErrorMessage(
        (input as Record<string, unknown>)[key],
        ''
      )
      if (nestedMessage) {
        return nestedMessage
      }
    }
  }

  return fallback
}

export function isSketchSolveErrorOutput(
  output: unknown
): output is { error: string } {
  return (
    typeof output === 'object' &&
    output !== null &&
    'error' in output &&
    getSketchSolveErrorMessage((output as { error?: unknown }).error, '')
      .length > 0
  )
}

export function toastSketchSolveError(
  input: unknown,
  fallback = 'Sketch solve failed'
) {
  const message = getSketchSolveErrorMessage(input, fallback)
  toast.error(message, { id: SKETCH_SOLVE_ERROR_TOAST_ID })
  return message
}
