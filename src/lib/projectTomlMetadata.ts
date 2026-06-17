import { isArray } from '@src/lib/utils'
import {
  type TomlTable,
  type TomlValue,
  parse as parseToml,
  stringify as stringifyToml,
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
  return stringifyToml(table)
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
  return stringifyToml(table)
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
