/**
 * Privacy-safe locations where cloud storage can fail. The discriminated union
 * keeps stages and points paired so telemetry cannot invent an invalid
 * combination or fall back to exception text that may contain local paths.
 */
export type CloudFailureContext =
  | {
      stage: 'archive'
      point: 'parse-project-archive' | 'prepare-project-upload'
    }
  | {
      stage: 'network'
      point: 'cloud-api-request' | 'parse-cloud-api-response'
    }

/**
 * Base error for failures crossing a cloud-storage boundary. Subclasses
 * may add domain data, while ordinary runtime failures remain available as
 * the cause for control flow and privacy-safe telemetry classification.
 */
export class CloudStorageError extends Error {
  constructor(
    readonly context: CloudFailureContext,
    message: string,
    options: ErrorOptions = {}
  ) {
    super(message, options)
    this.name = 'CloudStorageError'
  }
}

export function attachCloudFailureContext(
  context: CloudFailureContext,
  error: unknown
) {
  if (error instanceof CloudStorageError) {
    return error
  }

  return new CloudStorageError(
    context,
    error instanceof Error ? error.message : String(error),
    { cause: error }
  )
}

export async function withCloudFailureContext<T>(
  context: CloudFailureContext,
  action: () => Promise<T>
): Promise<T> {
  try {
    return await action()
  } catch (error) {
    return Promise.reject(attachCloudFailureContext(context, error))
  }
}

export function withCloudFailureContextSync<T>(
  context: CloudFailureContext,
  action: () => T
): T {
  try {
    return action()
  } catch (error) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw attachCloudFailureContext(context, error)
  }
}

export function getCloudFailureContext(error: unknown) {
  const seen = new Set<unknown>()
  let current = error

  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current)
    if (current instanceof CloudStorageError) {
      return current.context
    }
    current = current instanceof Error ? current.cause : undefined
  }

  return undefined
}

export function getCloudFailureCause(error: unknown) {
  const seen = new Set<unknown>()
  let current = error

  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current)
    if (
      current instanceof Error &&
      current.cause !== undefined &&
      (!(current instanceof CloudStorageError) ||
        current.constructor === CloudStorageError)
    ) {
      current = current.cause
      continue
    }
    break
  }

  return current
}
