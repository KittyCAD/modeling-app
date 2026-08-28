import { parse, stringify } from 'smol-toml'
import type {
  Keybinding,
  PersistedBinding,
  PersistedKeymap,
} from '@src/contracts/keybindings'

/**
 * The user's keymap: its format, and how it folds into what features shipped.
 *
 * All pure. Reading and writing it is somewhere else, so the interesting part —
 * what a stored line *means* — is testable without a filesystem.
 */

export const KEYMAP_VERSION = 1

export const emptyKeymap = (): PersistedKeymap => ({
  version: KEYMAP_VERSION,
  bindings: [],
})

const UNBIND_PREFIX = '-'

export const isUnbind = (command: string) => command.startsWith(UNBIND_PREFIX)

export const boundCommand = (command: string) =>
  isUnbind(command) ? command.slice(UNBIND_PREFIX.length) : command

/**
 * Fold the user's keymap into the contributed bindings.
 *
 * Two rules, and they are the whole model:
 *
 * - **A stored binding for a command replaces every contributed binding for
 *   that command.** Per command rather than per binding, because that is the
 *   question someone is answering — "I want this action on these keys" — and
 *   they neither know nor care how many bindings the app shipped for it. Write
 *   several lines for one command and all of them apply.
 * - **`-command` removes the command's keys** without putting anything back.
 *
 * User bindings come first in the result, so that when someone takes a chord the
 * app was already using, theirs is the one that fires. The collision is still
 * visible: both bindings are in the list, and the dialog can say so.
 */
export function resolveBindings(
  contributed: readonly Keybinding[],
  persisted: PersistedKeymap
): readonly Keybinding[] {
  const claimed = new Set<string>()
  const user: Keybinding[] = []

  for (const line of persisted.bindings) {
    const commandId = boundCommand(line.command)
    if (!commandId) continue

    claimed.add(commandId)
    if (isUnbind(line.command)) continue

    const keystrokes = (line.keystrokes ?? []).filter(Boolean)
    if (keystrokes.length === 0) continue

    user.push({
      keystrokes,
      commandId,
      scopes: line.scopes,
      source: 'user',
    })
  }

  const app = contributed
    .filter((binding) => !claimed.has(binding.commandId))
    .map((binding) => ({ ...binding, source: 'app' as const }))

  return [...user, ...app]
}

/** The stored lines that concern one command, with where they sit in the file. */
export function persistedFor(
  keymap: PersistedKeymap,
  commandId: string
): readonly { binding: PersistedBinding; index: number }[] {
  return keymap.bindings.flatMap((binding, index) =>
    boundCommand(binding.command) === commandId ? [{ binding, index }] : []
  )
}

/** Replace a command's stored lines with one that binds it to these keys. */
export function withRebind(
  keymap: PersistedKeymap,
  commandId: string,
  keystrokes: readonly string[],
  scopes?: readonly string[]
): PersistedKeymap {
  return {
    version: KEYMAP_VERSION,
    bindings: [
      ...keymap.bindings.filter(
        (binding) => boundCommand(binding.command) !== commandId
      ),
      { command: commandId, keystrokes, ...(scopes ? { scopes } : {}) },
    ],
  }
}

/** Replace a command's stored lines with an unbind. */
export function withUnbind(
  keymap: PersistedKeymap,
  commandId: string
): PersistedKeymap {
  return {
    version: KEYMAP_VERSION,
    bindings: [
      ...keymap.bindings.filter(
        (binding) => boundCommand(binding.command) !== commandId
      ),
      { command: `${UNBIND_PREFIX}${commandId}` },
    ],
  }
}

export function withoutLine(
  keymap: PersistedKeymap,
  index: number
): PersistedKeymap {
  return {
    version: KEYMAP_VERSION,
    bindings: keymap.bindings.filter((_binding, at) => at !== index),
  }
}

/**
 * Read a keymap file.
 *
 * Every failure is the same failure — a keymap that cannot be understood — and
 * the answer to all of them is an empty keymap rather than an exception, because
 * a broken keymap file must not be a broken app. Lines that do not parse are
 * dropped individually, so one bad entry does not cost the rest.
 */
export function parseKeymap(text: string): PersistedKeymap {
  let document: unknown
  try {
    document = parse(text)
  } catch {
    return emptyKeymap()
  }

  if (typeof document !== 'object' || document === null) return emptyKeymap()

  const record = document as Record<string, unknown>
  // A file from a future version is not guessed at. It is left alone, which
  // matters because we are about to write over it only if the user edits keys.
  if (record.version !== undefined && record.version !== KEYMAP_VERSION) {
    return emptyKeymap()
  }

  const lines = Array.isArray(record.bindings) ? record.bindings : []

  return {
    version: KEYMAP_VERSION,
    bindings: lines.flatMap((line) => parseLine(line)),
  }
}

function parseLine(value: unknown): PersistedBinding[] {
  if (typeof value !== 'object' || value === null) return []

  const line = value as Record<string, unknown>
  if (typeof line.command !== 'string' || line.command.length === 0) return []

  const keystrokes = Array.isArray(line.keystrokes)
    ? line.keystrokes.filter(
        (chord): chord is string =>
          typeof chord === 'string' && chord.length > 0
      )
    : undefined

  // A binding with no keys is only meaningful as an unbind.
  if (!isUnbind(line.command) && (!keystrokes || keystrokes.length === 0)) {
    return []
  }

  const scopes = Array.isArray(line.scopes)
    ? line.scopes.filter(
        (scope): scope is string =>
          typeof scope === 'string' && scope.length > 0
      )
    : undefined

  return [
    {
      command: line.command,
      ...(keystrokes && keystrokes.length > 0 ? { keystrokes } : {}),
      ...(scopes && scopes.length > 0 ? { scopes } : {}),
    },
  ]
}

/**
 * Write a keymap file.
 *
 * TOML, and an array of tables, so the file reads as a list of decisions:
 *
 * ```toml
 * version = 1
 *
 * [[bindings]]
 * command = "files.newFile"
 * keystrokes = ["Mod+N"]
 * ```
 */
export function serialiseKeymap(keymap: PersistedKeymap): string {
  return stringify({
    version: KEYMAP_VERSION,
    bindings: keymap.bindings.map((binding) => ({
      command: binding.command,
      ...(binding.keystrokes ? { keystrokes: [...binding.keystrokes] } : {}),
      ...(binding.scopes ? { scopes: [...binding.scopes] } : {}),
    })),
  })
}
