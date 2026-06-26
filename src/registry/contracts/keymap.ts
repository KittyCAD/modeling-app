import {
  defineContract,
  defineService,
  defineValueSpec,
  provide,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import { type Platform, isArray } from '@src/lib/utils'

export const BASE_KEYMAP_SCOPE = 'base'
export const CODE_EDITOR_FOCUSED_KEYMAP_SCOPE = 'code-editor-focused'
export const CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE = 'code-editor-not-focused'
export const MODE_MODELING_KEYMAP_SCOPE = 'mode-modeling'
export const MODE_SKETCHING_KEYMAP_SCOPE = 'mode-sketching'
export const MODE_SKETCH_NO_FACE_KEYMAP_SCOPE = 'mode-sketch-no-face'
export const MODE_SKETCH_SOLVE_KEYMAP_SCOPE = 'mode-sketch-solve'
export const HOME_KEYMAP_SCOPE = 'home'
export const PROJECT_EXPLORER_FOCUSED_KEYMAP_SCOPE = 'project-explorer.focused'
export const PROJECT_EXPLORER_RENAMING_KEYMAP_SCOPE =
  'project-explorer.renaming'
export const KEYMAP_SCHEMA_VERSION = 1
export const USER_KEYMAP_SOURCE = 'User'

export type KeymapArguments =
  | null
  | boolean
  | number
  | string
  | readonly KeymapArguments[]
  | { readonly [key: string]: KeymapArguments }

export type KeymapScope = {
  id: string
  displayName: string
  priority?: number
  group?: string
  userEditable?: boolean
}

export type KeymapBinding = {
  command: string
  keystrokes: readonly string[]
  arguments?: KeymapArguments
  scopes?: readonly string[]
  title?: string
  hidden?: boolean
  userBindingCommand?: string
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

export type KeymapDocumentBinding = KeymapBinding & {
  id: string
  title: string
  source?: string
}

export type KeymapDocument = {
  source: string
  bindings: readonly KeymapDocumentBinding[]
}

export type KeymapContribution = KeymapItem | KeymapDocument

export type KeymapTreeNode = {
  children: ReadonlyMap<string, KeymapTreeNode>
  items: readonly KeymapItem[]
  scopes: ReadonlySet<string>
}

export type KeymapTree = {
  items: readonly KeymapItem[]
  root: KeymapTreeNode
}

export type KeymapMatch =
  | { type: 'none' }
  | { type: 'prefix' }
  | { type: 'full'; item: KeymapItem }

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
  scopes: new Set(),
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
    getKeymapItemScopes(binding).some(
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
    scopes: item.scopes,
  }
}

function insertKeymapItem(root: KeymapTreeNode, item: KeymapItem) {
  let node = root
  addItemScopesToNode(node, item)

  for (const chord of item.keystrokes.map(normalizeKeymapChord)) {
    let child = node.children.get(chord)
    if (!child) {
      child = createKeymapTreeNode()
      const children = node.children as Map<string, KeymapTreeNode>
      children.set(chord, child)
    }

    node = child
    addItemScopesToNode(node, item)
  }

  node.items = [...node.items, item]
}

function addItemScopesToNode(node: KeymapTreeNode, item: KeymapItem) {
  const scopes = node.scopes as Set<string>
  for (const scope of getKeymapItemScopes(item)) {
    scopes.add(scope)
  }
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

export function getKeymapItemScopes(item: KeymapBinding) {
  const scopes = [
    ...new Set(item.scopes?.map((scope) => scope.trim()).filter(Boolean)),
  ]
  const nonBaseScopes = scopes.filter((scope) => scope !== BASE_KEYMAP_SCOPE)

  return nonBaseScopes.length > 0 ? nonBaseScopes : [BASE_KEYMAP_SCOPE]
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
      return contribution.bindings.map((binding) => ({
        ...binding,
        source: binding.source ?? contribution.source,
      }))
    }

    return [contribution]
  })
}

export function resolveKeymapItems(
  contributedItems: readonly KeymapItem[],
  persistedKeymap: PersistedKeymap
): readonly KeymapItem[] {
  let resolvedItems = [...contributedItems]

  for (const [index, binding] of persistedKeymap.bindings.entries()) {
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
      scopes: binding.scopes,
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
    scopes: binding.scopes,
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

export function areKeymapScopesEqual(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined
) {
  const aScopes = getNormalizedKeymapScopes(a)
  const bScopes = getNormalizedKeymapScopes(b)
  return (
    aScopes.length === bScopes.length &&
    aScopes.every((scope, index) => scope === bScopes[index])
  )
}

export function getNormalizedKeymapScopes(
  scopes: readonly string[] | undefined
) {
  return (scopes && scopes.length > 0 ? scopes : [BASE_KEYMAP_SCOPE])
    .map((scope) => scope.trim())
    .filter(Boolean)
    .toSorted()
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

const DEFAULT_KEYMAP_SCOPE_PRIORITY = 0

type IndexedKeymapScope = {
  scope: string
  metadata: KeymapScope | undefined
  index: number
}

export function getKeymapScopePriority(scope: KeymapScope | undefined) {
  return scope?.priority ?? DEFAULT_KEYMAP_SCOPE_PRIORITY
}

export function getEffectiveKeymapScopes(
  scopes: readonly string[],
  keymapScopes: readonly KeymapScope[] = []
) {
  const keymapScopesById = new Map(
    keymapScopes.map((scope) => [scope.id, scope])
  )
  const normalizedActiveScopes = new Map<string, IndexedKeymapScope>()

  for (const [index, rawScope] of [BASE_KEYMAP_SCOPE, ...scopes].entries()) {
    const scope = rawScope.trim()
    if (!scope) {
      continue
    }

    normalizedActiveScopes.set(scope, {
      scope,
      metadata: keymapScopesById.get(scope),
      index,
    })
  }

  const ungroupedScopes: IndexedKeymapScope[] = []
  const groupedScopes = new Map<string, IndexedKeymapScope>()

  for (const activeScope of normalizedActiveScopes.values()) {
    const group = activeScope.metadata?.group?.trim()
    if (!group) {
      ungroupedScopes.push(activeScope)
      continue
    }

    const currentScope = groupedScopes.get(group)
    if (!currentScope || compareEffectiveScope(activeScope, currentScope) > 0) {
      groupedScopes.set(group, activeScope)
    }
  }

  return [...ungroupedScopes, ...groupedScopes.values()]
    .toSorted(compareActiveScopeOrder)
    .map((activeScope) => activeScope.scope)
}

function compareEffectiveScope(a: IndexedKeymapScope, b: IndexedKeymapScope) {
  const priorityDifference =
    getKeymapScopePriority(a.metadata) - getKeymapScopePriority(b.metadata)
  if (priorityDifference !== 0) {
    return priorityDifference
  }

  return a.index - b.index
}

function compareActiveScopeOrder(a: IndexedKeymapScope, b: IndexedKeymapScope) {
  if (a.scope === BASE_KEYMAP_SCOPE && b.scope !== BASE_KEYMAP_SCOPE) {
    return -1
  }
  if (b.scope === BASE_KEYMAP_SCOPE && a.scope !== BASE_KEYMAP_SCOPE) {
    return 1
  }

  const priorityDifference =
    getKeymapScopePriority(a.metadata) - getKeymapScopePriority(b.metadata)
  if (priorityDifference !== 0) {
    return priorityDifference
  }

  const indexDifference = a.index - b.index
  return indexDifference !== 0
    ? indexDifference
    : a.scope.localeCompare(b.scope)
}

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
  keymapScopes: readonly KeymapScope[] = []
): KeymapMatch {
  const normalizedKeystrokes = keystrokes.map(normalizeKeymapChord)
  const activeScopes = getEffectiveKeymapScopes(scopes, keymapScopes)
  const activeScopeSet = new Set(activeScopes)

  let node = tree.root
  for (const chord of normalizedKeystrokes) {
    const child = node.children.get(chord)
    if (!child || !nodeHasActiveItems(child, activeScopeSet)) {
      return { type: 'none' }
    }
    node = child
  }

  const item = getActiveKeymapItem(node.items, activeScopes)
  if (item) {
    return { type: 'full', item }
  }

  if (nodeHasActiveItems(node, activeScopeSet)) {
    return { type: 'prefix' }
  }

  return { type: 'none' }
}

function nodeHasActiveItems(
  node: KeymapTreeNode,
  activeScopes: ReadonlySet<string>
): boolean {
  return (
    node.items.some((item) => isKeymapItemActive(item, activeScopes)) ||
    [...node.children.values()].some((child) =>
      nodeHasActiveItems(child, activeScopes)
    )
  )
}

function getActiveKeymapItem(
  items: readonly KeymapItem[],
  activeScopes: readonly string[]
) {
  for (const scope of [...activeScopes].toReversed()) {
    const item = items.find((candidate) =>
      isKeymapItemActiveForScope(candidate, scope)
    )
    if (item) {
      return item
    }
  }

  return items.find((item) =>
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
  return getKeymapItemScopes(item).some((scope) => activeScopes.has(scope))
}

function isKeymapItemActiveForScope(item: KeymapItem, scope: string) {
  return getKeymapItemScopes(item).includes(scope)
}

export const keymapContract = defineContract({
  keymapService: defineService<KeymapService>('keymap.service'),
  keymapValueSpec: defineValueSpec<KeymapContribution, KeymapTree>({
    name: 'keymap',
    defaultValue: createKeymapTree([]),
    combine: createKeymapTreeFromContributions,
  }),
  keymapScopesValueSpec: defineValueSpec<KeymapScope, KeymapScope[]>({
    name: 'keymap.scopes',
    defaultValue: [],
    combine: combineKeymapScopes,
  }),
})

export const { keymapService, keymapValueSpec, keymapScopesValueSpec } =
  keymapContract

export function provideKeymapItem(item: KeymapItem) {
  return provide(keymapValueSpec, item, { key: item.id })
}

export function provideKeymapDocument(document: KeymapDocument) {
  return provide(keymapValueSpec, document, { key: document.source })
}

export function provideKeymapScope(scope: KeymapScope) {
  return provide(keymapScopesValueSpec, scope, { key: scope.id })
}

function combineKeymapScopes(scopes: readonly KeymapScope[]) {
  return [
    ...new Map(scopes.map((scope) => [scope.id, scope])).values(),
  ].toSorted(compareKeymapScopeDisplayOrder)
}

function compareKeymapScopeDisplayOrder(a: KeymapScope, b: KeymapScope) {
  const priorityDifference =
    getKeymapScopePriority(b) - getKeymapScopePriority(a)
  if (priorityDifference !== 0) {
    return priorityDifference
  }

  const nameDifference = a.displayName.localeCompare(b.displayName)
  return nameDifference !== 0 ? nameDifference : a.id.localeCompare(b.id)
}

function isKeymapDocument(
  contribution: KeymapContribution
): contribution is KeymapDocument {
  return 'bindings' in contribution
}
