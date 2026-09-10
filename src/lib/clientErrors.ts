import { type ClientErrorReport, users } from '@kittycad/lib'
import { EngineDebugger } from '@src/lib/debugger'
import { createKCClient, kcCall } from '@src/lib/kcClient'

type ReportClientErrorParams = {
  code?: string
  message?: string
  error?: unknown
  errorName?: string
  extra?: Record<string, unknown>
  dedupeKey?: string
  route?: string
  client?: string
}

export enum ClientErrorCode {
  AuthDeviceFlowLoginError = 'auth_device_flow_login_error',
  AuthDeviceFlowStartError = 'auth_device_flow_start_error',
  AuthGetUserError = 'auth_get_user_error',
  AuthLogoutError = 'auth_logout_error',
  AuthLogoutTokenReadError = 'auth_logout_token_read_error',
  AuthTokenRevokeError = 'auth_token_revoke_error',
  AuthTokenSyncError = 'auth_token_sync_error',
  CloudSyncConflict = 'cloud_sync_conflict',
  CloudSyncConflictCopyDetected = 'cloud_sync_conflict_copy_detected',
  CloudSyncFailure = 'cloud_sync_failure',
  CloudSyncUntrackedLocalChanges = 'cloud_sync_untracked_local_changes',
  DesktopChildProcessGone = 'desktop_child_process_gone',
  DesktopRendererUnresponsive = 'desktop_renderer_unresponsive',
  DesktopRenderProcessGone = 'desktop_render_process_gone',
  EngineBackendDisconnect = 'engine_backend_disconnect',
  EngineDisconnect = 'engine_disconnect',
  LegacySketchMode = 'legacy_sketch_mode',
  SystemIOError = 'system_io_error',
  ToolbarDropdownAnchorPositioningError = 'toolbar_dropdown_anchor_positioning_error',
  UnsupportedBrowserFeature = 'unsupported_browser_feature',
  UserFeaturesFetchError = 'user_features_fetch_error',
  ZookeeperActorError = 'zookeeper_actor_error',
  ZookeeperSetupError = 'zookeeper_setup_error',
  ZookeeperWebsocketBinaryDecodeError = 'zookeeper_websocket_binary_decode_error',
  ZookeeperWebsocketJsonParseError = 'zookeeper_websocket_json_parse_error',
}

const reportedClientErrors = new Set<string>()
const FALLBACK_APP_RELEASE = 'unknown'
// The API truncates stack to 8,192 Unicode characters. Using JS string length
// is conservative for astral characters and includes JSON escaping.
const MAX_STACK_LENGTH = 8192
const MAX_ENGINE_CONTEXT_LENGTH = MAX_STACK_LENGTH / 2

const getAppRelease = () => {
  if (typeof window !== 'undefined') {
    const packageVersion = (
      window.electron?.packageJson as { version?: string } | undefined
    )?.version
    if (packageVersion && packageVersion !== '0.0.0') {
      return packageVersion
    }
  }

  const commitSha = import.meta.env.MODELING_APP_COMMIT_SHA
  if (commitSha && commitSha.length >= 7) {
    return commitSha.slice(0, 7)
  }

  return typeof __APP_VERSION__ === 'undefined'
    ? FALLBACK_APP_RELEASE
    : __APP_VERSION__
}

const getCurrentRoute = () => {
  if (typeof window === 'undefined') {
    return undefined
  }
  const { pathname, search, hash } = window.location
  return `${pathname}${search}${hash}` || undefined
}

const getAuthToken = () => {
  if (typeof window === 'undefined') {
    return undefined
  }

  try {
    return window.app?.auth.actor.getSnapshot().context.token
  } catch {
    return undefined
  }
}

export const errorToMessage = (
  error: unknown,
  fallback = 'Unknown client error'
) => {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  if (error === undefined) {
    return fallback
  }

  try {
    return JSON.stringify(error)
  } catch {
    return fallback
  }
}

const getErrorMessage = (params: ReportClientErrorParams) => {
  if (params.message) {
    return params.message
  }
  return errorToMessage(params.error)
}

const getErrorName = (params: ReportClientErrorParams) => {
  if (params.errorName) {
    return params.errorName
  }
  if (params.error instanceof Error) {
    return params.error.name
  }
  return undefined
}

const buildStack = (params: ReportClientErrorParams) => {
  const userAgent =
    typeof navigator === 'undefined' ? undefined : navigator.userAgent

  const context: Record<string, unknown> = {
    ...(params.error instanceof Error && params.error.stack
      ? { runtimeStack: params.error.stack }
      : {}),
    ...params.extra,
    userAgent,
  }
  if (
    params.code !== ClientErrorCode.EngineDisconnect &&
    params.code !== ClientErrorCode.EngineBackendDisconnect
  ) {
    return JSON.stringify(context)
  }

  delete context.engineDebugger
  let serializedContext = JSON.stringify(context)
  if (serializedContext.length > MAX_ENGINE_CONTEXT_LENGTH) {
    // Leave at least half the budget for engine history. Keep small context
    // fields even when another field (such as a runtime stack) is oversized.
    const shortenedContext: Record<string, unknown> = { contextTruncated: true }
    for (const [key, value] of Object.entries(context)) {
      if (key === 'contextTruncated') continue
      shortenedContext[key] = value
      if (JSON.stringify(shortenedContext).length > MAX_ENGINE_CONTEXT_LENGTH) {
        shortenedContext[key] =
          typeof value === 'string'
            ? `${value.slice(0, 256)}[Truncated]`
            : '[Truncated]'
        if (
          JSON.stringify(shortenedContext).length > MAX_ENGINE_CONTEXT_LENGTH
        ) {
          delete shortenedContext[key]
        }
      }
    }
    serializedContext = JSON.stringify(shortenedContext)
  }

  // Reuse the exact serialized context we measured, and budget for the key,
  // comma and closing brace as well as the snapshot's own envelope.
  const prefix = `${serializedContext.slice(0, -1)}${serializedContext === '{}' ? '' : ','}"engineDebugger":`
  const snapshot = EngineDebugger.snapshotForReport(
    MAX_STACK_LENGTH - prefix.length - 1
  )
  return `${prefix}${JSON.stringify(snapshot)}}`
}

const buildClientErrorReport = (
  params: ReportClientErrorParams
): ClientErrorReport => {
  return {
    client: params.client ?? 'zoo-modeling-app',
    code: params.code,
    error_name: getErrorName(params),
    message: getErrorMessage(params),
    release: getAppRelease(),
    route: params.route ?? getCurrentRoute(),
    stack: buildStack(params),
  }
}

export const reportClientError = async (params: ReportClientErrorParams) => {
  const dedupeKey = params.dedupeKey
  if (dedupeKey && reportedClientErrors.has(dedupeKey)) {
    return
  }
  if (dedupeKey) {
    reportedClientErrors.add(dedupeKey)
  }

  const client = createKCClient(getAuthToken())
  const result = await kcCall(() =>
    users.report_user_client_error({
      client,
      body: buildClientErrorReport(params),
    })
  )

  if (result instanceof Error) {
    if (dedupeKey) {
      reportedClientErrors.delete(dedupeKey)
    }
    console.warn('Failed to report client error', result)
  }
}

export const resetReportedClientErrorsForTests = () => {
  reportedClientErrors.clear()
}
