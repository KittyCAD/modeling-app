/**
 * Privacy-safe locations where cloud sync can fail. The discriminated union
 * keeps stages and points paired so telemetry cannot invent an invalid
 * combination or fall back to exception text that may contain local paths.
 */
export type CloudSyncFailureContext =
  | {
      stage: 'archive'
      point: 'parse-project-archive' | 'prepare-project-upload'
    }
  | {
      stage: 'database'
      point: 'open-sync-database' | 'read-sync-state' | 'write-sync-state'
    }
  | {
      stage: 'filesystem'
      point: 'collect-local-project-files'
    }
  | {
      stage: 'manifest'
      point: 'hash-project-manifest'
    }
  | {
      stage: 'network'
      point: 'cloud-api-request' | 'parse-cloud-api-response'
    }

/**
 * Base error for failures crossing a cloud-sync domain boundary. Subclasses
 * may add domain data, while ordinary runtime failures remain available as
 * the cause for control flow and privacy-safe telemetry classification.
 */
export class CloudSyncError extends Error {
  constructor(
    readonly context: CloudSyncFailureContext,
    message: string,
    options: ErrorOptions = {}
  ) {
    super(message, options)
    this.name = 'CloudSyncError'
  }
}

export function attachCloudSyncFailureContext(
  context: CloudSyncFailureContext,
  error: unknown
) {
  if (error instanceof CloudSyncError) {
    return error
  }

  return new CloudSyncError(
    context,
    error instanceof Error ? error.message : String(error),
    { cause: error }
  )
}

export async function withCloudSyncFailureContext<T>(
  context: CloudSyncFailureContext,
  action: () => Promise<T>
): Promise<T> {
  try {
    return await action()
  } catch (error) {
    return Promise.reject(attachCloudSyncFailureContext(context, error))
  }
}

export function withCloudSyncFailureContextSync<T>(
  context: CloudSyncFailureContext,
  action: () => T
): T {
  try {
    return action()
  } catch (error) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw attachCloudSyncFailureContext(context, error)
  }
}

export function getCloudSyncFailureContext(error: unknown) {
  const seen = new Set<unknown>()
  let current = error

  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current)
    if (current instanceof CloudSyncError) {
      return current.context
    }
    current = current instanceof Error ? current.cause : undefined
  }

  return undefined
}

export function getCloudSyncFailureCause(error: unknown) {
  const seen = new Set<unknown>()
  let current = error

  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current)
    if (
      current instanceof Error &&
      current.cause !== undefined &&
      (!(current instanceof CloudSyncError) ||
        current.constructor === CloudSyncError)
    ) {
      current = current.cause
      continue
    }
    break
  }

  return current
}
