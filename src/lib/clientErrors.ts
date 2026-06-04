import { type ClientErrorReport, users } from '@kittycad/lib'
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
  UserFeaturesFetchError = 'user_features_fetch_error',
  ZookeeperActorError = 'zookeeper_actor_error',
  ZookeeperSetupError = 'zookeeper_setup_error',
  ZookeeperWebsocketBinaryDecodeError = 'zookeeper_websocket_binary_decode_error',
  ZookeeperWebsocketJsonParseError = 'zookeeper_websocket_json_parse_error',
}

const reportedClientErrors = new Set<string>()

const getAppRelease = () => {
  return typeof __APP_VERSION__ === 'undefined' ? 'unknown' : __APP_VERSION__
}

const getCurrentRoute = () => {
  if (typeof window === 'undefined') return undefined
  const { pathname, search, hash } = window.location
  return `${pathname}${search}${hash}` || undefined
}

const getAuthToken = () => {
  if (typeof window === 'undefined') return undefined

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
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error === undefined) return fallback

  try {
    return JSON.stringify(error)
  } catch {
    return fallback
  }
}

const getErrorMessage = (params: ReportClientErrorParams) => {
  if (params.message) return params.message
  return errorToMessage(params.error)
}

const getErrorName = (params: ReportClientErrorParams) => {
  if (params.errorName) return params.errorName
  if (params.error instanceof Error) return params.error.name
  return undefined
}

const buildStack = (params: ReportClientErrorParams) => {
  const userAgent =
    typeof navigator === 'undefined' ? undefined : navigator.userAgent

  return JSON.stringify({
    ...(params.error instanceof Error && params.error.stack
      ? { runtimeStack: params.error.stack }
      : {}),
    ...params.extra,
    userAgent,
  })
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
  if (dedupeKey && reportedClientErrors.has(dedupeKey)) return
  if (dedupeKey) reportedClientErrors.add(dedupeKey)

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
