import {
  BASE_SCOPE,
  type Keybinding,
  type KeybindingScope,
  type KeymapMatch,
} from '@src/contracts/keybindings'

/**
 * Chord parsing, matching, and display.
 *
 * All of it pure, and none of it aware of the app: a chord is a string, a match
 * is a verdict about a tree, and the listener that turns one into a command is
 * elsewhere. This is where the sharp edges of keyboard handling live, and every
 * one of them is a bug somebody hit rather than a case somebody imagined.
 */

/** Modifier tokens, in the order a normalised chord writes them. */
const MODIFIER_ORDER = ['mod', 'meta', 'ctrl', 'alt', 'shift'] as const
type Modifier = (typeof MODIFIER_ORDER)[number]

const MODIFIERS = new Set<string>(MODIFIER_ORDER)

const MODIFIER_ALIASES: Record<string, Modifier> = {
  cmd: 'meta',
  command: 'meta',
  control: 'ctrl',
  option: 'alt',
  super: 'meta',
  win: 'meta',
}

const KEY_ALIASES: Record<string, string> = {
  spacebar: 'space',
  esc: 'escape',
  del: 'delete',
  return: 'enter',
}

const MODIFIER_KEY_NAMES = new Set(['Alt', 'Control', 'Meta', 'Shift'])

/**
 * Normalise a chord so two spellings of the same thing compare equal.
 *
 * Modifiers are sorted, which is the point: `Shift+Mod+1` and `Mod+Shift+1` are
 * the same chord, and a binding that silently never fires because its author
 * wrote the modifiers in the order a human says them is not a good trade for a
 * simpler function.
 */
export function normaliseChord(chord: string): string {
  const parts = chord
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .map((part) => MODIFIER_ALIASES[part] ?? part)

  const modifiers = MODIFIER_ORDER.filter((modifier) =>
    parts.includes(modifier)
  )
  const keys = parts.filter((part) => !MODIFIERS.has(part))
  const key = keys.at(-1)

  return [...modifiers, ...(key ? [KEY_ALIASES[key] ?? key] : [])].join('+')
}

export function normaliseKeystrokes(
  keystrokes: readonly string[]
): readonly string[] {
  return keystrokes.map(normaliseChord).filter(Boolean)
}

export const isApplePlatform = () =>
  typeof navigator !== 'undefined' &&
  /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)

type KeyEventFields = Pick<
  KeyboardEvent,
  'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'
>

/**
 * The physical key behind `event.key`, where `event.key` cannot be trusted.
 *
 * Two cases, both real:
 *
 * - Shift and a digit produce the *symbol*: `Shift+1` arrives as `!`, so a
 *   binding written `Mod+Shift+1` would never fire.
 * - macOS Alt produces the *composed character*: `Alt+D` arrives as `∂`.
 *
 * `event.code` still names the key in both, so it is consulted for digits
 * always and for everything else only under Alt. Letters otherwise come from
 * `event.key`, so a binding follows the letter someone sees printed on the cap
 * rather than a position on a US keyboard.
 */
function physicalKey(event: KeyEventFields): string | null {
  if (/^Digit\d$/.test(event.code)) return event.code.slice(-1)
  if (!event.altKey) return null
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toLowerCase()
  return PUNCTUATION_BY_CODE[event.code] ?? null
}

const PUNCTUATION_BY_CODE: Record<string, string> = {
  Backquote: '`',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Equal: '=',
  Minus: '-',
  Period: '.',
  Quote: "'",
  Semicolon: ';',
  Slash: '/',
  Space: 'space',
}

/**
 * The chord a keystroke represents, or `null` if it is only a modifier.
 *
 * `Mod` is resolved here rather than at match time, so the keymap compares one
 * spelling on every platform.
 */
export function chordFromEvent(
  event: KeyEventFields,
  isApple = isApplePlatform()
): string | null {
  if (MODIFIER_KEY_NAMES.has(event.key)) return null

  const key = physicalKey(event) ?? reportedKey(event.key)
  if (!key) return null

  const parts: string[] = []
  if (isApple ? event.metaKey : event.ctrlKey) {
    parts.push('mod')
  } else {
    if (event.ctrlKey) parts.push('ctrl')
    if (event.metaKey) parts.push('meta')
  }
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  parts.push(key)

  return normaliseChord(parts.join('+'))
}

/**
 * `event.key`, named the way a chord names it.
 *
 * The space bar reports a single space, which cannot survive being written into
 * a `+`-separated chord — every reader would trim it back to nothing.
 */
function reportedKey(key: string): string {
  const lower = key.toLowerCase()
  return lower === ' ' ? 'space' : lower
}

/** Glyph and order for each modifier, per platform. */
const MODIFIER_DISPLAY: Record<
  'apple' | 'other',
  Record<Modifier, { glyph: string; order: number }>
> = {
  // Apple's own order is ⌃⌥⇧⌘, and a shortcut written any other way reads as
  // foreign on macOS.
  apple: {
    ctrl: { glyph: '⌃', order: 0 },
    alt: { glyph: '⌥', order: 1 },
    shift: { glyph: '⇧', order: 2 },
    meta: { glyph: '⌘', order: 3 },
    mod: { glyph: '⌘', order: 3 },
  },
  other: {
    mod: { glyph: 'Ctrl', order: 0 },
    ctrl: { glyph: 'Ctrl', order: 0 },
    alt: { glyph: 'Alt', order: 1 },
    shift: { glyph: 'Shift', order: 2 },
    meta: { glyph: 'Meta', order: 3 },
  },
}

const KEY_DISPLAY: Record<string, string> = {
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  escape: 'Esc',
  space: 'Space',
}

export function displayChord(
  chord: string,
  isApple = isApplePlatform()
): string {
  const table = MODIFIER_DISPLAY[isApple ? 'apple' : 'other']
  const parts = normaliseChord(chord).split('+').filter(Boolean)

  const modifiers = parts
    .filter((part): part is Modifier => MODIFIERS.has(part))
    .map((part) => table[part])
    .toSorted((a, b) => a.order - b.order)
    .map((entry) => entry.glyph)

  const key = parts.find((part) => !MODIFIERS.has(part))
  const shown =
    key === undefined
      ? []
      : [
          KEY_DISPLAY[key] ??
            (key.length === 1
              ? key.toUpperCase()
              : key.charAt(0).toUpperCase() + key.slice(1)),
        ]

  return [...modifiers, ...shown].join(isApple ? '' : '+')
}

/** `['v', '1']` reads as `V 1`: a space is the sequence, a plus is the chord. */
export function displayKeystrokes(
  keystrokes: readonly string[],
  isApple = isApplePlatform()
): string {
  return keystrokes
    .map((chord) => displayChord(chord, isApple))
    .filter(Boolean)
    .join(' ')
}

// --- Scopes ---------------------------------------------------------------

/**
 * Active scopes, weakest first.
 *
 * `base` is always present and always weakest. Ties break on the order they
 * were applied, so the most recent wins — the same rule a stack of contexts
 * would give, without needing one.
 */
export function effectiveScopes(
  active: readonly string[],
  definitions: readonly KeybindingScope[] = []
): readonly string[] {
  const priorities = new Map(
    definitions.map((scope) => [scope.id, scope.priority ?? 0])
  )
  const seen = [...new Set([BASE_SCOPE, ...active.map((id) => id.trim())])]
    .filter(Boolean)
    .map((id, index) => ({
      id,
      priority:
        id === BASE_SCOPE
          ? Number.NEGATIVE_INFINITY
          : (priorities.get(id) ?? 0),
      index,
    }))

  return seen
    .toSorted((a, b) => a.priority - b.priority || a.index - b.index)
    .map((scope) => scope.id)
}

const scopesOf = (binding: Keybinding): readonly string[] => {
  const scopes = (binding.scopes ?? [])
    .map((scope) => scope.trim())
    .filter(Boolean)
  return scopes.length > 0 ? scopes : [BASE_SCOPE]
}

/** Whether a scope declares that bare keys belong to whatever has focus. */
export function hasTextEntryScope(
  active: readonly string[],
  definitions: readonly KeybindingScope[]
): boolean {
  return definitions.some(
    (scope) => scope.textEntry === true && active.includes(scope.id)
  )
}

/**
 * Whether a keystroke belongs to whatever has focus rather than to the keymap.
 *
 * A chord carrying Mod, Ctrl or Alt is never typing, and neither is the second
 * keystroke of a chord already in progress — both dispatch even mid-word. A
 * bare key, though, is a character as far as an input is concerned, and taking
 * it would make the field drop letters.
 *
 * This replaces a blanket "ignore everything while focus is in a text field",
 * which quietly killed every unflagged binding — `⌘1` included — the moment the
 * code editor had focus.
 */
export function yieldsToTextEntry(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey'> & {
    target: EventTarget | null
  },
  options: { hasPending: boolean; textEntryScopeActive: boolean }
): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || options.hasPending) {
    return false
  }

  const target = event.target
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true
  }

  return (
    options.textEntryScopeActive &&
    target instanceof HTMLElement &&
    target.isContentEditable
  )
}

// --- The tree -------------------------------------------------------------

export interface KeymapNode {
  children: Map<string, KeymapNode>
  bindings: Keybinding[]
}

const emptyNode = (): KeymapNode => ({ children: new Map(), bindings: [] })

/**
 * Bindings as a prefix tree, keyed by chord.
 *
 * A tree rather than a flat map because "is this the start of something longer"
 * is the question a chord asks, and a map of whole sequences cannot answer it
 * without scanning every key.
 */
export function buildKeymapTree(bindings: readonly Keybinding[]): KeymapNode {
  const root = emptyNode()

  for (const binding of bindings) {
    const keystrokes = normaliseKeystrokes(binding.keystrokes)
    if (keystrokes.length === 0) continue

    let node = root
    for (const chord of keystrokes) {
      let child = node.children.get(chord)
      if (!child) {
        child = emptyNode()
        node.children.set(chord, child)
      }
      node = child
    }
    node.bindings.push(binding)
  }

  return root
}

function hasLiveBinding(
  node: KeymapNode,
  active: ReadonlySet<string>
): boolean {
  return (
    node.bindings.some((binding) =>
      scopesOf(binding).some((scope) => active.has(scope))
    ) ||
    [...node.children.values()].some((child) => hasLiveBinding(child, active))
  )
}

/**
 * The binding for these keystrokes under these scopes.
 *
 * Scope order decides the winner: the strongest active scope that binds the
 * sequence takes it, so the code editor can claim a key the app also uses
 * without either of them knowing about the other.
 */
export function matchKeystrokes(
  root: KeymapNode,
  keystrokes: readonly string[],
  activeScopes: readonly string[],
  definitions: readonly KeybindingScope[] = []
): KeymapMatch {
  const ordered = effectiveScopes(activeScopes, definitions)
  const active = new Set(ordered)

  let node = root
  for (const chord of normaliseKeystrokes(keystrokes)) {
    const child = node.children.get(chord)
    if (!child || !hasLiveBinding(child, active)) return { type: 'none' }
    node = child
  }

  for (const scope of [...ordered].toReversed()) {
    const binding = node.bindings.find((candidate) =>
      scopesOf(candidate).includes(scope)
    )
    if (binding) return { type: 'full', binding }
  }

  return hasLiveBinding(node, active) ? { type: 'prefix' } : { type: 'none' }
}

/** The strongest live binding for a command, for showing its keystrokes. */
export function findBindingForCommand(
  bindings: readonly Keybinding[],
  commandId: string,
  activeScopes: readonly string[],
  definitions: readonly KeybindingScope[] = []
): Keybinding | undefined {
  const ordered = effectiveScopes(activeScopes, definitions)

  for (const scope of [...ordered].toReversed()) {
    const binding = bindings.find(
      (candidate) =>
        candidate.commandId === commandId && scopesOf(candidate).includes(scope)
    )
    if (binding) return binding
  }

  // Nothing live right now, but the palette still wants to print the keystrokes
  // a command has — a shortcut is worth showing before its scope is entered.
  return bindings.find((candidate) => candidate.commandId === commandId)
}
