import {
  appendValueSpec,
  defineContract,
  defineService,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'

/** The scope every binding falls into unless it says otherwise. */
export const BASE_SCOPE = 'base'

/**
 * A context in which bindings apply.
 *
 * Contributed, so a feature can declare the situation it cares about without
 * the keymap knowing what that situation is. A scope is applied and removed by
 * whoever knows it is true — the code editor applies its own on focus — and
 * nothing else has to agree about when that is.
 */
export interface KeybindingScope {
  id: string
  /** For the keybindings table, and for diagnosing which scope won. */
  displayName: string
  /**
   * Higher wins when two active scopes bind the same keystrokes.
   *
   * `base` is 0. A scope that exists to *take over* a key — the code editor
   * claiming a bare letter — needs to outrank the app-wide binding, and saying
   * so as a number keeps the answer independent of contribution order.
   */
  priority?: number
  /**
   * While this scope is active, a bare key belongs to whatever has focus.
   *
   * Set by a scope that exists *because* something is taking text — the code
   * editor, a rename field. A chord with Mod, Ctrl or Alt still dispatches; it
   * is only unmodified keys that would otherwise be stolen mid-word.
   *
   * Declared by the scope rather than hardcoded in the keymap, so the keymap
   * never learns what a code editor is.
   */
  textEntry?: boolean
}

/**
 * Keystrokes bound to a command.
 *
 * `keystrokes` is a sequence of chords, so `['v', '1']` means "press v, then 1"
 * and `['Mod+K']` is a single chord. Each chord is written the way it is read —
 * `Mod+Shift+P`, `Escape` — with `Mod` meaning Command on macOS and Control
 * elsewhere, so one binding covers both platforms. Modifier order does not
 * matter: the chord is normalised before anything compares it.
 */
export interface Keybinding {
  keystrokes: readonly string[]
  commandId: string
  /**
   * Who this binding came from, filled in when the user's keymap is resolved.
   *
   * The settings dialog prints it for the same reason the settings dialog prints
   * a setting's level: "why is this key doing that" should have an answer that
   * does not require reading a file.
   */
  source?: 'app' | 'user'
  /**
   * Where this binding applies. Absent means `base`: everywhere.
   *
   * Listing more than one is an "or" — the binding is live if any of them is
   * active.
   */
  scopes?: readonly string[]
}

/**
 * What the keymap did with a keystroke.
 *
 * `prefix` is the state that makes chords possible: the keystroke matched the
 * beginning of something but not the whole of it, so the next one has to be
 * held against both.
 */
export type KeymapMatch =
  | { type: 'none' }
  | { type: 'prefix' }
  | { type: 'full'; binding: Keybinding }

/**
 * A line in the user's keymap.
 *
 * `command` prefixed with `-` is an unbind, which is VS Code's convention and
 * worth keeping: a keymap has to be able to say "not this" about a binding the
 * app shipped, and inventing a `disabled = true` field means every reader has to
 * remember it.
 */
export interface PersistedBinding {
  command: string
  /** Absent on an unbind, which is about the command rather than the keys. */
  keystrokes?: readonly string[]
  scopes?: readonly string[]
}

/**
 * The user's keymap as stored.
 *
 * Its own document with its own version, deliberately outside the settings
 * cascade: an override here is a patch against what the app shipped, not an
 * answer to "for me or for this project".
 */
export interface PersistedKeymap {
  version: 1
  bindings: readonly PersistedBinding[]
}

export interface KeybindingService {
  readonly bindings: ReadonlySignal<readonly Keybinding[]>
  /** What features contributed, before the user's keymap is applied. */
  readonly contributed: ReadonlySignal<readonly Keybinding[]>
  /** The user's keymap, as stored. Empty until it has been read. */
  readonly persisted: ReadonlySignal<PersistedKeymap>
  /** Where the keymap is kept, for the dialog to print. */
  readonly location: ReadonlySignal<string>
  readonly scopes: ReadonlySignal<readonly KeybindingScope[]>
  /** Scopes currently applied, in the order they were applied. */
  readonly activeScopes: ReadonlySignal<readonly string[]>
  /**
   * Chords typed so far that matched a prefix and nothing else yet.
   *
   * Empty almost always. Exposed rather than kept private because a pending
   * chord has to be visible — a keyboard that has silently eaten a keystroke
   * and is waiting for another is indistinguishable from one that is broken.
   */
  readonly pending: ReadonlySignal<readonly string[]>
  /** Display form for a command, for tooltips and palette rows. */
  displayFor(commandId: string): string | undefined
  applyScope(scopeId: string): void
  removeScope(scopeId: string): void
  /**
   * Handlers that hold a scope for as long as something has focus.
   *
   * A pair rather than an effect over a signal, because focus is a DOM fact and
   * the element that has it is the only thing that reliably knows.
   */
  focusScope(scopeId: string): { onFocus: () => void; onBlur: () => void }
  /**
   * Stop dispatching until the returned function is called.
   *
   * For UI that needs the raw keystrokes for itself — the capture field in a
   * keybindings editor, which cannot record `Mod+K` if the palette opens first.
   * Reference counted, so overlapping callers each release their own hold.
   */
  suspendListening(): () => void

  /** Replace the stored keymap wholesale. */
  save(keymap: PersistedKeymap): Promise<void>
  /**
   * Give a command these keystrokes, replacing whatever it had.
   *
   * Per command rather than per binding, because that is the question someone
   * asks: they want *this action* on *these keys*, and they do not care how many
   * bindings the app happened to ship for it.
   */
  rebind(
    commandId: string,
    keystrokes: readonly string[],
    scopes?: readonly string[]
  ): Promise<void>
  /** Take a command's keys away, leaving it reachable only from the palette. */
  unbind(commandId: string): Promise<void>
  /** Forget what the user stored about a command, restoring the app's answer. */
  restore(commandId: string): Promise<void>
}

/**
 * Somewhere the keymap is kept.
 *
 * The same shape as the settings store, and for the same reason: the desktop
 * writes a file the user can edit by hand, the web writes browser storage, and
 * nothing above this line knows which.
 */
export interface KeymapStore {
  readonly id: string
  readonly location: ReadonlySignal<string>
  read(): Promise<string | null>
  write(text: string): Promise<void>
  /** Called with the new text when something else changes it. */
  watch?(listener: (text: string | null) => void): () => void
}

/**
 * Keystrokes resolve to command ids, and nothing more.
 *
 * A binding holds no behaviour: it cannot do anything a command does not
 * already do, which is what keeps the keyboard from becoming a second,
 * divergent surface for triggering work. Scopes decide *whether* a binding is
 * live, never *what* it does.
 */
export const keybindingsContract = defineContract({
  keybindingsValueSpec: appendValueSpec<Keybinding>('keybindings'),
  keybindingScopesValueSpec:
    appendValueSpec<KeybindingScope>('keybindings.scopes'),
  keybindingService: defineService<KeybindingService>('keybindings.service'),
})

export const {
  keybindingsValueSpec,
  keybindingScopesValueSpec,
  keybindingService,
} = keybindingsContract
