import {
  BASE_KEYMAP_SCOPE,
  type KeymapArguments,
  type KeymapBinding,
  type KeymapItem,
  USER_KEYMAP_SOURCE,
  areKeymapKeystrokesEqual,
  doesKeymapBindingOverrideItem,
  doesKeymapUnbindBindingMatchItem,
  isUnboundKeymapCommand,
} from '@src/registry/contracts/keymap'

/**
 * How a row in the keybindings table relates to app-provided keymap items and
 * persisted user keymap TOML.
 *
 * - `app`: an app-provided keybinding with no matching user entry.
 * - `override`: an app-provided keybinding shown with a matching user entry's
 *   editable values.
 * - `unbound`: an app-provided keybinding whose matching user entry disables
 *   the default binding.
 * - `user`: a user-created keybinding that does not override an app-provided
 *   item.
 */
export type KeybindingRowState = 'app' | 'override' | 'unbound' | 'user'

/**
 * UI projection of app-provided keymap items and persisted user keymap TOML.
 */
export type KeybindingRow = {
  id: string
  state: KeybindingRowState
  /**
   * The app-provided keymap item this row represents. Undefined for standalone
   * user-created rows.
   */
  appItem?: KeymapItem
  /**
   * The persisted user binding currently backing this row, either as an
   * override/unbind of an app item or as a standalone user-created binding.
   */
  userBinding?: KeymapBinding
  /**
   * Index of `userBinding` inside the persisted TOML bindings array, used to
   * replace or remove the correct entry when editing.
   */
  userBindingIndex?: number
  /**
   * Effective command displayed by the row. App-backed rows keep the app
   * command even when overridden so user edits continue to target that item.
   */
  command: string
  /**
   * Effective title displayed by the row, preferring a user override title when
   * present.
   */
  title: string
  /**
   * Effective keystrokes displayed and edited by the row. Unbound rows expose
   * an empty list because the user TOML disables the app binding.
   */
  keystrokes: readonly string[]
  /**
   * Effective serializable command arguments displayed by the row.
   */
  arguments?: KeymapArguments
  /**
   * Effective scopes displayed and edited by the row.
   */
  scopes?: readonly string[]
  /**
   * Display source for the row. App-backed rows keep the original app source
   * even when overridden; standalone user rows use the user source.
   */
  source: string
}

export type KeybindingConflict = {
  row: KeybindingRow
}

export function getKeybindingRows(
  appItems: readonly KeymapItem[],
  userBindings: readonly KeymapBinding[]
): KeybindingRow[] {
  const claimedUserBindingIndexes = new Set<number>()
  const rows: KeybindingRow[] = []

  for (const item of appItems) {
    const matches = userBindings.flatMap((binding, index) =>
      doesUserBindingApplyToAppItem(binding, item) ? [{ binding, index }] : []
    )
    for (const match of matches) {
      claimedUserBindingIndexes.add(match.index)
    }

    if (item.hidden) {
      continue
    }

    const effectiveMatch = matches.at(-1)
    if (
      effectiveMatch &&
      isUnboundKeymapCommand(effectiveMatch.binding.command)
    ) {
      rows.push(
        createAppRow(item, {
          state: 'unbound',
          userBinding: effectiveMatch.binding,
          userBindingIndex: effectiveMatch.index,
          keystrokes: [],
        })
      )
      continue
    }

    if (effectiveMatch) {
      rows.push(
        createAppRow(item, {
          state: 'override',
          userBinding: effectiveMatch.binding,
          userBindingIndex: effectiveMatch.index,
        })
      )
      continue
    }

    rows.push(createAppRow(item, { state: 'app' }))
  }

  for (const [index, binding] of userBindings.entries()) {
    if (
      claimedUserBindingIndexes.has(index) ||
      isUnboundKeymapCommand(binding.command)
    ) {
      continue
    }

    rows.push({
      id: `user.${index}.${binding.command}`,
      state: 'user',
      userBinding: binding,
      userBindingIndex: index,
      command: binding.command,
      title: binding.title ?? binding.command,
      keystrokes: binding.keystrokes,
      arguments: binding.arguments,
      scopes: binding.scopes,
      source: USER_KEYMAP_SOURCE,
    })
  }

  return rows.toSorted(compareKeybindingRows)
}

export function createRowUserBinding(
  row: KeybindingRow,
  keystrokes: readonly string[],
  scopes: readonly string[] | undefined
): KeymapBinding {
  if (row.state === 'user' && row.userBinding) {
    return {
      ...row.userBinding,
      keystrokes,
      scopes: serializeKeymapScopes(scopes),
    }
  }

  const appItem = row.appItem
  const title = row.userBinding?.title
  return {
    command: row.command,
    ...(title !== undefined ? { title } : {}),
    keystrokes,
    arguments: appItem?.arguments,
    scopes: serializeKeymapScopes(scopes),
  }
}

export function findKeybindingConflict(
  rows: readonly KeybindingRow[],
  candidate: {
    id?: string
    keystrokes: readonly string[]
    scopes?: readonly string[]
  }
): KeybindingConflict | undefined {
  if (candidate.keystrokes.length === 0) {
    return undefined
  }

  const candidateScopes = normalizeVisibleKeymapScopes(candidate.scopes)

  const conflictingRow = rows.find((row) => {
    if (row.id === candidate.id || row.state === 'unbound') {
      return false
    }

    return (
      areKeymapKeystrokesEqual(candidate.keystrokes, row.keystrokes) &&
      normalizeVisibleKeymapScopes(row.scopes).some((scope) =>
        candidateScopes.includes(scope)
      )
    )
  })

  return conflictingRow ? { row: conflictingRow } : undefined
}

function createAppRow(
  item: KeymapItem,
  options: {
    state: Extract<KeybindingRowState, 'app' | 'override' | 'unbound'>
    userBinding?: KeymapBinding
    userBindingIndex?: number
    keystrokes?: readonly string[]
  }
): KeybindingRow {
  const binding = options.userBinding
  return {
    id: item.id,
    state: options.state,
    appItem: item,
    userBinding: binding,
    userBindingIndex: options.userBindingIndex,
    command: item.command,
    title: binding?.title ?? item.title,
    keystrokes: options.keystrokes ?? binding?.keystrokes ?? item.keystrokes,
    arguments: binding?.arguments ?? item.arguments,
    scopes: binding ? binding.scopes : item.scopes,
    source: item.source,
  }
}

function doesUserBindingApplyToAppItem(
  binding: KeymapBinding,
  item: KeymapItem
) {
  return isUnboundKeymapCommand(binding.command)
    ? doesKeymapUnbindBindingMatchItem(binding, item)
    : doesKeymapBindingOverrideItem(binding, item)
}

function compareKeybindingRows(a: KeybindingRow, b: KeybindingRow) {
  const commandCompare = a.command.localeCompare(b.command)
  if (commandCompare !== 0) {
    return commandCompare
  }

  return a.title.localeCompare(b.title)
}

export function serializeKeymapScopes(scopes: readonly string[] | undefined) {
  const normalizedScopes = normalizeVisibleKeymapScopes([
    ...new Set((scopes ?? []).map((scope) => scope.trim()).filter(Boolean)),
  ])

  return normalizedScopes.length === 1 &&
    normalizedScopes[0] === BASE_KEYMAP_SCOPE
    ? undefined
    : normalizedScopes
}

export function normalizeVisibleKeymapScopes(
  scopes: readonly string[] | undefined
) {
  const normalizedScopes = [
    ...new Set((scopes ?? []).map((scope) => scope.trim()).filter(Boolean)),
  ]
  const nonBaseScopes = normalizedScopes.filter(
    (scope) => scope !== BASE_KEYMAP_SCOPE
  )

  return nonBaseScopes.length > 0 ? nonBaseScopes : [BASE_KEYMAP_SCOPE]
}

export function formatKeybindingConflict(conflict: KeybindingConflict) {
  return `Already used by ${conflict.row.title}.`
}
