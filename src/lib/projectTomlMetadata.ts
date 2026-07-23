import { isArray } from '@src/lib/utils'
import {
  parse as parseToml,
  stringify as stringifyToml,
  type TomlTable,
  type TomlValue,
} from 'smol-toml'

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

export function getProjectTitleFromProjectTomlContents(contents: string) {
  const table = parseProjectToml(contents)
  if (!table) {
    return undefined
  }

  return getNonEmptyString(table.title)
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

  return stringifyProjectToml(nextTable)
}

export function setCloudProjectIdInProjectTomlContents(
  contents: string,
  environmentName: string,
  projectId: string
) {
  const table = parseProjectToml(contents) ?? {}
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
