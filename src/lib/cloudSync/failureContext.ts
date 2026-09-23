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

const failureContexts = new WeakMap<object, CloudSyncFailureContext>()

/**
 * Preserves native Error identity for control flow such as CloudApiError
 * status handling. Primitive rejections need an Error wrapper so their typed
 * context can cross async boundaries without exposing the original value to
 * telemetry.
 */
class CloudSyncPrimitiveFailure extends Error {
  constructor(
    readonly context: CloudSyncFailureContext,
    readonly original: unknown
  ) {
    super(typeof original === 'string' ? original : String(original))
    this.name = 'CloudSyncPrimitiveFailure'
  }
}

export function attachCloudSyncFailureContext(
  context: CloudSyncFailureContext,
  error: unknown
) {
  if (
    (typeof error === 'object' && error !== null) ||
    typeof error === 'function'
  ) {
    if (!failureContexts.has(error)) {
      failureContexts.set(error, context)
    }
    return error
  }

  return new CloudSyncPrimitiveFailure(context, error)
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
    if (current instanceof CloudSyncPrimitiveFailure) {
      return current.context
    }
    if (
      (typeof current === 'object' || typeof current === 'function') &&
      failureContexts.has(current)
    ) {
      return failureContexts.get(current)
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
    if (current instanceof CloudSyncPrimitiveFailure) {
      current = current.original
      continue
    }
    if (current instanceof Error && current.cause !== undefined) {
      current = current.cause
      continue
    }
    break
  }

  return current
}
