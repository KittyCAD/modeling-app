import { type ReadonlySignal, computed, signal } from '@preact/signals'
import type { Keybinding, KeybindingScope } from '@src/contracts/keybindings'
import {
  buildKeymapTree,
  chordFromEvent,
  hasTextEntryScope,
  isApplePlatform,
  matchKeystrokes,
  yieldsToTextEntry,
} from '@src/features/keybindings/keymap'

/**
 * How long a half-typed sequence waits for the rest of itself.
 *
 * Long enough to be deliberate, short enough that a keystroke swallowed by
 * accident does not leave the keyboard feeling broken.
 */
export const PENDING_TIMEOUT_MS = 1500

export interface KeymapDispatcherDependencies {
  bindings: ReadonlySignal<readonly Keybinding[]>
  scopes: ReadonlySignal<readonly KeybindingScope[]>
  /** Resolved lazily: the command service is not available while the graph builds. */
  run: (commandId: string) => void
  timeoutMs?: number
  /**
   * Whether `Mod` means Command. Injectable so the platform is a parameter of a
   * test rather than a property of the machine running it.
   */
  isApple?: boolean
}

export interface KeymapDispatcher {
  readonly activeScopes: ReadonlySignal<readonly string[]>
  readonly pending: ReadonlySignal<readonly string[]>
  applyScope: (scopeId: string) => void
  removeScope: (scopeId: string) => void
  focusScope: (scopeId: string) => { onFocus: () => void; onBlur: () => void }
  suspendListening: () => () => void
  /** True when the keystroke was taken, and the event was stopped. */
  handleKeyDown: (event: KeyboardEvent) => boolean
  dispose: () => void
}

/**
 * Turns keystrokes into commands.
 *
 * Separate from the registry item so the part with state in it — a sequence
 * half-typed, a suspension held, a timeout running — can be tested without a
 * window or a container.
 *
 * It holds no bindings of its own and never decides what a command does: a
 * binding resolves to a command id and nothing else, which is what stops the
 * keyboard becoming a second, divergent surface for triggering work.
 */
export function createKeymapDispatcher({
  bindings,
  scopes,
  run,
  timeoutMs = PENDING_TIMEOUT_MS,
  isApple = isApplePlatform(),
}: KeymapDispatcherDependencies): KeymapDispatcher {
  const tree = computed(() => buildKeymapTree(bindings.value))
  const activeScopes = signal<readonly string[]>([])
  const pending = signal<readonly string[]>([])

  /**
   * Reference counted rather than a boolean.
   *
   * Two overlapping callers each hold their own suspension, and listening
   * resumes only when the last lets go — with a boolean, the first release
   * would re-arm the keymap underneath the second caller.
   */
  let suspendCount = 0
  let timer: number | undefined

  const clearPending = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (pending.value.length > 0) pending.value = []
  }

  const holdPending = (keystrokes: readonly string[]) => {
    pending.value = keystrokes
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(clearPending, timeoutMs) as unknown as number
  }

  const claim = (event: KeyboardEvent) => {
    event.preventDefault()
    event.stopPropagation()
    // Immediate as well: a binding that has matched must not also reach a
    // handler attached earlier on the same element.
    event.stopImmediatePropagation()
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (suspendCount > 0) return false

    const chord = chordFromEvent(event, isApple)
    if (!chord) return false

    const held = pending.value

    if (
      yieldsToTextEntry(event, {
        chord,
        hasPending: held.length > 0,
        textEntryScopeActive: hasTextEntryScope(
          activeScopes.value,
          scopes.value
        ),
      })
    ) {
      return false
    }

    const attempt = (keystrokes: readonly string[]) =>
      matchKeystrokes(tree.value, keystrokes, activeScopes.value, scopes.value)

    const match = attempt([...held, chord])

    if (match.type === 'prefix') {
      claim(event)
      holdPending([...held, chord])
      return true
    }

    if (match.type === 'full') {
      claim(event)
      clearPending()
      run(match.binding.commandId)
      return true
    }

    if (held.length === 0) return false

    /*
     * The sequence went nowhere, so it was not a sequence. The keystroke gets a
     * second chance on its own: pressing `v` and then `⌘K` should open the
     * palette rather than lose the keystroke to a guess that turned out wrong.
     */
    clearPending()
    const retry = attempt([chord])

    if (retry.type === 'prefix') {
      claim(event)
      holdPending([chord])
      return true
    }

    if (retry.type === 'full') {
      claim(event)
      run(retry.binding.commandId)
      return true
    }

    return false
  }

  const dispatcher: KeymapDispatcher = {
    activeScopes: computed(() => activeScopes.value),
    pending: computed(() => pending.value),

    applyScope: (scopeId) => {
      if (activeScopes.value.includes(scopeId)) return
      activeScopes.value = [...activeScopes.value, scopeId]
    },

    removeScope: (scopeId) => {
      if (!activeScopes.value.includes(scopeId)) return
      activeScopes.value = activeScopes.value.filter((id) => id !== scopeId)
    },

    focusScope: (scopeId) => ({
      onFocus: () => dispatcher.applyScope(scopeId),
      onBlur: () => dispatcher.removeScope(scopeId),
    }),

    suspendListening: () => {
      suspendCount += 1
      clearPending()

      // Idempotent, because a caller that releases twice would otherwise
      // re-arm the keymap for someone else who is still holding it.
      let released = false
      return () => {
        if (released) return
        released = true
        suspendCount = Math.max(0, suspendCount - 1)
      }
    },

    handleKeyDown,
    dispose: clearPending,
  }

  return dispatcher
}
