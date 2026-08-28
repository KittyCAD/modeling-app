import { describe, expect, it } from 'vitest'
import type { Keybinding, PersistedKeymap } from '@src/contracts/keybindings'
import {
  emptyKeymap,
  parseKeymap,
  persistedFor,
  resolveBindings,
  serialiseKeymap,
  withRebind,
  withUnbind,
  withoutLine,
} from '@src/features/keybindings/persistedKeymap'

const CONTRIBUTED: Keybinding[] = [
  { keystrokes: ['Mod+K'], commandId: 'palette.open' },
  { keystrokes: ['Mod+1'], commandId: 'layout.toggle.code' },
  { keystrokes: ['v', '1'], commandId: 'camera.view.top' },
  { keystrokes: ['Mod+Enter'], commandId: 'execution.run', scopes: ['editor'] },
]

const keymap = (bindings: PersistedKeymap['bindings']): PersistedKeymap => ({
  version: 1,
  bindings,
})

describe('resolveBindings', () => {
  it('is the contributed set when nothing is stored', () => {
    const resolved = resolveBindings(CONTRIBUTED, emptyKeymap())

    expect(resolved).toHaveLength(CONTRIBUTED.length)
    expect(resolved.every((binding) => binding.source === 'app')).toBe(true)
  })

  /**
   * Per command, not per binding. Someone rebinding "toggle code panel" is
   * answering "I want this action on these keys" and neither knows nor cares how
   * many bindings the app shipped for it.
   */
  it('replaces every contributed binding for a command it rebinds', () => {
    const resolved = resolveBindings(
      [
        ...CONTRIBUTED,
        { keystrokes: ['Mod+Alt+1'], commandId: 'layout.toggle.code' },
      ],
      keymap([{ command: 'layout.toggle.code', keystrokes: ['Mod+B'] }])
    )

    const forCommand = resolved.filter(
      (binding) => binding.commandId === 'layout.toggle.code'
    )
    expect(forCommand).toEqual([
      {
        keystrokes: ['Mod+B'],
        commandId: 'layout.toggle.code',
        scopes: undefined,
        source: 'user',
      },
    ])
  })

  it('applies every line someone writes for one command', () => {
    const resolved = resolveBindings(
      CONTRIBUTED,
      keymap([
        { command: 'palette.open', keystrokes: ['Mod+P'] },
        { command: 'palette.open', keystrokes: ['Mod+Shift+P'] },
      ])
    )

    expect(
      resolved
        .filter((binding) => binding.commandId === 'palette.open')
        .map((binding) => binding.keystrokes)
    ).toEqual([['Mod+P'], ['Mod+Shift+P']])
  })

  /** A keymap has to be able to say "not this" about something the app shipped. */
  it('takes a command’s keys away on an unbind', () => {
    const resolved = resolveBindings(
      CONTRIBUTED,
      keymap([{ command: '-camera.view.top' }])
    )

    expect(
      resolved.some((binding) => binding.commandId === 'camera.view.top')
    ).toBe(false)
    // Everything else is untouched.
    expect(resolved).toHaveLength(CONTRIBUTED.length - 1)
  })

  it('keeps the scopes a stored line names', () => {
    const resolved = resolveBindings(
      CONTRIBUTED,
      keymap([
        {
          command: 'execution.run',
          keystrokes: ['Mod+R'],
          scopes: ['editor'],
        },
      ])
    )

    expect(resolved[0]).toMatchObject({
      commandId: 'execution.run',
      scopes: ['editor'],
      source: 'user',
    })
  })

  /**
   * The user's bindings come first, so taking a chord the app was already using
   * means yours fires. Both stay in the list, so a dialog can point at the
   * collision rather than the app quietly losing.
   */
  it('puts the user first, so a taken chord goes to them', () => {
    const resolved = resolveBindings(
      CONTRIBUTED,
      keymap([{ command: 'camera.view.top', keystrokes: ['Mod+K'] }])
    )

    expect(resolved[0]).toMatchObject({
      commandId: 'camera.view.top',
      source: 'user',
    })
    expect(
      resolved.some((binding) => binding.commandId === 'palette.open')
    ).toBe(true)
  })

  it('ignores a line that binds nothing', () => {
    const resolved = resolveBindings(
      CONTRIBUTED,
      keymap([
        { command: 'palette.open', keystrokes: [] },
        { command: '', keystrokes: ['Mod+J'] },
      ])
    )

    // The empty-keystroke line still claims the command — the user said
    // something about it — but adds nothing, so the command ends up unbound.
    expect(
      resolved.some((binding) => binding.commandId === 'palette.open')
    ).toBe(false)
    expect(resolved.every((binding) => binding.commandId.length > 0)).toBe(true)
  })
})

describe('editing a keymap', () => {
  it('replaces a command’s lines on a rebind', () => {
    const before = keymap([
      { command: 'palette.open', keystrokes: ['Mod+P'] },
      { command: 'files.newFile', keystrokes: ['Mod+N'] },
    ])

    const after = withRebind(before, 'palette.open', ['Mod+Shift+P'], ['base'])

    expect(after.bindings).toEqual([
      { command: 'files.newFile', keystrokes: ['Mod+N'] },
      {
        command: 'palette.open',
        keystrokes: ['Mod+Shift+P'],
        scopes: ['base'],
      },
    ])
  })

  it('replaces a command’s lines on an unbind', () => {
    const after = withUnbind(
      keymap([{ command: 'palette.open', keystrokes: ['Mod+P'] }]),
      'palette.open'
    )

    expect(after.bindings).toEqual([{ command: '-palette.open' }])
  })

  it('drops one line by position, leaving the rest', () => {
    const after = withoutLine(
      keymap([
        { command: 'a', keystrokes: ['Mod+A'] },
        { command: 'b', keystrokes: ['Mod+B'] },
      ]),
      0
    )

    expect(after.bindings).toEqual([{ command: 'b', keystrokes: ['Mod+B'] }])
  })

  it('finds the lines that concern a command, unbinds included', () => {
    const found = persistedFor(
      keymap([
        { command: 'a', keystrokes: ['Mod+A'] },
        { command: '-b' },
        { command: 'b', keystrokes: ['Mod+B'] },
      ]),
      'b'
    )

    expect(found.map((entry) => entry.index)).toEqual([1, 2])
  })
})

describe('the file', () => {
  it('round-trips', () => {
    const before = keymap([
      { command: 'palette.open', keystrokes: ['Mod+P'] },
      { command: 'camera.view.top', keystrokes: ['v', '1'], scopes: ['base'] },
      { command: '-files.delete' },
    ])

    expect(parseKeymap(serialiseKeymap(before))).toEqual(before)
  })

  it('reads as a list of decisions', () => {
    const text = serialiseKeymap(
      keymap([{ command: 'palette.open', keystrokes: ['Mod+P'] }])
    )

    expect(text).toContain('version = 1')
    expect(text).toContain('[[bindings]]')
    expect(text).toContain('command = "palette.open"')
  })

  /** A broken keymap file must not be a broken app. */
  it('treats an unreadable file as no keymap at all', () => {
    expect(parseKeymap('this is not toml {{{')).toEqual(emptyKeymap())
    expect(parseKeymap('')).toEqual(emptyKeymap())
  })

  it('leaves a file from a future version alone', () => {
    const text =
      'version = 99\n\n[[bindings]]\ncommand = "a"\nkeystrokes = ["Mod+A"]\n'
    expect(parseKeymap(text)).toEqual(emptyKeymap())
  })

  /** One bad line costs that line, not the whole keyboard. */
  it('drops the lines it cannot understand', () => {
    const text = [
      'version = 1',
      '',
      '[[bindings]]',
      'command = "good"',
      'keystrokes = ["Mod+G"]',
      '',
      '[[bindings]]',
      'keystrokes = ["Mod+H"]', // no command
      '',
      '[[bindings]]',
      'command = "no-keys"', // not an unbind, and nothing to bind
      '',
      '[[bindings]]',
      'command = "-fine"', // an unbind needs no keys
    ].join('\n')

    expect(parseKeymap(text).bindings).toEqual([
      { command: 'good', keystrokes: ['Mod+G'] },
      { command: '-fine' },
    ])
  })

  it('keeps only the strings out of a list of anything', () => {
    const text =
      'version = 1\n\n[[bindings]]\ncommand = "a"\nkeystrokes = ["Mod+A", "", "Mod+B"]\n'
    expect(parseKeymap(text).bindings).toEqual([
      { command: 'a', keystrokes: ['Mod+A', 'Mod+B'] },
    ])
  })
})
