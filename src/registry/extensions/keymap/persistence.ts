import { KEYMAP_FILE_NAME } from '@src/lib/constants'
import { getAppSettingsFilePath } from '@src/lib/desktop'
import { FileNotFound } from '@src/lib/fileSystem/fileOperations'
import fsZds from '@src/lib/fs-zds'
import { isArray } from '@src/lib/utils'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import {
  createEmptyPersistedKeymap,
  KEYMAP_SCHEMA_VERSION,
  type KeymapArguments,
  type KeymapBinding,
  normalizePersistedKeymap,
  type PersistedKeymap,
} from '@src/registry/contracts/keymap'
import { parse, stringify } from 'smol-toml'

export async function getUserKeymapFilePath() {
  const settingsFilePath = await getAppSettingsFilePath()
  return fsZds.join(fsZds.dirname(settingsFilePath), KEYMAP_FILE_NAME)
}

export async function readUserKeymapFile(
  fileOperations: FileOperationsRegistryService
): Promise<PersistedKeymap> {
  const keymapFilePath = await getUserKeymapFilePath()

  try {
    await fileOperations.stat(keymapFilePath)
  } catch (error) {
    if (error instanceof FileNotFound) {
      return createEmptyPersistedKeymap()
    }

    return Promise.reject(error)
  }

  const content = new TextDecoder().decode(
    await fileOperations.readFile(keymapFilePath)
  )
  return parsePersistedKeymap(parse(content))
}

export async function writeUserKeymapFile(
  fileOperations: FileOperationsRegistryService,
  keymap: PersistedKeymap
) {
  const keymapFilePath = await getUserKeymapFilePath()
  await fileOperations.writeFile(
    keymapFilePath,
    new TextEncoder().encode(stringify(serializePersistedKeymap(keymap)))
  )
}

export function serializePersistedKeymap(keymap: PersistedKeymap) {
  const normalizedKeymap = normalizePersistedKeymap(keymap)
  return {
    version: KEYMAP_SCHEMA_VERSION,
    bindings: normalizedKeymap.bindings.map(({ when, ...binding }) => {
      return {
        ...binding,
        ...(when && when.length > 0 ? { when, scopes: when } : {}),
      }
    }),
  }
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
      when: parseKeymapWhen(value),
      title: typeof value.title === 'string' ? value.title : undefined,
    },
  ]
}

function parseKeymapWhen(value: Record<string, unknown>) {
  const condition = isArray(value.when)
    ? value.when
    : isArray(value.scopes)
      ? value.scopes
      : undefined

  if (condition) {
    const when = [
      ...new Set(
        condition.flatMap((context) =>
          typeof context === 'string' && context.trim() ? [context.trim()] : []
        )
      ),
    ]
    return when.length > 0 ? when : undefined
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
