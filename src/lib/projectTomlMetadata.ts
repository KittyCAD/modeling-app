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
