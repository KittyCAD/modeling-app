import { type ClientErrorReport, users } from '@kittycad/lib'
import type { ReadonlySignal } from '@preact/signals-core'
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
  persistUntilSent?: boolean
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
  EngineUnsupportedVideoCodec = 'engine_unsupported_video_codec',
  EngineWebrtcDisconnect = 'engine_webrtc_disconnect',
  FileOperationsError = 'file_operations_error',
  LegacySketchMode = 'legacy_sketch_mode',
  SystemIOError = 'system_io_error',
  ToolbarDropdownAnchorPositioningError = 'toolbar_dropdown_anchor_positioning_error',
  UnsupportedBrowserFeature = 'unsupported_browser_feature',
  UserFeaturesFetchError = 'user_features_fetch_error',
  ZookeeperActorError = 'zookeeper_actor_error',
  ZookeeperSetupError = 'zookeeper_setup_error',
  ZookeeperWebsocketBinaryDecodeError = 'zookeeper_websocket_binary_decode_error',
  ZookeeperWebsocketJsonParseError = 'zookeeper_websocket_json_parse_error',
  EngineTeardown = 'engine_teardown',
}

const reportedClientErrors = new Set<string>()
type PendingReport = {
  body: ClientErrorReport
  dedupeKey?: string
  persistedId?: string
}
type PersistedReport = PendingReport & { persistedId: string }

const pendingReports: PendingReport[] = []
const persistedReportsInFlight = new Set<string>()
let authReady = false
let hasAuthenticated = false
const FALLBACK_APP_RELEASE = 'unknown'
const PERSISTED_REPORTS_KEY = 'zoo.persisted-client-error-reports'
const MAX_PERSISTED_REPORTS = 20
// Match the API's stack limit in Unicode characters.
const MAX_STACK_LENGTH = 8192
const cropStack = (stack: string) =>
  Array.from(stack).slice(0, MAX_STACK_LENGTH).join('')

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
    params.code !== ClientErrorCode.EngineBackendDisconnect &&
    params.code !== ClientErrorCode.EngineTeardown
  ) {
    return cropStack(JSON.stringify(context))
  }

  let stack: string
  try {
    stack = JSON.stringify({
      ...context,
      // Keep recent events first so they survive the raw crop below.
      engineDebugger: EngineDebugger.logs
        .map(({ time, message, label, metadata }) => ({
          time,
          message,
          label,
          metadata,
        }))
        .reverse(),
    })
  } catch {
    // Still report the original error if the debugger buffer cannot serialize.
    stack = JSON.stringify(context)
  }
  return cropStack(stack)
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

const readPersistedReports = (): PersistedReport[] => {
  if (typeof localStorage === 'undefined') {
    return []
  }

  try {
    const reports: unknown = JSON.parse(
      localStorage.getItem(PERSISTED_REPORTS_KEY) ?? '[]'
    )
    if (!Array.isArray(reports)) {
      return []
    }
    return reports.filter((report): report is PersistedReport => {
      if (!report || typeof report !== 'object') {
        return false
      }
      const candidate = report as Partial<PersistedReport>
      return (
        typeof candidate.persistedId === 'string' &&
        typeof candidate.body === 'object' &&
        candidate.body !== null
      )
    })
  } catch {
    return []
  }
}

const writePersistedReports = (reports: PersistedReport[]) => {
  if (typeof localStorage === 'undefined') {
    return
  }

  try {
    if (reports.length === 0) {
      localStorage.removeItem(PERSISTED_REPORTS_KEY)
    } else {
      localStorage.setItem(PERSISTED_REPORTS_KEY, JSON.stringify(reports))
    }
  } catch {
    // Persistence is best-effort; the immediate report can still succeed.
  }
}

const persistReport = (body: ClientErrorReport, dedupeKey?: string) => {
  const persistedId = crypto.randomUUID()
  const reports = readPersistedReports().filter(
    (report) => !dedupeKey || report.dedupeKey !== dedupeKey
  )
  reports.push({ body, dedupeKey, persistedId })
  writePersistedReports(reports.slice(-MAX_PERSISTED_REPORTS))
  return persistedId
}

const removePersistedReport = (persistedId: string) => {
  writePersistedReports(
    readPersistedReports().filter(
      (report) => report.persistedId !== persistedId
    )
  )
}

export const reportClientError = async (params: ReportClientErrorParams) => {
  // Buffer startup errors only, with a cap if authentication never succeeds.
  if (
    !authReady &&
    !params.persistUntilSent &&
    (hasAuthenticated || pendingReports.length >= 100)
  ) {
    return
  }

  const dedupeKey = params.dedupeKey
  if (dedupeKey && reportedClientErrors.has(dedupeKey)) {
    return
  }
  if (dedupeKey) {
    reportedClientErrors.add(dedupeKey)
  }

  const body = buildClientErrorReport(params)
  const persistedId = params.persistUntilSent
    ? persistReport(body, dedupeKey)
    : undefined
  if (!authReady) {
    pendingReports.push({ body, dedupeKey, persistedId })
    return
  }
  await sendClientErrorReport(body, dedupeKey, persistedId)
}

async function sendClientErrorReport(
  body: ClientErrorReport,
  dedupeKey?: string,
  persistedId?: string
) {
  if (persistedId) {
    persistedReportsInFlight.add(persistedId)
  }
  try {
    const client = createKCClient(getAuthToken())
    const result = await kcCall(() =>
      users.report_user_client_error({
        client,
        body,
      })
    )

    if (result instanceof Error) {
      if (dedupeKey) {
        reportedClientErrors.delete(dedupeKey)
      }
      console.warn('Failed to report client error', result)
      return
    }

    if (persistedId) {
      removePersistedReport(persistedId)
    }
  } finally {
    if (persistedId) {
      persistedReportsInFlight.delete(persistedId)
    }
  }
}

const flushPersistedReports = () => {
  if (!authReady) {
    return
  }

  for (const { body, dedupeKey, persistedId } of readPersistedReports()) {
    if (persistedReportsInFlight.has(persistedId)) {
      continue
    }
    if (dedupeKey) {
      reportedClientErrors.add(dedupeKey)
    }
    void sendClientErrorReport(body, dedupeKey, persistedId).catch(
      (error: unknown) => console.warn('Failed to report client error', error)
    )
  }
}

export function initializeClientErrorReporting(
  isLoggedIn: ReadonlySignal<boolean>
) {
  const handleOnline = () => flushPersistedReports()
  window.addEventListener('online', handleOnline)
  const unsubscribe = isLoggedIn.subscribe((ready) => {
    authReady = ready
    if (!ready) {
      return
    }
    hasAuthenticated = true
    for (const { body, dedupeKey, persistedId } of pendingReports.splice(0)) {
      void sendClientErrorReport(body, dedupeKey, persistedId).catch(
        (error: unknown) => console.warn('Failed to report client error', error)
      )
    }
    flushPersistedReports()
  })

  return () => {
    unsubscribe()
    window.removeEventListener('online', handleOnline)
  }
}

export const resetReportedClientErrorsForTests = () => {
  reportedClientErrors.clear()
  pendingReports.length = 0
  persistedReportsInFlight.clear()
  localStorage.removeItem(PERSISTED_REPORTS_KEY)
  authReady = false
  hasAuthenticated = false
}
