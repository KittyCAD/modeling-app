import {
  ALLOW_MOBILE_QUERY_PARAM,
  ASK_TO_OPEN_QUERY_PARAM,
  CMD_GROUP_QUERY_PARAM,
  CMD_NAME_QUERY_PARAM,
  CODE_QUERY_PARAM,
  CREATE_FILE_URL_PARAM,
  FILE_NAME_QUERY_PARAM,
  IMMEDIATE_SIGN_IN_IF_NECESSARY_QUERY_PARAM,
  LEGACY_SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY,
  POOL_QUERY_PARAM,
  PROJECT_ID_QUERY_PARAM,
  SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY,
  VERCEL_PLAYWRIGHT_TOKEN_QUERY_PARAM,
} from '@src/lib/constants'

export interface LaunchRequest {
  genericCommand?: {
    name: string
    groupId: string
    argDefaultValues: Record<string, string>
  }
  createFile?: {
    name?: string
    /** Base64 text; the import operation decodes the file contents. */
    code: string
  }
  projectId?: string
  zookeeperPrompt?: string
  askOpenDesktop: boolean
}

const launchKeys = [
  ASK_TO_OPEN_QUERY_PARAM,
  CMD_GROUP_QUERY_PARAM,
  CMD_NAME_QUERY_PARAM,
  CREATE_FILE_URL_PARAM,
  PROJECT_ID_QUERY_PARAM,
  SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY,
  LEGACY_SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY,
]

const reservedKeys = new Set([
  ...launchKeys,
  POOL_QUERY_PARAM,
  ALLOW_MOBILE_QUERY_PARAM,
  IMMEDIATE_SIGN_IN_IF_NECESSARY_QUERY_PARAM,
  VERCEL_PLAYWRIGHT_TOKEN_QUERY_PARAM,
  'tab',
  'sort_by',
])

/**
 * Capture one-shot launch data separately from URL state. Parsing does not
 * authorize cleanup: callers must retain the original URL until auth and the
 * web/desktop choice no longer need it for a full-page handoff.
 */
export function parseLaunchRequest(search: string): {
  request: LaunchRequest | undefined
  remainingSearch: string
} {
  const params = new URLSearchParams(search)
  const remaining = new URLSearchParams(params)
  const name = params.get(CMD_NAME_QUERY_PARAM)
  const groupId = params.get(CMD_GROUP_QUERY_PARAM)
  const hasCreateFile = params.has(CREATE_FILE_URL_PARAM)
  const askOpenDesktop = params.has(ASK_TO_OPEN_QUERY_PARAM)
  const projectId = params.get(PROJECT_ID_QUERY_PARAM) || undefined
  const zookeeperPrompt =
    (params.get(SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY) ??
      params.get(LEGACY_SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY)) ||
    undefined

  const commandArgs = [...params.entries()].filter(
    ([key]) =>
      !reservedKeys.has(key) &&
      !(
        hasCreateFile && [FILE_NAME_QUERY_PARAM, CODE_QUERY_PARAM].includes(key)
      )
  )
  // URLSearchParams already decoded the URL. Decoding again corrupts literal
  // percent escapes in command arguments and can throw for ordinary '%' text.
  const genericCommand =
    name && groupId
      ? { name, groupId, argDefaultValues: Object.fromEntries(commandArgs) }
      : undefined
  const fileName = params.get(FILE_NAME_QUERY_PARAM)
  const createFile = hasCreateFile
    ? {
        ...(fileName === null ? {} : { name: fileName }),
        code: params.get(CODE_QUERY_PARAM) ?? '',
      }
    : undefined

  // Invalid or incomplete command controls do not hold up another valid
  // request. Their unclaimed arguments remain in the URL.
  for (const key of launchKeys) {
    remaining.delete(key)
  }
  if (genericCommand) {
    for (const [key] of commandArgs) remaining.delete(key)
  }
  if (createFile) {
    remaining.delete(FILE_NAME_QUERY_PARAM)
    remaining.delete(CODE_QUERY_PARAM)
  }

  const request =
    genericCommand ||
    createFile ||
    projectId ||
    zookeeperPrompt ||
    askOpenDesktop
      ? {
          ...(genericCommand ? { genericCommand } : {}),
          ...(createFile ? { createFile } : {}),
          ...(projectId ? { projectId } : {}),
          ...(zookeeperPrompt ? { zookeeperPrompt } : {}),
          askOpenDesktop,
        }
      : undefined
  const remainingQuery = remaining.toString()
  return {
    request,
    remainingSearch: remainingQuery ? `?${remainingQuery}` : '',
  }
}
