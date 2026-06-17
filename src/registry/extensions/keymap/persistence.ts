import { KEYMAP_FILE_NAME } from '@src/lib/constants'
import { getAppSettingsFilePath } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import { isArray } from '@src/lib/utils'
import {
  KEYMAP_SCHEMA_VERSION,
  type KeymapArguments,
  type KeymapBinding,
  type PersistedKeymap,
  createEmptyPersistedKeymap,
} from '@src/registry/contracts/keymap'
import { parse, stringify } from 'smol-toml'

export async function getUserKeymapFilePath() {
  const settingsFilePath = await getAppSettingsFilePath()
  return fsZds.join(fsZds.dirname(settingsFilePath), KEYMAP_FILE_NAME)
}

export async function readUserKeymapFile(): Promise<PersistedKeymap> {
  const keymapFilePath = await getUserKeymapFilePath()

  try {
    await fsZds.stat(keymapFilePath)
  } catch (error) {
    if (error === 'ENOENT') {
      return createEmptyPersistedKeymap()
    }

    return Promise.reject(error)
  }

  const content = await fsZds.readFile(keymapFilePath, {
    encoding: 'utf-8',
  })
  return parsePersistedKeymap(parse(content))
}

export async function writeUserKeymapFile(keymap: PersistedKeymap) {
  const keymapFilePath = await getUserKeymapFilePath()
  await fsZds.writeFile(
    keymapFilePath,
    new TextEncoder().encode(stringify(keymap))
  )
}

export function parsePersistedKeymap(value: unknown): PersistedKeymap {
  if (!isRecord(value)) {
    return createEmptyPersistedKeymap()
  }

  const version = KEYMAP_SCHEMA_VERSION
  const bindings = isArray(value.bindings)
    ? value.bindings.flatMap((binding) => parsePersistedKeymapBinding(binding))
    : []

  return { version, bindings }
}

function parsePersistedKeymapBinding(value: unknown): KeymapBinding[] {
  if (!isRecord(value)) {
    return []
  }

  if (typeof value.command !== 'string' || !isArray(value.keystrokes)) {
    return []
  }

  const keystrokes = value.keystrokes.filter(
    (chord): chord is string => typeof chord === 'string' && chord.length > 0
  )
  if (keystrokes.length === 0) {
    return []
  }

  return [
    {
      command: value.command,
      keystrokes,
      arguments: isKeymapArguments(value.arguments)
        ? value.arguments
        : undefined,
      scopes: parseKeymapScopes(value),
      title: typeof value.title === 'string' ? value.title : undefined,
    },
  ]
}

function parseKeymapScopes(value: Record<string, unknown>) {
  if (isArray(value.scopes)) {
    const scopes = value.scopes.filter(
      (scope): scope is string => typeof scope === 'string' && scope.length > 0
    )
    return scopes.length > 0 ? scopes : undefined
  }

  return undefined
}

function isKeymapArguments(value: unknown): value is KeymapArguments {
  if (
    value === undefined ||
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return true
  }

  if (isArray(value)) {
    return value.every(isKeymapArguments)
  }

  if (isRecord(value)) {
    return Object.values(value).every(isKeymapArguments)
  }

  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !isArray(value)
}
