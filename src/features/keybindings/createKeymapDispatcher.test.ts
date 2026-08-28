import { signal } from '@preact/signals'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Keybinding, KeybindingScope } from '@src/contracts/keybindings'
import {
  PENDING_TIMEOUT_MS,
  createKeymapDispatcher,
} from '@src/features/keybindings/createKeymapDispatcher'

const EDITOR: KeybindingScope = {
  id: 'editor',
  displayName: 'Editor',
  priority: 1000,
  textEntry: true,
}

const DEFAULT_BINDINGS: Keybinding[] = [
  { keystrokes: ['Mod+K'], commandId: 'palette.open' },
  { keystrokes: ['v', '1'], commandId: 'view.front' },
  { keystrokes: ['v', '2'], commandId: 'view.back' },
  { keystrokes: ['g'], commandId: 'grid.toggle' },
  { keystrokes: ['Mod+Enter'], commandId: 'execution.run', scopes: ['editor'] },
  { keystrokes: ['Mod+Enter'], commandId: 'execution.runAll' },
]

function setup(bindings: Keybinding[] = DEFAULT_BINDINGS) {
  const ran: string[] = []
  const bindingsSignal = signal<readonly Keybinding[]>(bindings)

  const dispatcher = createKeymapDispatcher({
    bindings: bindingsSignal,
    scopes: signal<readonly KeybindingScope[]>([EDITOR]),
    run: (commandId) => ran.push(commandId),
    // Pinned, so these tests read the same on a Linux CI runner as on a Mac.
    isApple: true,
  })

  return { dispatcher, ran, bindingsSignal }
}

/**
 * A keydown that records what was done to it.
 *
 * Built by hand rather than dispatched through the DOM: what matters is which
 * of the three stop-propagation calls the dispatcher makes, and a real event
 * would not report that.
 */
function keydown(
  key: string,
  init: {
    code?: string
    metaKey?: boolean
    ctrlKey?: boolean
    altKey?: boolean
    shiftKey?: boolean
    target?: EventTarget | null
  } = {}
) {
  const calls = { prevented: 0, stopped: 0, stoppedImmediate: 0 }

  const event = {
    key,
    code: init.code ?? '',
    metaKey: init.metaKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
    target: init.target ?? null,
    preventDefault: () => {
      calls.prevented += 1
    },
    stopPropagation: () => {
      calls.stopped += 1
    },
    stopImmediatePropagation: () => {
      calls.stoppedImmediate += 1
    },
  }

  return { event: event as unknown as KeyboardEvent, calls }
}

/** `Mod` is Command, because the dispatcher above is pinned to Apple. */
const mod = (key: string, extra: Parameters<typeof keydown>[1] = {}) =>
  keydown(key, { metaKey: true, ...extra })

describe('keymap dispatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs the command a chord is bound to', () => {
    const { dispatcher, ran } = setup()
    const { event, calls } = mod('k')

    expect(dispatcher.handleKeyDown(event)).toBe(true)
    expect(ran).toEqual(['palette.open'])
    expect(calls).toEqual({ prevented: 1, stopped: 1, stoppedImmediate: 1 })
  })

  it('leaves an unbound keystroke completely alone', () => {
    const { dispatcher, ran } = setup()
    const { event, calls } = mod('j')

    expect(dispatcher.handleKeyDown(event)).toBe(false)
    expect(ran).toEqual([])
    expect(calls).toEqual({ prevented: 0, stopped: 0, stoppedImmediate: 0 })
  })

  it('ignores a modifier pressed on its own', () => {
    const { dispatcher, ran } = setup()
    expect(
      dispatcher.handleKeyDown(keydown('Meta', { metaKey: true }).event)
    ).toBe(false)
    expect(ran).toEqual([])
  })

  describe('sequences', () => {
    it('holds the first chord, then runs on the second', () => {
      const { dispatcher, ran } = setup()

      const first = keydown('v')
      expect(dispatcher.handleKeyDown(first.event)).toBe(true)
      expect(dispatcher.pending.value).toEqual(['v'])
      expect(ran).toEqual([])
      // Claimed, or the `v` would also be typed into whatever is focused.
      expect(first.calls.prevented).toBe(1)

      expect(dispatcher.handleKeyDown(keydown('1').event)).toBe(true)
      expect(dispatcher.pending.value).toEqual([])
      expect(ran).toEqual(['view.front'])
    })

    it('forgets a sequence nobody finished', () => {
      const { dispatcher, ran } = setup()

      dispatcher.handleKeyDown(keydown('v').event)
      vi.advanceTimersByTime(PENDING_TIMEOUT_MS)

      expect(dispatcher.pending.value).toEqual([])
      expect(ran).toEqual([])
    })

    it('keeps waiting while the sequence is still being typed', () => {
      const { dispatcher } = setup([
        { keystrokes: ['v', '1', '2'], commandId: 'deep' },
      ])

      dispatcher.handleKeyDown(keydown('v').event)
      vi.advanceTimersByTime(PENDING_TIMEOUT_MS - 100)
      dispatcher.handleKeyDown(keydown('1').event)
      vi.advanceTimersByTime(PENDING_TIMEOUT_MS - 100)

      // The second chord restarted the clock rather than inheriting the first's.
      expect(dispatcher.pending.value).toEqual(['v', '1'])
    })

    /**
     * The keystroke that ends a sequence nobody bound is not wasted. Otherwise
     * a stray `v` would eat the next real shortcut.
     */
    it('gives the keystroke a second chance on its own', () => {
      const { dispatcher, ran } = setup()

      dispatcher.handleKeyDown(keydown('v').event)
      const rescued = mod('k')

      expect(dispatcher.handleKeyDown(rescued.event)).toBe(true)
      expect(ran).toEqual(['palette.open'])
      expect(dispatcher.pending.value).toEqual([])
    })

    it('starts a new sequence when the second chance is itself a prefix', () => {
      const { dispatcher, ran } = setup()

      dispatcher.handleKeyDown(keydown('g').event) // bound on its own
      expect(ran).toEqual(['grid.toggle'])

      dispatcher.handleKeyDown(keydown('v').event)
      dispatcher.handleKeyDown(keydown('v').event)
      expect(dispatcher.pending.value).toEqual(['v'])

      dispatcher.handleKeyDown(keydown('2').event)
      expect(ran).toEqual(['grid.toggle', 'view.back'])
    })

    it('releases a keystroke that leads nowhere at all', () => {
      const { dispatcher, ran } = setup()

      dispatcher.handleKeyDown(keydown('v').event)
      const lost = keydown('z')

      expect(dispatcher.handleKeyDown(lost.event)).toBe(false)
      expect(lost.calls.prevented).toBe(0)
      expect(ran).toEqual([])
      expect(dispatcher.pending.value).toEqual([])
    })
  })

  describe('scopes', () => {
    it('gives a contested chord to the scope that is active', () => {
      const { dispatcher, ran } = setup()

      dispatcher.handleKeyDown(mod('Enter').event)
      expect(ran).toEqual(['execution.runAll'])

      dispatcher.applyScope('editor')
      dispatcher.handleKeyDown(mod('Enter').event)
      expect(ran).toEqual(['execution.runAll', 'execution.run'])

      dispatcher.removeScope('editor')
      dispatcher.handleKeyDown(mod('Enter').event)
      expect(ran).toEqual([
        'execution.runAll',
        'execution.run',
        'execution.runAll',
      ])
    })

    it('applies a scope once, however many times it is asked', () => {
      const { dispatcher } = setup()
      dispatcher.applyScope('editor')
      dispatcher.applyScope('editor')
      expect(dispatcher.activeScopes.value).toEqual(['editor'])
    })

    it('holds a scope for as long as something has focus', () => {
      const { dispatcher } = setup()
      const focus = dispatcher.focusScope('editor')

      focus.onFocus()
      expect(dispatcher.activeScopes.value).toEqual(['editor'])
      focus.onBlur()
      expect(dispatcher.activeScopes.value).toEqual([])
    })
  })

  describe('text entry', () => {
    const input = () => document.createElement('input')

    const editable = () => {
      const element = document.createElement('div')
      Object.defineProperty(element, 'isContentEditable', { value: true })
      return element
    }

    it('lets a field keep an unmodified key', () => {
      const { dispatcher, ran } = setup()
      const typed = keydown('g', { target: input() })

      expect(dispatcher.handleKeyDown(typed.event)).toBe(false)
      expect(ran).toEqual([])
      expect(typed.calls.prevented).toBe(0)
    })

    /** The regression this whole change exists for. */
    it('still dispatches a modified chord while someone is typing', () => {
      const { dispatcher, ran } = setup()

      dispatcher.applyScope('editor')
      dispatcher.handleKeyDown(mod('k', { target: editable() }).event)

      expect(ran).toEqual(['palette.open'])
    })

    it('does not break a sequence already in progress', () => {
      const { dispatcher, ran } = setup()

      dispatcher.handleKeyDown(keydown('v').event)
      dispatcher.handleKeyDown(keydown('1', { target: input() }).event)

      expect(ran).toEqual(['view.front'])
    })

    /** The regression the native-editing exception exists to prevent. */
    it('leaves undo to the field someone is typing in', () => {
      const { dispatcher, ran } = setup([
        { keystrokes: ['Mod+Z'], commandId: 'buffer.undo' },
      ])

      const typed = mod('z', { target: input() })
      expect(dispatcher.handleKeyDown(typed.event)).toBe(false)
      expect(ran).toEqual([])
      expect(typed.calls.prevented).toBe(0)
    })

    it('takes undo when nothing is holding text', () => {
      const { dispatcher, ran } = setup([
        { keystrokes: ['Mod+Z'], commandId: 'buffer.undo' },
      ])

      dispatcher.handleKeyDown(mod('z').event)
      expect(ran).toEqual(['buffer.undo'])
    })

    it('only yields a content-editable to a scope that says it takes text', () => {
      const { dispatcher, ran } = setup()

      dispatcher.handleKeyDown(keydown('g', { target: editable() }).event)
      expect(ran).toEqual(['grid.toggle'])

      dispatcher.applyScope('editor')
      dispatcher.handleKeyDown(keydown('g', { target: editable() }).event)
      expect(ran).toEqual(['grid.toggle'])
    })
  })

  describe('suspending', () => {
    it('stops dispatching until released', () => {
      const { dispatcher, ran } = setup()

      const release = dispatcher.suspendListening()
      expect(dispatcher.handleKeyDown(mod('k').event)).toBe(false)
      expect(ran).toEqual([])

      release()
      dispatcher.handleKeyDown(mod('k').event)
      expect(ran).toEqual(['palette.open'])
    })

    it('resumes only when the last holder lets go', () => {
      const { dispatcher, ran } = setup()

      const first = dispatcher.suspendListening()
      const second = dispatcher.suspendListening()

      first()
      dispatcher.handleKeyDown(mod('k').event)
      expect(ran).toEqual([])

      second()
      dispatcher.handleKeyDown(mod('k').event)
      expect(ran).toEqual(['palette.open'])
    })

    it('ignores a holder that releases twice', () => {
      const { dispatcher, ran } = setup()

      const first = dispatcher.suspendListening()
      const second = dispatcher.suspendListening()

      first()
      first()
      dispatcher.handleKeyDown(mod('k').event)
      expect(ran).toEqual([])

      second()
      dispatcher.handleKeyDown(mod('k').event)
      expect(ran).toEqual(['palette.open'])
    })

    it('drops a half-typed sequence when it suspends', () => {
      const { dispatcher } = setup()

      dispatcher.handleKeyDown(keydown('v').event)
      dispatcher.suspendListening()
      expect(dispatcher.pending.value).toEqual([])
    })
  })

  it('follows bindings that change under it', () => {
    const { dispatcher, ran, bindingsSignal } = setup()

    dispatcher.handleKeyDown(mod('k').event)
    expect(ran).toEqual(['palette.open'])

    bindingsSignal.value = [{ keystrokes: ['Mod+K'], commandId: 'palette.all' }]
    dispatcher.handleKeyDown(mod('k').event)
    expect(ran).toEqual(['palette.open', 'palette.all'])
  })
})
