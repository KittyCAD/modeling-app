import type { AnySetting, SettingsValue } from '@src/contracts/settings'
import { parse, stringify } from 'smol-toml'

type TomlTable = Record<string, unknown>

/**
 * The header written above every generated settings file.
 *
 * A TOML parser drops comments, so anything anyone else wrote in the file is
 * lost on the next write. Saying so in the file is the only honest option short
 * of a format-preserving parser.
 */
export const SETTINGS_FILE_HEADER = `# Written by Zoo Design Studio.
# Keys this app does not recognise are preserved, but comments and formatting
# are not: editing here is fine, decorating it is not worth the effort.
`

export interface DecodedSettings {
  /** Values that parsed, by setting id. */
  overrides: Record<string, unknown>
  /** Ids whose stored value was present but rejected, for reporting. */
  rejected: string[]
}

/** Read a leaf out of a nested table, following a `toml` path. */
function readPath(root: TomlTable, path: readonly string[]): unknown {
  let node: unknown = root
  for (const key of path) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as TomlTable)[key]
  }
  return node
}

function writePath(
  root: TomlTable,
  path: readonly string[],
  value: SettingsValue
): void {
  let node = root
  for (const key of path.slice(0, -1)) {
    const next = node[key]
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      node[key] = {}
    }
    node = node[key] as TomlTable
  }
  node[path.at(-1) as string] = value
}

/**
 * Remove a leaf, then any table the removal left empty.
 *
 * Only tables along the deleted path are considered, so a table holding keys
 * this app does not understand is never touched. An empty table and an absent
 * one mean the same thing to the schema, which is what makes the pruning safe.
 */
function deletePath(root: TomlTable, path: readonly string[]): void {
  const chain: TomlTable[] = [root]
  let node: unknown = root
  for (const key of path.slice(0, -1)) {
    if (typeof node !== 'object' || node === null) return
    node = (node as TomlTable)[key]
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return
    chain.push(node as TomlTable)
  }

  const leaf = chain.at(-1) as TomlTable
  delete leaf[path.at(-1) as string]

  for (let depth = chain.length - 1; depth > 0; depth -= 1) {
    const table = chain[depth]
    if (Object.keys(table).length > 0) break
    delete chain[depth - 1][path[depth - 1]]
  }
}

/**
 * Pull the settings this app knows about out of a TOML file.
 *
 * Anything else in the file is ignored rather than an error: `project.toml`
 * carries cloud metadata and a project id that have nothing to do with
 * preferences, and a settings reader that chokes on them is a settings reader
 * that breaks every time another subsystem adds a field.
 */
export function decodeSettingsToml(
  text: string,
  definitions: readonly AnySetting[]
): DecodedSettings {
  const table = (parse(text) ?? {}) as TomlTable
  const overrides: Record<string, unknown> = {}
  const rejected: string[] = []

  for (const definition of definitions) {
    const raw = readPath(table, definition.toml)
    if (raw === undefined) continue
    const parsed = definition.parse(raw)
    if (parsed === undefined) {
      rejected.push(definition.id)
      continue
    }
    overrides[definition.id] = parsed
  }

  return { overrides, rejected }
}

/**
 * Write overrides back into a settings file, keeping everything else.
 *
 * Throws when the existing text is not valid TOML. Overwriting a file we cannot
 * read would silently discard whatever the person was in the middle of editing,
 * so failing to save is the better outcome — the caller reports it and the value
 * stays live for the session.
 */
export function encodeSettingsToml(
  existingText: string | null,
  definitions: readonly AnySetting[],
  overrides: Record<string, unknown>
): string {
  const table = existingText
    ? ((parse(existingText) ?? {}) as TomlTable)
    : ({} as TomlTable)

  for (const definition of definitions) {
    const value = overrides[definition.id]
    if (value === undefined) {
      deletePath(table, definition.toml)
      continue
    }
    const serialized = definition.serialize
      ? definition.serialize(value)
      : (value as SettingsValue)
    writePath(table, definition.toml, serialized)
  }

  const body = stringify(table)
  return body.length > 0
    ? `${SETTINGS_FILE_HEADER}\n${body}\n`
    : SETTINGS_FILE_HEADER
}

/** Per-project overrides, at the project root. Also holds the project title. */
export const PROJECT_SETTINGS_FILE = 'project.toml'
/** User-level overrides, in the app's configuration directory. */
export const USER_SETTINGS_FILE = 'user.toml'
