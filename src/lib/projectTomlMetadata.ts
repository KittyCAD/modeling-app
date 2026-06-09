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

function isTomlTable(value: TomlValue | undefined): value is TomlTable {
  return (
    typeof value === 'object' &&
    value !== null &&
    !isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

function getOrCreateTomlTable(table: TomlTable, key: string): TomlTable {
  const existingValue = table[key]
  if (isTomlTable(existingValue)) {
    return existingValue
  }

  const nextValue: TomlTable = {}
  table[key] = nextValue
  return nextValue
}

function getProjectMetaTable(table: TomlTable) {
  const settings = table.settings
  if (!isTomlTable(settings)) {
    return undefined
  }

  const meta = settings.meta
  return isTomlTable(meta) ? meta : undefined
}

function getOrCreateProjectMetaTable(table: TomlTable) {
  return getOrCreateTomlTable(getOrCreateTomlTable(table, 'settings'), 'meta')
}

function getNonEmptyString(value: TomlValue | undefined) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function getProjectTitleFromProjectTomlContents(contents: string) {
  const table = parseProjectToml(contents)
  if (!table) {
    return undefined
  }

  return (
    getNonEmptyString(getProjectMetaTable(table)?.title) ??
    getNonEmptyString(table.title)
  )
}

export function setProjectTitleInProjectTomlContents(
  contents: string,
  title: string
) {
  const table = parseProjectToml(contents) ?? {}
  getOrCreateProjectMetaTable(table).title = title
  return stringifyToml(table)
}
