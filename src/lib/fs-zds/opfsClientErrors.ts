import { users, type ClientErrorReport } from '@kittycad/lib'
import { createKCClient, kcCall } from '@src/lib/kcClient'

export type OPFSClientErrorCode =
  | 'opfs_missing_create_writable'
  | 'opfs_write_unsupported'

type ReportOPFSClientErrorParams = {
  code: OPFSClientErrorCode
  errorName: string
  message: string
  extra?: Record<string, unknown>
}

const reportedClientErrors = new Set<OPFSClientErrorCode>()

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

const buildStack = (extra?: Record<string, unknown>) => {
  const userAgent =
    typeof navigator === 'undefined' ? undefined : navigator.userAgent

  return JSON.stringify({
    ...extra,
    userAgent,
  })
}

const buildClientErrorReport = ({
  code,
  errorName,
  message,
  extra,
}: ReportOPFSClientErrorParams): ClientErrorReport => {
  return {
    client: 'zoo-modeling-app',
    code,
    error_name: errorName,
    message,
    release: getAppRelease(),
    route: getCurrentRoute(),
    stack: buildStack(extra),
  }
}

export const reportOPFSClientError = async (
  params: ReportOPFSClientErrorParams
) => {
  if (reportedClientErrors.has(params.code)) return
  reportedClientErrors.add(params.code)

  const client = createKCClient(getAuthToken())
  const result = await kcCall(() =>
    users.report_user_client_error({
      client,
      body: buildClientErrorReport(params),
    })
  )

  if (result instanceof Error) {
    console.warn('Failed to report OPFS client error', result)
  }
}

export const resetReportedOPFSClientErrorsForTests = () => {
  reportedClientErrors.clear()
}
