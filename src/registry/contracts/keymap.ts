import {
  defineContract,
  defineService,
  defineValueSpec,
  provide,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import { type Platform, isArray } from '@src/lib/utils'
import {
  BASE_COMMAND_SCOPE,
  CODE_EDITOR_FOCUSED_COMMAND_SCOPE,
  CODE_EDITOR_NOT_FOCUSED_COMMAND_SCOPE,
  COMMAND_PALETTE_OPEN_COMMAND_SCOPE,
  DEFAULT_COMMAND_SCOPES,
  EDITABLE_FOCUSED_COMMAND_SCOPE,
  FILE_AND_CODE_EDITOR_COMMAND_SCOPES,
  FILE_COMMAND_SCOPES,
  GLOBAL_COMMAND_SCOPES,
  HOME_COMMAND_SCOPE,
  MODE_MODELING_COMMAND_SCOPE,
  MODE_SKETCHING_COMMAND_SCOPE,
  MODE_SKETCH_NO_FACE_COMMAND_SCOPE,
  MODE_SKETCH_SOLVE_COMMAND_SCOPE,
  PROJECT_EXPLORER_FOCUSED_COMMAND_SCOPE,
  PROJECT_EXPLORER_RENAMING_COMMAND_SCOPE,
  SETTINGS_COMMAND_SCOPE,
  SKETCH_COMMAND_SCOPES,
  commandScopesValueSpec,
  getCommandScopePriority,
  getEffectiveCommandScopes,
  provideCommandScope,
  type CommandScope,
} from '@src/registry/contracts/commands'

export const BASE_KEYMAP_SCOPE = BASE_COMMAND_SCOPE
export const CODE_EDITOR_FOCUSED_KEYMAP_SCOPE =
  CODE_EDITOR_FOCUSED_COMMAND_SCOPE
export const CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE =
  CODE_EDITOR_NOT_FOCUSED_COMMAND_SCOPE
export const EDITABLE_FOCUSED_KEYMAP_SCOPE = EDITABLE_FOCUSED_COMMAND_SCOPE
export const MODE_MODELING_KEYMAP_SCOPE = MODE_MODELING_COMMAND_SCOPE
export const MODE_SKETCHING_KEYMAP_SCOPE = MODE_SKETCHING_COMMAND_SCOPE
export const MODE_SKETCH_NO_FACE_KEYMAP_SCOPE =
  MODE_SKETCH_NO_FACE_COMMAND_SCOPE
export const MODE_SKETCH_SOLVE_KEYMAP_SCOPE = MODE_SKETCH_SOLVE_COMMAND_SCOPE
export const HOME_KEYMAP_SCOPE = HOME_COMMAND_SCOPE
export const COMMAND_PALETTE_OPEN_KEYMAP_SCOPE =
  COMMAND_PALETTE_OPEN_COMMAND_SCOPE
export const SETTINGS_KEYMAP_SCOPE = SETTINGS_COMMAND_SCOPE
export const PROJECT_EXPLORER_FOCUSED_KEYMAP_SCOPE =
  PROJECT_EXPLORER_FOCUSED_COMMAND_SCOPE
export const PROJECT_EXPLORER_RENAMING_KEYMAP_SCOPE =
  PROJECT_EXPLORER_RENAMING_COMMAND_SCOPE
export const DEFAULT_KEYMAP_SCOPES = DEFAULT_COMMAND_SCOPES
export const GLOBAL_KEYMAP_SCOPES = GLOBAL_COMMAND_SCOPES
export const SKETCH_KEYMAP_SCOPES = SKETCH_COMMAND_SCOPES
export const FILE_KEYMAP_SCOPES = FILE_COMMAND_SCOPES
export const FILE_AND_CODE_EDITOR_KEYMAP_SCOPES =
  FILE_AND_CODE_EDITOR_COMMAND_SCOPES
export const KEYMAP_SCHEMA_VERSION = 2
export const USER_KEYMAP_SOURCE = 'User'

export type KeymapArguments =
  | null
  | boolean
  | number
  | string
  | readonly KeymapArguments[]
  | { readonly [key: string]: KeymapArguments }

export type KeymapScope = CommandScope

export type KeymapBinding = {
  command: string
  keystrokes: readonly string[]
  arguments?: KeymapArguments
  /** Additional app contexts in which this keybinding is active. */
  when?: readonly string[]
  title?: string
  hidden?: boolean
  userBindingCommand?: string
}

/** Input accepted from plugins built before keybinding `when` conditions. */
export type KeymapBindingInput = Omit<KeymapBinding, 'when'> & {
  when?: readonly string[]
  /** @deprecated Use `when`. */
  scopes?: readonly string[]
}

export type PersistedKeymap = {
  version: typeof KEYMAP_SCHEMA_VERSION
  bindings: readonly KeymapBinding[]
}

export type KeymapItem = KeymapBinding & {
  id: string
  title: string
  source: string
}

export type KeymapItemInput = KeymapBindingInput & {
  id: string
  title: string
  source: string
}

export type KeymapDocumentBinding = KeymapBinding & {
  id: string
  title: string
  source?: string
}

export type KeymapDocumentBindingInput = KeymapBindingInput & {
  id: string
  title: string
  source?: string
}

export type KeymapDocument = {
  source: string
  bindings: readonly KeymapDocumentBinding[]
}

export type KeymapDocumentInput = {
  source: string
  bindings: readonly KeymapDocumentBindingInput[]
}

export type KeymapContribution = KeymapItemInput | KeymapDocumentInput

export type KeymapTreeNode = {
  children: ReadonlyMap<string, KeymapTreeNode>
  items: readonly KeymapItem[]
}

export type KeymapTree = {
  items: readonly KeymapItem[]
  root: KeymapTreeNode
}

export type KeymapMatch =
  | { type: 'none' }
  | { type: 'prefix' }
  | { type: 'full'; item: KeymapItem }

export type KeymapItemAvailability = (item: KeymapItem) => boolean

export type KeymapSource = 'global' | 'codeMirror'

export type KeymapService = {
  keymap: ReadonlySignal<KeymapTree>
  persistedKeymap: ReadonlySignal<PersistedKeymap>
  partialMatch: ReadonlySignal<boolean>
  applyScope: (scopeName: string) => void
  removeScope: (scopeName: string) => void
  getCurrentScopes: () => readonly string[]
  savePersistedKeymap: (keymap: PersistedKeymap) => Promise<void>
  addUserBinding: (binding: KeymapBinding) => Promise<void>
  removeUserBinding: (index: number) => Promise<void>
  unbind: (item: KeymapItem) => Promise<void>
  suspendListening: () => () => void
  handleKeyDown: (
    event: KeyboardEvent,
    options: { source: KeymapSource }
  ) => boolean
  focusScope: (scopeName: string) => {
    onFocus: () => void
    onBlur: () => void
  }
}

const createKeymapTreeNode = (): KeymapTreeNode => ({
  children: new Map(),
  items: [],
})

const LOWER_CASE_LETTER = /[a-z]/
const WHITESPACE = /\s+/g
const KEYMAP_KEYSTROKE_SEPARATOR = ' '

export function keymapKeystrokesDisplay(
  keystrokes: readonly string[] | undefined,
  platform: Platform
): string | undefined {
  const display = (keystrokes ?? [])
    .map((chord) => keymapChordDisplay(chord, platform))
    .filter((chordDisplay): chordDisplay is string => !!chordDisplay)
    .join(KEYMAP_KEYSTROKE_SEPARATOR)

  return display || undefined
}

export function keymapChordDisplay(
  chord: string | undefined,
  platform: Platform
): string | undefined {
  if (!chord) {
    return undefined
  }

  const isMac = platform === 'macos'
  const isWindows = platform === 'windows'
  const meta = isWindows ? 'Win' : 'Super'
  const outputSeparator = isMac ? '' : '+'

  return chord
    .split('+')
    .map((word) => word.trim().toLocaleLowerCase())
    .map((word) => {
      if (word === 'escape' || word === 'esc') {
        return 'Esc'
      }
      if (word.length === 1 && LOWER_CASE_LETTER.test(word)) {
        return word.toUpperCase()
      }
      return word
    })
    .join(outputSeparator)
    .replaceAll(WHITESPACE, ' ')
    .replaceAll('mod', isMac ? '⌘' : 'Ctrl')
    .replaceAll('meta', isMac ? '⌘' : meta)
    .replaceAll('ctrl', isMac ? '^' : 'Ctrl')
    .replaceAll('shift', isMac ? '⬆' : 'Shift')
    .replaceAll('alt', isMac ? '⌥' : 'Alt')
}

export function normalizeKeymapChord(chord: string) {
  return chord
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .join('+')
}

type KeyboardEventKeyInput = Pick<
  KeyboardEvent,
  'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey'
>

export function normalizeEventKey(event: KeyboardEventKeyInput) {
  const key = getUnmodifiedKeyFromCode(event)
  if (key) {
    return key
  }

  return normalizeEventKeyValue(event.key)
}

function normalizeEventKeyValue(key: string) {
  const normalized = key.toLowerCase()
  if (normalized === ' ') {
    return 'space'
  }

  if (normalized.length === 1) {
    return normalized
  }

  return normalized
}

/**
 * Returns the physical key for modified shortcuts when `event.key` contains the
 * typed character instead. For example, macOS Alt+D reports a symbol as
 * `event.key`, but `event.code` still identifies the D key as `KeyD`.
 */
function getUnmodifiedKeyFromCode(event: KeyboardEventKeyInput) {
  if (!event.altKey) {
    return null
  }

  if (event.code.startsWith('Key') && event.code.length === 4) {
    return event.code.slice(3).toLowerCase()
  }

  if (event.code.startsWith('Digit') && event.code.length === 6) {
    return event.code.slice(5)
  }

  return unmodifiedKeyByCode[event.code] ?? null
}

const unmodifiedKeyByCode: Record<string, string> = {
  Backquote: '`',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Equal: '=',
  Minus: '-',
  NumpadAdd: '+',
  NumpadDecimal: '.',
  NumpadDivide: '/',
  NumpadMultiply: '*',
  NumpadSubtract: '-',
  Period: '.',
  Quote: "'",
  Semicolon: ';',
  Slash: '/',
  Space: 'space',
}

const nonTextKeymapModifiers = new Set([
  'cmd',
  'command',
  'control',
  'ctrl',
  'meta',
  'mod',
])

const textKeymapKeyNames = new Set(['space', 'spacebar'])

const nonTextKeymapKeyNames = new Set([
  'arrowdown',
  'arrowleft',
  'arrowright',
  'arrowup',
  'backspace',
  'capslock',
  'delete',
  'end',
  'enter',
  'escape',
  'esc',
  'home',
  'insert',
  'pagedown',
  'pageup',
  'tab',
])

export function keymapChordProducesText(chord: string) {
  const chordParts = normalizeKeymapChord(chord).split('+').filter(Boolean)

  if (chordParts.some((part) => nonTextKeymapModifiers.has(part))) {
    return false
  }

  const key = chordParts.at(-1)
  if (!key || nonTextKeymapKeyNames.has(key)) {
    return false
  }

  return key.length === 1 || textKeymapKeyNames.has(key)
}

export function keymapBindingCanCollideWithTyping(binding: KeymapBinding) {
  const firstChord = binding.keystrokes[0]
  if (!firstChord) {
    return false
  }

  return (
    getKeymapItemWhen(binding).some(
      (scope) =>
        scope === BASE_KEYMAP_SCOPE ||
        scope === CODE_EDITOR_FOCUSED_KEYMAP_SCOPE
    ) && keymapChordProducesText(firstChord)
  )
}

export function createEmptyPersistedKeymap(): PersistedKeymap {
  return {
    version: KEYMAP_SCHEMA_VERSION,
    bindings: [],
  }
}

export function isUnboundKeymapCommand(command: string) {
  return command.startsWith('-')
}

export function getBoundKeymapCommand(command: string) {
  return isUnboundKeymapCommand(command) ? command.slice(1) : command
}

export function createUnbindBinding(item: KeymapItem): KeymapBinding {
  return {
    command: `-${item.command}`,
    keystrokes: item.keystrokes,
    arguments: item.arguments,
    when: item.when,
  }
}

function insertKeymapItem(root: KeymapTreeNode, item: KeymapItem) {
  let node = root

  for (const chord of item.keystrokes.map(normalizeKeymapChord)) {
    let child = node.children.get(chord)
    if (!child) {
      child = createKeymapTreeNode()
      const children = node.children as Map<string, KeymapTreeNode>
      children.set(chord, child)
    }

    node = child
  }

  node.items = [...node.items, item]
}

export function createKeymapTree(items: readonly KeymapItem[]): KeymapTree {
  const root = createKeymapTreeNode()

  for (const item of items) {
    if (isUnboundKeymapCommand(item.command)) {
      continue
    }

    insertKeymapItem(root, item)
  }

  return { items, root }
}

export function getKeymapItemWhen(item: Pick<KeymapBinding, 'when'>) {
  const contexts = [
    ...new Set(item.when?.map((context) => context.trim()).filter(Boolean)),
  ]
  const nonBaseContexts = contexts.filter(
    (context) => context !== BASE_KEYMAP_SCOPE
  )

  return nonBaseContexts.length > 0 ? nonBaseContexts : [BASE_KEYMAP_SCOPE]
}

export function createKeymapTreeFromContributions(
  contributions: readonly KeymapContribution[]
): KeymapTree {
  return createKeymapTree(createKeymapItemsFromContributions(contributions))
}

export function createKeymapItemsFromContributions(
  contributions: readonly KeymapContribution[]
): readonly KeymapItem[] {
  return contributions.flatMap((contribution) => {
    if (isKeymapDocument(contribution)) {
      return contribution.bindings.map((binding) =>
        normalizeKeymapItemInput({
          ...binding,
          source: binding.source ?? contribution.source,
        })
      )
    }

    return [normalizeKeymapItemInput(contribution)]
  })
}

export function resolveKeymapItems(
  contributedItems: readonly KeymapItem[],
  persistedKeymap: PersistedKeymap
): readonly KeymapItem[] {
  let resolvedItems = [...contributedItems]

  for (const [index, rawBinding] of persistedKeymap.bindings.entries()) {
    const binding = normalizeKeymapBindingInput(rawBinding)
    if (isUnboundKeymapCommand(binding.command)) {
      resolvedItems = resolvedItems.filter(
        (item) => !doesKeymapUnbindBindingMatchItem(binding, item)
      )
      continue
    }

    let appliedOverride = false
    resolvedItems = resolvedItems.map((item) => {
      if (!doesKeymapBindingOverrideItem(binding, item)) {
        return item
      }

      appliedOverride = true
      return createUserOverriddenKeymapItem(item, binding)
    })

    if (appliedOverride) {
      continue
    }

    resolvedItems.push({
      ...binding,
      id: `user.${index}.${binding.command}`,
      title: binding.title ?? binding.command,
      source: USER_KEYMAP_SOURCE,
      when: binding.when,
    })
  }

  return resolvedItems
}

function createUserOverriddenKeymapItem(
  item: KeymapItem,
  binding: KeymapBinding
): KeymapItem {
  if (isKeymapLinkedUserBinding(item, binding)) {
    return {
      ...item,
      keystrokes: binding.keystrokes,
      source: USER_KEYMAP_SOURCE,
    }
  }

  return {
    ...item,
    ...binding,
    id: item.id,
    title: binding.title ?? item.title,
    source: USER_KEYMAP_SOURCE,
    when: binding.when,
  }
}

export function doesKeymapBindingOverrideItem(
  binding: KeymapBinding,
  item: KeymapItem
) {
  return (
    binding.command === getKeymapItemUserBindingCommand(item) &&
    areKeymapArgumentsEqual(binding.arguments, item.arguments)
  )
}

export function doesKeymapUnbindBindingMatchItem(
  binding: KeymapBinding,
  item: KeymapItem
) {
  const commandsMatch =
    getBoundKeymapCommand(binding.command) ===
    getKeymapItemUserBindingCommand(item)
  if (
    commandsMatch &&
    item.userBindingCommand !== undefined &&
    areKeymapArgumentsEqual(binding.arguments, item.arguments)
  ) {
    return true
  }

  return (
    commandsMatch &&
    areKeymapArgumentsEqual(binding.arguments, item.arguments) &&
    areKeymapKeystrokesEqual(binding.keystrokes, item.keystrokes)
  )
}

function getKeymapItemUserBindingCommand(item: KeymapItem) {
  return item.userBindingCommand ?? item.command
}

function isKeymapLinkedUserBinding(item: KeymapItem, binding: KeymapBinding) {
  return (
    item.hidden === true &&
    item.userBindingCommand !== undefined &&
    item.userBindingCommand === binding.command
  )
}

export function areKeymapArgumentsEqual(
  a: KeymapArguments | undefined,
  b: KeymapArguments | undefined
): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  if (isArray(a) || isArray(b)) {
    const aArray = a as readonly KeymapArguments[]
    const bArray = b as readonly KeymapArguments[]
    return (
      isArray(a) &&
      isArray(b) &&
      aArray.length === bArray.length &&
      aArray.every((value, index) =>
        areKeymapArgumentsEqual(value, bArray[index])
      )
    )
  }
  if (typeof a === 'object' && typeof b === 'object' && a && b) {
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    return (
      aKeys.length === bKeys.length &&
      aKeys.every((key) => areKeymapArgumentsEqual(a[key], b[key]))
    )
  }
  return false
}

export const getKeymapScopePriority = getCommandScopePriority
export const getEffectiveKeymapScopes = getEffectiveCommandScopes

export function areKeymapKeystrokesEqual(
  a: readonly string[],
  b: readonly string[]
) {
  return (
    a.length === b.length &&
    a.every((chord, index) => {
      const otherChord = b[index]
      return (
        otherChord !== undefined &&
        normalizeKeymapChord(chord) === normalizeKeymapChord(otherChord)
      )
    })
  )
}

export function matchKeymapKeystrokes(
  tree: KeymapTree,
  scopes: readonly string[],
  keystrokes: readonly string[],
  keymapScopes: readonly KeymapScope[] = [],
  isItemAvailable: KeymapItemAvailability = () => true
): KeymapMatch {
  const normalizedKeystrokes = keystrokes.map(normalizeKeymapChord)
  const activeScopes = getEffectiveKeymapScopes(scopes, keymapScopes)
  const activeScopeSet = new Set(activeScopes)

  let node = tree.root
  for (const chord of normalizedKeystrokes) {
    const child = node.children.get(chord)
    if (!child || !nodeHasActiveItems(child, activeScopeSet, isItemAvailable)) {
      return { type: 'none' }
    }
    node = child
  }

  const item = getActiveKeymapItem(node.items, activeScopes, isItemAvailable)
  if (item) {
    return { type: 'full', item }
  }

  if (nodeHasActiveItems(node, activeScopeSet, isItemAvailable)) {
    return { type: 'prefix' }
  }

  return { type: 'none' }
}

function nodeHasActiveItems(
  node: KeymapTreeNode,
  activeScopes: ReadonlySet<string>,
  isItemAvailable: KeymapItemAvailability
): boolean {
  return (
    node.items.some(
      (item) => isItemAvailable(item) && isKeymapItemActive(item, activeScopes)
    ) ||
    [...node.children.values()].some((child) =>
      nodeHasActiveItems(child, activeScopes, isItemAvailable)
    )
  )
}

function getActiveKeymapItem(
  items: readonly KeymapItem[],
  activeScopes: readonly string[],
  isItemAvailable: KeymapItemAvailability
) {
  for (const scope of [...activeScopes].toReversed()) {
    const item = items.find(
      (candidate) =>
        isItemAvailable(candidate) &&
        isKeymapItemActiveForScope(candidate, scope)
    )
    if (item) {
      return item
    }
  }

  return items.find(
    (item) =>
      isItemAvailable(item) &&
      isKeymapItemActiveForScope(item, BASE_KEYMAP_SCOPE)
  )
}

export function findKeymapItemForCommand(
  tree: KeymapTree,
  command: string,
  scopes: readonly string[],
  keymapScopes: readonly KeymapScope[] = []
) {
  const activeScopeSet = new Set(getEffectiveKeymapScopes(scopes, keymapScopes))
  return tree.items.find(
    (item) =>
      item.command === command && isKeymapItemActive(item, activeScopeSet)
  )
}

function isKeymapItemActive(
  item: KeymapItem,
  activeScopes: ReadonlySet<string>
) {
  return getKeymapItemWhen(item).some((scope) => activeScopes.has(scope))
}

function isKeymapItemActiveForScope(item: KeymapItem, scope: string) {
  return getKeymapItemWhen(item).includes(scope)
}

export const keymapContract = defineContract({
  keymapService: defineService<KeymapService>('keymap.service'),
  keymapValueSpec: defineValueSpec<KeymapContribution, KeymapTree>({
    name: 'keymap',
    defaultValue: createKeymapTree([]),
    combine: createKeymapTreeFromContributions,
  }),
  keymapScopesValueSpec: commandScopesValueSpec,
})

export const { keymapService, keymapValueSpec, keymapScopesValueSpec } =
  keymapContract

export function provideKeymapItem(item: KeymapItemInput) {
  return provide(keymapValueSpec, item, { key: item.id })
}

export function provideKeymapDocument(document: KeymapDocumentInput) {
  return provide(keymapValueSpec, document, { key: document.source })
}

export function provideKeymapScope(scope: KeymapScope) {
  return provideCommandScope(scope)
}

function isKeymapDocument(
  contribution: KeymapContribution
): contribution is KeymapDocumentInput {
  return 'bindings' in contribution
}

function normalizeKeymapItemInput(input: KeymapItemInput): KeymapItem {
  const binding = normalizeKeymapBindingInput(input)
  return {
    ...binding,
    id: input.id,
    title: input.title,
    source: input.source,
  }
}

export function normalizeKeymapBindingInput(
  input: KeymapBindingInput
): KeymapBinding {
  const { scopes, when, ...binding } = input
  const condition = isArray(when) ? when : isArray(scopes) ? scopes : []
  const normalizedWhen = [
    ...new Set(
      condition.flatMap((context) =>
        typeof context === 'string' && context.trim() ? [context.trim()] : []
      )
    ),
  ]

  return {
    ...binding,
    ...(normalizedWhen.length > 0 ? { when: normalizedWhen } : {}),
  }
}

export function normalizePersistedKeymap(
  keymap: PersistedKeymap
): PersistedKeymap {
  return {
    version: KEYMAP_SCHEMA_VERSION,
    bindings: keymap.bindings.map(normalizeKeymapBindingInput),
  }
}
