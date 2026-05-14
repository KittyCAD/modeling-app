import {
  defineContract,
  defineService,
  defineValueSpec,
  provide,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'

export const BASE_KEYMAP_SCOPE = 'base'
export const CODE_EDITOR_FOCUSED_KEYMAP_SCOPE = 'code-editor-focused'
export const CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE = 'code-editor-not-focused'

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
}

export type KeymapBinding = {
  command: string
  keystrokes: readonly string[]
  arguments?: KeymapArguments
  scopes?: readonly string[]
  title?: string
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
  partialMatch: ReadonlySignal<boolean>
  applyScope: (scopeName: string) => void
  removeScope: (scopeName: string) => void
  getCurrentScopes: () => readonly string[]
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

export function normalizeKeymapChord(chord: string) {
  return chord
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .join('+')
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
  keystrokes: readonly string[]
): KeymapMatch {
  const normalizedKeystrokes = keystrokes.map(normalizeKeymapChord)
  const activeScopes = getActiveKeymapScopes(scopes)

  let node = tree.root
  for (const chord of normalizedKeystrokes) {
    const child = node.children.get(chord)
    if (!child || !nodeHasActiveScopes(child, activeScopes)) {
      return { type: 'none' }
    }
    node = child
  }

  const item = getActiveKeymapItem(node.items, scopes)
  if (item) {
    return { type: 'full', item }
  }

  if (nodeHasActiveScopes(node, activeScopes)) {
    return { type: 'prefix' }
  }

  return { type: 'none' }
}

function getActiveKeymapScopes(scopes: readonly string[]) {
  return new Set([BASE_KEYMAP_SCOPE, ...scopes])
}

function nodeHasActiveScopes(
  node: KeymapTreeNode,
  activeScopes: ReadonlySet<string>
) {
  return [...node.scopes].some((scope) => activeScopes.has(scope))
}

function getActiveKeymapItem(
  items: readonly KeymapItem[],
  activeScopes: readonly string[]
) {
  for (const scope of [...activeScopes].toReversed()) {
    const item = items.find((candidate) =>
      getKeymapItemScopes(candidate).includes(scope)
    )
    if (item) {
      return item
    }
  }

  return items.find((item) =>
    getKeymapItemScopes(item).includes(BASE_KEYMAP_SCOPE)
  )
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
  ].toSorted((a, b) => a.displayName.localeCompare(b.displayName))
}

function isKeymapDocument(
  contribution: KeymapContribution
): contribution is KeymapDocument {
  return 'bindings' in contribution
}
