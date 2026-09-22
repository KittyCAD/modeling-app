import { isArray } from '@src/lib/utils'
import {
  parse as parseToml,
  stringify as stringifyToml,
  type TomlTable,
  type TomlValue,
} from 'smol-toml'
import { REGEXP_UUIDV4 } from '@src/lib/constants'
import { isErr } from '@src/lib/trap'

function parseProjectToml(contents: string): TomlTable | undefined {
  try {
    return parseToml(contents)
  } catch {
    return undefined
  }
}

function getNonEmptyString(value: TomlValue | undefined) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function isTomlTable(value: TomlValue | undefined): value is TomlTable {
  return (
    typeof value === 'object' &&
    value !== null &&
    !isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

function isEmptyTomlTable(value: TomlTable) {
  return Object.keys(value).length === 0
}

const ROOT_SCALAR_KEY_ORDER = ['title', 'default_file']
const ROOT_TABLE_KEY_ORDER = ['settings', 'cloud']
const SETTINGS_TABLE_KEY_ORDER = ['app', 'meta', 'modeling']
const CLOUD_ENVIRONMENT_SCALAR_KEY_ORDER = ['project_id']

function normalizeProjectTomlPath(path: string) {
  return path
    .replaceAll('\\', '/')
    .replace(/^\/+/g, '')
    .replace(/^(?:\.\/)+/g, '')
}

function orderedKeys(keys: string[], preferredKeys: string[]) {
  return [
    ...preferredKeys.filter((key) => keys.includes(key)),
    ...keys
      .filter((key) => !preferredKeys.includes(key))
      .toSorted((a, b) => a.localeCompare(b)),
  ]
}

function scalarKeyOrderForPath(path: string[]) {
  if (path.length === 0) {
    return ROOT_SCALAR_KEY_ORDER
  }
  if (path[0] === 'cloud' && path.length === 2) {
    return CLOUD_ENVIRONMENT_SCALAR_KEY_ORDER
  }
  return []
}

function tableKeyOrderForPath(path: string[]) {
  if (path.length === 0) {
    return ROOT_TABLE_KEY_ORDER
  }
  if (path.length === 1 && path[0] === 'settings') {
    return SETTINGS_TABLE_KEY_ORDER
  }
  return []
}

function normalizeTomlValue(value: TomlValue, path: string[]): TomlValue {
  if (isTomlTable(value)) {
    return normalizeTomlTable(value, path)
  }
  if (isArray(value)) {
    return value.map((item) => normalizeTomlValue(item, path))
  }
  return value
}

function normalizeTomlTable(table: TomlTable, path: string[] = []) {
  const nextTable: TomlTable = {}
  const scalarKeys: string[] = []
  const tableKeys: string[] = []

  for (const [key, value] of Object.entries(table)) {
    if (isTomlTable(value)) {
      tableKeys.push(key)
    } else {
      scalarKeys.push(key)
    }
  }

  for (const key of orderedKeys(scalarKeys, scalarKeyOrderForPath(path))) {
    nextTable[key] = normalizeTomlValue(table[key], [...path, key])
  }
  for (const key of orderedKeys(tableKeys, tableKeyOrderForPath(path))) {
    nextTable[key] = normalizeTomlValue(table[key], [...path, key])
  }

  return nextTable
}

function stringifyProjectToml(table: TomlTable) {
  return stringifyToml(normalizeTomlTable(table))
}

export function normalizeProjectTomlContents(contents: string) {
  const table = parseProjectToml(contents)
  if (!table) {
    return contents
  }
  return stringifyProjectToml(table)
}

export function getProjectDefaultFileFromProjectTomlContents(contents: string) {
  const table = parseProjectToml(contents)
  if (!table) {
    return undefined
  }

  const defaultFile = getNonEmptyString(table.default_file)
  return defaultFile ? normalizeProjectTomlPath(defaultFile) : undefined
}

export function getProjectTitleFromProjectTomlContents(contents: string) {
  const table = parseProjectToml(contents)
  if (!table) {
    return undefined
  }

  return getNonEmptyString(table.title)
}

export function getProjectIdFromProjectTomlContents(contents: string) {
  const table = parseProjectToml(contents)
  if (
    !table ||
    !isTomlTable(table.settings) ||
    !isTomlTable(table.settings.meta)
  ) {
    return undefined
  }

  return getNonEmptyString(table.settings.meta.id)
}

export function setProjectIdInProjectTomlContents(
  contents: string,
  projectId: string
) {
  const table = parseProjectToml(contents)
  if (!table) {
    return new Error('Unable to parse project.toml while updating project ID')
  }

  if (!isTomlTable(table.settings)) {
    table.settings = {}
  }
  const settings = table.settings
  if (!isTomlTable(settings.meta)) {
    settings.meta = {}
  }
  settings.meta.id = projectId
  delete settings.zookeeper

  return stringifyProjectToml(table)
}

/** Undefined permits legacy migration; an empty string means no saved conversation. */
export function getZookeeperConversationIdFromProjectTomlContents(
  contents: string,
  environmentName: string
): string | undefined | Error {
  const table = parseProjectToml(contents)
  if (!table) {
    return new Error(
      'Unable to parse project.toml while reading Zookeeper conversation'
    )
  }
  if (!isTomlTable(table.settings) || table.settings.zookeeper === undefined) {
    return undefined
  }
  const zookeeper = table.settings.zookeeper
  if (!isTomlTable(zookeeper)) {
    return new Error('Invalid Zookeeper metadata in project.toml')
  }
  const environment = zookeeper[environmentName]
  // Once migrated, never reuse the unscoped legacy mapping in another environment.
  if (environment === undefined) {
    return ''
  }
  if (!isTomlTable(environment)) {
    return new Error('Invalid Zookeeper environment metadata in project.toml')
  }
  const conversationId = environment.conversation_id
  if (conversationId === undefined || conversationId === '') {
    return ''
  }
  if (
    typeof conversationId !== 'string' ||
    !REGEXP_UUIDV4.test(conversationId)
  ) {
    return new Error('Invalid Zookeeper conversation ID in project.toml')
  }
  return conversationId
}

export function setZookeeperConversationInProjectTomlContents(
  contents: string,
  environmentName: string,
  conversationId: string | undefined
): string | Error {
  const current = getZookeeperConversationIdFromProjectTomlContents(
    contents,
    environmentName
  )
  if (isErr(current)) {
    return current
  }
  if (conversationId !== undefined && !REGEXP_UUIDV4.test(conversationId)) {
    return new Error('Invalid Zookeeper conversation ID')
  }
  const table = parseProjectToml(contents)
  if (!table) {
    return new Error(
      'Unable to parse project.toml while saving Zookeeper conversation'
    )
  }
  if (!isTomlTable(table.settings)) {
    table.settings = {}
  }
  const settings = table.settings
  if (!isTomlTable(settings.zookeeper)) {
    settings.zookeeper = {}
  }
  const zookeeper = settings.zookeeper
  if (!isTomlTable(zookeeper[environmentName])) {
    zookeeper[environmentName] = {}
  }
  const environment = zookeeper[environmentName]
  if (environment.conversation_id === (conversationId ?? '')) {
    return contents
  }
  // An explicit empty ID prevents a stale local mapping from resurrecting cleared chat.
  environment.conversation_id = conversationId ?? ''
  return stringifyProjectToml(table)
}

export function setProjectTitleInProjectTomlContents(
  contents: string,
  title: string
) {
  const table = parseProjectToml(contents) ?? {}
  table.title = title
  return stringifyProjectToml(table)
}

export function prepareProjectTomlForDuplication(
  contents: string,
  title: string,
  projectId: string
) {
  const table = parseProjectToml(contents)
  if (!table) {
    return new Error('Unable to parse project.toml while duplicating project')
  }

  table.title = title
  delete table.cloud

  if (!isTomlTable(table.settings)) {
    table.settings = {}
  }
  const settings = table.settings
  if (!isTomlTable(settings.meta)) {
    settings.meta = {}
  }
  settings.meta.id = projectId
  delete settings.zookeeper

  return stringifyProjectToml(table)
}

export function setProjectDefaultFileInProjectTomlContents(
  contents: string,
  defaultFile: string
) {
  const table = parseProjectToml(contents) ?? {}
  table.default_file = normalizeProjectTomlPath(defaultFile)
  return stringifyProjectToml(table)
}

export function preserveProjectTomlMetadataInProjectSettingsContents(
  existingContents: string,
  nextProjectSettingsContents: string
) {
  const existingTable = parseProjectToml(existingContents)
  if (!existingTable) {
    return normalizeProjectTomlContents(nextProjectSettingsContents)
  }

  const nextTable = parseProjectToml(nextProjectSettingsContents) ?? {}
  for (const [key, value] of Object.entries(existingTable)) {
    if (key !== 'settings' && !(key in nextTable)) {
      nextTable[key] = value
    }
  }

  // Conversation metadata is owned by the conversation store, not the settings form.
  if (
    isTomlTable(existingTable.settings) &&
    existingTable.settings.zookeeper !== undefined
  ) {
    if (!isTomlTable(nextTable.settings)) {
      nextTable.settings = {}
    }
    nextTable.settings.zookeeper = existingTable.settings.zookeeper
  }

  return stringifyProjectToml(nextTable)
}

export function setCloudProjectIdInProjectTomlContents(
  contents: string,
  environmentName: string,
  projectId: string
) {
  const table = parseProjectToml(contents)
  if (!table) {
    return new Error(
      'Unable to parse project.toml while updating cloud project ID'
    )
  }
  if (!isTomlTable(table.cloud)) {
    table.cloud = {}
  }

  const cloud = table.cloud
  let environment = cloud[environmentName]
  if (!isTomlTable(environment)) {
    environment = {}
    cloud[environmentName] = environment
  }

  environment.project_id = projectId
  return stringifyProjectToml(table)
}

export function getCloudProjectIdFromProjectTomlContents(
  contents: string,
  environmentName?: string
) {
  const table = parseProjectToml(contents)
  if (!table || !isTomlTable(table.cloud)) {
    return undefined
  }

  if (environmentName) {
    const environment = table.cloud[environmentName]
    if (!isTomlTable(environment)) {
      return undefined
    }
    return getNonEmptyString(environment.project_id)
  }

  for (const environment of Object.values(table.cloud)) {
    if (!isTomlTable(environment)) {
      continue
    }
    const projectId = getNonEmptyString(environment.project_id)
    if (projectId) {
      return projectId
    }
  }

  return undefined
}

export function removeCloudProjectIdFromProjectTomlContents(
  contents: string,
  environmentName: string
) {
  const table = parseProjectToml(contents)
  if (!table || !isTomlTable(table.cloud)) {
    return contents
  }

  const environment = table.cloud[environmentName]
  if (!isTomlTable(environment)) {
    return contents
  }

  delete environment.project_id
  if (isEmptyTomlTable(environment)) {
    delete table.cloud[environmentName]
  }
  if (isEmptyTomlTable(table.cloud)) {
    delete table.cloud
  }

  return stringifyProjectToml(table)
}
