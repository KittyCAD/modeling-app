import type { FuseResult } from 'fuse.js'

import type { Command } from '@src/lib/commandTypes'
import { commandKey } from '@src/lib/commandUtils'

export const COMMAND_PALETTE_USAGE_STORAGE_KEY = 'zoo.commandPalette.usage'

const STORAGE_VERSION = 1
const MAX_HISTORY_ENTRIES = 100
const MAX_USAGE_COUNT = 1_000_000

export type CommandUsageEntry = {
  count: number
  lastUsedAt: number
}

export type CommandUsageHistory = ReadonlyMap<string, CommandUsageEntry>

type CommandUsageStorage = Pick<Storage, 'getItem' | 'setItem'>

function getLocalStorage(): CommandUsageStorage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function usageKey(command: Command) {
  const key = commandKey(command)
  return !command.id && command.displayName
    ? `${key}:${command.displayName}`
    : key
}

function isUsageEntry(value: unknown): value is CommandUsageEntry {
  return (
    isRecord(value) &&
    typeof value.count === 'number' &&
    Number.isInteger(value.count) &&
    value.count > 0 &&
    typeof value.lastUsedAt === 'number' &&
    Number.isFinite(value.lastUsedAt) &&
    value.lastUsedAt >= 0
  )
}

function newestEntries(history: CommandUsageHistory) {
  return [...history.entries()]
    .sort((a, b) => b[1].lastUsedAt - a[1].lastUsedAt)
    .slice(0, MAX_HISTORY_ENTRIES)
}

export function readCommandPaletteUsage(
  storage: CommandUsageStorage | undefined = getLocalStorage()
): CommandUsageHistory {
  if (!storage) {
    return new Map()
  }

  try {
    const serialized = storage.getItem(COMMAND_PALETTE_USAGE_STORAGE_KEY)
    if (!serialized) {
      return new Map()
    }
    const parsed: unknown = JSON.parse(serialized)
    if (
      !isRecord(parsed) ||
      parsed.version !== STORAGE_VERSION ||
      !isRecord(parsed.commands)
    ) {
      return new Map()
    }

    const history = new Map<string, CommandUsageEntry>()
    for (const [key, value] of Object.entries(parsed.commands)) {
      if (isUsageEntry(value)) {
        history.set(key, {
          count: Math.min(value.count, MAX_USAGE_COUNT),
          lastUsedAt: Math.floor(value.lastUsedAt),
        })
      }
    }
    return new Map(newestEntries(history))
  } catch {
    return new Map()
  }
}

export function recordCommandPaletteUsage(
  command: Command,
  now = Date.now(),
  storage: CommandUsageStorage | undefined = getLocalStorage()
) {
  if (!storage) {
    return
  }

  const history = new Map(readCommandPaletteUsage(storage))
  const key = usageKey(command)
  history.set(key, {
    count: Math.min((history.get(key)?.count ?? 0) + 1, MAX_USAGE_COUNT),
    lastUsedAt: Number.isFinite(now)
      ? Math.max(0, Math.floor(now))
      : Date.now(),
  })

  try {
    storage.setItem(
      COMMAND_PALETTE_USAGE_STORAGE_KEY,
      JSON.stringify({
        version: STORAGE_VERSION,
        commands: Object.fromEntries(newestEntries(history)),
      })
    )
  } catch {
    return
  }
}

type IsCommandDisabled = (command: Command) => boolean

function compareUsage(a: Command, b: Command, history: CommandUsageHistory) {
  const aUsage = history.get(usageKey(a))
  const bUsage = history.get(usageKey(b))

  if (!aUsage || !bUsage) {
    return Number(!aUsage) - Number(!bUsage)
  }
  return bUsage.count - aUsage.count || bUsage.lastUsedAt - aUsage.lastUsedAt
}

export function rankCommandSearchResults(
  results: readonly FuseResult<Command>[],
  history: CommandUsageHistory,
  isDisabled: IsCommandDisabled
) {
  return [...results]
    .sort(
      (a, b) =>
        Number(isDisabled(a.item)) - Number(isDisabled(b.item)) ||
        compareUsage(a.item, b.item, history) ||
        (a.score ?? 1) - (b.score ?? 1) ||
        a.refIndex - b.refIndex
    )
    .map(({ item }) => item)
}
