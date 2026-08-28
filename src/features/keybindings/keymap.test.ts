import { describe, expect, it } from 'vitest'
import type { Keybinding, KeybindingScope } from '@src/contracts/keybindings'
import {
  buildKeymapTree,
  chordFromEvent,
  displayChord,
  displayKeystrokes,
  effectiveScopes,
  findBindingForCommand,
  hasTextEntryScope,
  matchKeystrokes,
  normaliseChord,
  yieldsToTextEntry,
} from '@src/features/keybindings/keymap'

const event = (
  key: string,
  init: {
    code?: string
    altKey?: boolean
    ctrlKey?: boolean
    metaKey?: boolean
    shiftKey?: boolean
  } = {}
) => ({
  key,
  code: init.code ?? '',
  altKey: init.altKey ?? false,
  ctrlKey: init.ctrlKey ?? false,
  metaKey: init.metaKey ?? false,
  shiftKey: init.shiftKey ?? false,
})

const binding = (
  keystrokes: readonly string[],
  commandId: string,
  scopes?: readonly string[]
): Keybinding => ({ keystrokes, commandId, scopes })

const EDITOR: KeybindingScope = {
  id: 'editor',
  displayName: 'Editor',
  priority: 1000,
  textEntry: true,
}

describe('normaliseChord', () => {
  it('is indifferent to modifier order', () => {
    // The bug this prevents: a binding written the way a human says it
    // ("shift-command-1") silently never firing.
    expect(normaliseChord('Shift+Mod+1')).toBe(normaliseChord('Mod+Shift+1'))
  })

  it('lowercases and trims', () => {
    expect(normaliseChord(' Mod + K ')).toBe('mod+k')
  })

  it('resolves the names people actually write', () => {
    expect(normaliseChord('Cmd+K')).toBe('meta+k')
    expect(normaliseChord('Option+D')).toBe('alt+d')
    expect(normaliseChord('Control+P')).toBe('ctrl+p')
    expect(normaliseChord('Esc')).toBe('escape')
  })

  it('keeps a bare key a bare key', () => {
    expect(normaliseChord('v')).toBe('v')
    expect(normaliseChord('Escape')).toBe('escape')
  })
})

describe('chordFromEvent', () => {
  it('resolves Mod per platform', () => {
    expect(chordFromEvent(event('k', { metaKey: true }), true)).toBe('mod+k')
    expect(chordFromEvent(event('k', { ctrlKey: true }), false)).toBe('mod+k')
  })

  it('keeps the other modifier distinct from Mod', () => {
    expect(chordFromEvent(event('k', { ctrlKey: true }), true)).toBe('ctrl+k')
    expect(chordFromEvent(event('k', { metaKey: true }), false)).toBe('meta+k')
  })

  it('ignores a modifier pressed on its own', () => {
    expect(chordFromEvent(event('Shift', { shiftKey: true }), true)).toBeNull()
    expect(chordFromEvent(event('Meta', { metaKey: true }), true)).toBeNull()
  })

  /**
   * Shift and a digit produce the symbol, so `Mod+Shift+1` would never match
   * what the browser reports. `event.code` still says which key it was.
   */
  it('reads a shifted digit from the code', () => {
    expect(
      chordFromEvent(
        event('!', { code: 'Digit1', metaKey: true, shiftKey: true }),
        true
      )
    ).toBe('mod+shift+1')
  })

  /** macOS Alt composes: Alt+D arrives as ∂. */
  it('reads an alt-composed letter from the code', () => {
    expect(
      chordFromEvent(event('∂', { code: 'KeyD', altKey: true }), true)
    ).toBe('alt+d')
  })

  it('reads alt-composed punctuation from the code', () => {
    expect(
      chordFromEvent(event('≠', { code: 'Equal', altKey: true }), true)
    ).toBe('alt+=')
  })

  /**
   * Without Alt, the letter comes from `event.key` — so a binding follows the
   * letter printed on the cap rather than a position on a US keyboard.
   */
  it('prefers the reported key for an unmodified letter', () => {
    expect(chordFromEvent(event('ж', { code: 'KeyA' }), true)).toBe('ж')
  })

  it('names the space bar', () => {
    expect(chordFromEvent(event(' ', { code: 'Space' }), true)).toBe('space')
  })
})

describe('display', () => {
  it("uses Apple's own modifier order", () => {
    // ⌃⌥⇧⌘, whatever order the binding was written in.
    expect(displayChord('mod+shift+1', true)).toBe('⇧⌘1')
    expect(displayChord('mod+ctrl+alt+shift+k', true)).toBe('⌃⌥⇧⌘K')
  })

  it('spells modifiers out elsewhere', () => {
    expect(displayChord('mod+shift+1', false)).toBe('Ctrl+Shift+1')
  })

  it('names the keys that have no glyph', () => {
    expect(displayChord('escape', true)).toBe('Esc')
    expect(displayChord('mod+arrowup', true)).toBe('⌘↑')
    expect(displayChord('enter', true)).toBe('Enter')
  })

  it('separates a sequence with a space, and a chord with a plus', () => {
    expect(displayKeystrokes(['v', '1'], true)).toBe('V 1')
    expect(displayKeystrokes(['mod+k'], false)).toBe('Ctrl+K')
  })
})

describe('effectiveScopes', () => {
  it('always includes base, weakest', () => {
    expect(effectiveScopes([], [])).toEqual(['base'])
    expect(effectiveScopes(['editor'], [EDITOR])).toEqual(['base', 'editor'])
  })

  it('orders by priority, weakest first', () => {
    const scopes: KeybindingScope[] = [
      { id: 'low', displayName: 'Low', priority: 10 },
      { id: 'high', displayName: 'High', priority: 100 },
    ]
    expect(effectiveScopes(['high', 'low'], scopes)).toEqual([
      'base',
      'low',
      'high',
    ])
  })

  it('breaks a tie on the order they were applied', () => {
    const scopes: KeybindingScope[] = [
      { id: 'a', displayName: 'A' },
      { id: 'b', displayName: 'B' },
    ]
    expect(effectiveScopes(['a', 'b'], scopes)).toEqual(['base', 'a', 'b'])
    expect(effectiveScopes(['b', 'a'], scopes)).toEqual(['base', 'b', 'a'])
  })

  it('does not care about an unknown scope', () => {
    expect(effectiveScopes(['mystery'], [])).toEqual(['base', 'mystery'])
  })
})

describe('matchKeystrokes', () => {
  const tree = buildKeymapTree([
    binding(['Mod+K'], 'palette.open'),
    binding(['v', '1'], 'view.front'),
    binding(['v', '2'], 'view.back'),
    binding(['g'], 'grid.toggle'),
    binding(['Mod+Enter'], 'execution.run', ['editor']),
    binding(['Mod+Enter'], 'execution.runAll'),
  ])

  it('matches a single chord', () => {
    const match = matchKeystrokes(tree, ['mod+k'], [])
    expect(match).toEqual({
      type: 'full',
      binding: expect.objectContaining({ commandId: 'palette.open' }),
    })
  })

  it('reports an unbound chord as nothing', () => {
    expect(matchKeystrokes(tree, ['mod+j'], []).type).toBe('none')
  })

  it('holds a sequence open, then completes it', () => {
    expect(matchKeystrokes(tree, ['v'], []).type).toBe('prefix')
    expect(matchKeystrokes(tree, ['v', '1'], [])).toEqual({
      type: 'full',
      binding: expect.objectContaining({ commandId: 'view.front' }),
    })
  })

  it('abandons a sequence that goes nowhere', () => {
    expect(matchKeystrokes(tree, ['v', '9'], []).type).toBe('none')
  })

  /**
   * A prefix is only a prefix if something live is behind it. Otherwise the
   * keymap would swallow the keystroke and then have nothing to offer.
   */
  it('does not hold a sequence whose bindings are all out of scope', () => {
    const scoped = buildKeymapTree([
      binding(['v', '1'], 'view.front', ['editor']),
    ])
    expect(matchKeystrokes(scoped, ['v'], [], [EDITOR]).type).toBe('none')
    expect(matchKeystrokes(scoped, ['v'], ['editor'], [EDITOR]).type).toBe(
      'prefix'
    )
  })

  it('gives a contested chord to the strongest active scope', () => {
    expect(matchKeystrokes(tree, ['mod+enter'], ['editor'], [EDITOR])).toEqual({
      type: 'full',
      binding: expect.objectContaining({ commandId: 'execution.run' }),
    })
  })

  it('falls back to base when the stronger scope is not active', () => {
    expect(matchKeystrokes(tree, ['mod+enter'], [], [EDITOR])).toEqual({
      type: 'full',
      binding: expect.objectContaining({ commandId: 'execution.runAll' }),
    })
  })

  it('normalises what it is given, so authoring order does not matter', () => {
    const written = buildKeymapTree([binding(['Shift+Mod+P'], 'palette.all')])
    expect(matchKeystrokes(written, ['mod+shift+p'], []).type).toBe('full')
  })

  it('ignores a binding with no keystrokes at all', () => {
    const empty = buildKeymapTree([binding([], 'nothing')])
    expect(matchKeystrokes(empty, [''], []).type).toBe('none')
  })
})

describe('findBindingForCommand', () => {
  const bindings = [
    binding(['Mod+Enter'], 'execution.run', ['editor']),
    binding(['Mod+Shift+Enter'], 'execution.run'),
  ]

  it('prefers the binding that would actually fire', () => {
    expect(
      findBindingForCommand(bindings, 'execution.run', ['editor'], [EDITOR])
        ?.keystrokes
    ).toEqual(['Mod+Enter'])

    expect(
      findBindingForCommand(bindings, 'execution.run', [], [EDITOR])?.keystrokes
    ).toEqual(['Mod+Shift+Enter'])
  })

  it('still answers for a command whose scope is not active', () => {
    // The palette lists commands it cannot run yet; printing the shortcut is
    // more use than printing nothing.
    const scopedOnly = [binding(['Mod+Enter'], 'execution.run', ['editor'])]
    expect(
      findBindingForCommand(scopedOnly, 'execution.run', [], [EDITOR])
        ?.keystrokes
    ).toEqual(['Mod+Enter'])
  })

  it('has nothing to say about an unbound command', () => {
    expect(findBindingForCommand(bindings, 'nope', [], [])).toBeUndefined()
  })
})

describe('yieldsToTextEntry', () => {
  const input = () => document.createElement('input')

  const editable = () => {
    const element = document.createElement('div')
    Object.defineProperty(element, 'isContentEditable', { value: true })
    return element
  }

  const bare = { altKey: false, ctrlKey: false, metaKey: false }
  const withMod = { altKey: false, ctrlKey: true, metaKey: false }
  const quiet = { hasPending: false, textEntryScopeActive: false }

  it('lets a text field keep an unmodified key', () => {
    expect(yieldsToTextEntry({ ...bare, target: input() }, quiet)).toBe(true)
  })

  /** The bug this fixes: ⌘1 was dead while the editor had focus. */
  it('never yields a modified chord', () => {
    expect(yieldsToTextEntry({ ...withMod, target: input() }, quiet)).toBe(
      false
    )
  })

  it('never yields mid-sequence', () => {
    expect(
      yieldsToTextEntry(
        { ...bare, target: input() },
        { ...quiet, hasPending: true }
      )
    ).toBe(false)
  })

  it('yields to a content-editable only when a scope says it is taking text', () => {
    expect(yieldsToTextEntry({ ...bare, target: editable() }, quiet)).toBe(
      false
    )
    expect(
      yieldsToTextEntry(
        { ...bare, target: editable() },
        { ...quiet, textEntryScopeActive: true }
      )
    ).toBe(true)
  })

  /**
   * The chords the platform edits text with go to the field. Without this, an
   * app-level `⌘Z` would undo the document while someone was typing a filename.
   */
  it('gives the platform’s editing chords to a focused field', () => {
    const withMod = { altKey: false, ctrlKey: true, metaKey: false }

    for (const chord of ['mod+z', 'mod+shift+z', 'mod+x', 'mod+a']) {
      expect(
        yieldsToTextEntry({ ...withMod, target: input() }, { ...quiet, chord })
      ).toBe(true)
    }
  })

  it('keeps every other modified chord for the app', () => {
    const withMod = { altKey: false, ctrlKey: true, metaKey: false }

    expect(
      yieldsToTextEntry(
        { ...withMod, target: input() },
        { ...quiet, chord: 'mod+1' }
      )
    ).toBe(false)
  })

  it('gives an editing chord to the code editor too', () => {
    // Content-editable, and a scope saying it is taking text: CodeMirror's own
    // history keymap handles it, which is what it is there for.
    expect(
      yieldsToTextEntry(
        { altKey: false, ctrlKey: true, metaKey: false, target: editable() },
        { hasPending: false, textEntryScopeActive: true, chord: 'mod+z' }
      )
    ).toBe(true)
  })

  it('takes an editing chord when nothing is holding text', () => {
    expect(
      yieldsToTextEntry(
        {
          altKey: false,
          ctrlKey: true,
          metaKey: false,
          target: document.createElement('div'),
        },
        { ...quiet, chord: 'mod+z' }
      )
    ).toBe(false)
  })

  it('never yields an editing chord mid-sequence', () => {
    expect(
      yieldsToTextEntry(
        { altKey: false, ctrlKey: true, metaKey: false, target: input() },
        { ...quiet, hasPending: true, chord: 'mod+z' }
      )
    ).toBe(false)
  })

  it('has nothing to yield to when nothing is focused', () => {
    expect(yieldsToTextEntry({ ...bare, target: null }, quiet)).toBe(false)
  })
})

describe('hasTextEntryScope', () => {
  it('is true only while such a scope is applied', () => {
    expect(hasTextEntryScope(['editor'], [EDITOR])).toBe(true)
    expect(hasTextEntryScope([], [EDITOR])).toBe(false)
    expect(
      hasTextEntryScope(['other'], [{ id: 'other', displayName: 'Other' }])
    ).toBe(false)
  })
})
