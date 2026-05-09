import {
  defineContract,
  defineService,
  defineValueSpec,
  provide,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'

export const BASE_KEYMAP_SCOPE = 'base'

export type KeymapItem = {
  id: string
  title: string
  description: string
  run: (event: KeyboardEvent) => unknown
  registerToCodeMirror?: boolean
  scope?: string
  sequence: readonly string[]
}

export type KeymapTreeNode = {
  children: ReadonlyMap<string, KeymapTreeNode>
  items: readonly KeymapItem[]
}

export type KeymapTree = {
  scopes: ReadonlyMap<string, KeymapTreeNode>
  codeMirrorScopes: ReadonlyMap<string, KeymapTreeNode>
}

export type KeymapMatch =
  | { type: 'none' }
  | { type: 'prefix' }
  | { type: 'full'; item: KeymapItem }

export type KeymapSource = 'global' | 'codeMirror'

export type KeymapService = {
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
})

export function normalizeKeymapChord(chord: string) {
  return chord
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .join('+')
}

function insertKeymapItem(root: KeymapTreeNode, item: KeymapItem) {
  let node = root

  for (const chord of item.sequence.map(normalizeKeymapChord)) {
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
  const scopes = new Map<string, KeymapTreeNode>()
  const codeMirrorScopes = new Map<string, KeymapTreeNode>()

  for (const item of items) {
    const scope = item.scope ?? BASE_KEYMAP_SCOPE
    let root = scopes.get(scope)
    if (!root) {
      root = createKeymapTreeNode()
      scopes.set(scope, root)
    }

    insertKeymapItem(root, item)

    if (!item.registerToCodeMirror) {
      continue
    }

    let codeMirrorRoot = codeMirrorScopes.get(scope)
    if (!codeMirrorRoot) {
      codeMirrorRoot = createKeymapTreeNode()
      codeMirrorScopes.set(scope, codeMirrorRoot)
    }

    insertKeymapItem(codeMirrorRoot, item)
  }

  return { scopes, codeMirrorScopes }
}

export function matchKeymapSequence(
  tree: KeymapTree,
  scopes: readonly string[],
  sequence: readonly string[],
  source: KeymapSource = 'global'
): KeymapMatch {
  const normalizedSequence = sequence.map(normalizeKeymapChord)
  const treeScopes =
    source === 'codeMirror' ? tree.codeMirrorScopes : tree.scopes

  for (const scope of [...scopes].toReversed()) {
    const match = matchScope(treeScopes.get(scope), normalizedSequence)
    if (match.type !== 'none') {
      return match
    }
  }

  return matchScope(treeScopes.get(BASE_KEYMAP_SCOPE), normalizedSequence)
}

function matchScope(
  root: KeymapTreeNode | undefined,
  sequence: readonly string[]
): KeymapMatch {
  if (!root) {
    return { type: 'none' }
  }

  let node = root
  for (const chord of sequence) {
    const child = node.children.get(chord)
    if (!child) {
      return { type: 'none' }
    }
    node = child
  }

  const item = node.items[0]
  if (item) {
    return { type: 'full', item }
  }

  if (node.children.size > 0) {
    return { type: 'prefix' }
  }

  return { type: 'none' }
}

export const keymapContract = defineContract({
  keymapService: defineService<KeymapService>('keymap.service'),
  keymapValueSpec: defineValueSpec<KeymapItem, KeymapTree>({
    name: 'keymap',
    defaultValue: createKeymapTree([]),
    combine: createKeymapTree,
  }),
})

export const { keymapService, keymapValueSpec } = keymapContract

export function provideKeymapItem(item: KeymapItem) {
  return provide(keymapValueSpec, item, { key: item.id })
}
