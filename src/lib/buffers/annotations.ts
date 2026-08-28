import { Annotation } from '@codemirror/state'

/**
 * Who caused a transaction.
 *
 * Recorded as an annotation rather than inferred, because several decisions
 * depend on it and guessing is not an option: persistence must ignore its own
 * writes, reconciliation must not look like a user edit, and history must not
 * record a reconciliation as something to undo.
 */
export const bufferOrigin = Annotation.define<BufferOrigin>()

export type BufferOrigin =
  /** Typed or edited in a mounted view. */
  | 'user'
  /** A command, keybinding, or palette action. */
  | 'command'
  /** Written back from disk, or an external change folded in. */
  | 'reconcile'
  /** A structural reconfiguration of the capability compartment. */
  | 'capability'
  /** A coordinated project-level mutation. */
  | 'project'
  /** A single-file semantic edit: formatting, a modelling action, an agent. */
  | 'semantic'

/**
 * An explicit request to execute this buffer now.
 *
 * Carried as an annotation so a re-run travels the same dispatch boundary as
 * every other change, and so the request stays declarative data in a
 * transaction rather than a side channel around the buffer. A re-run is not an
 * edit, so it changes no text — which is exactly why it needs saying out loud:
 * the adapter otherwise only reacts to content changes.
 */
export const requestExecution = Annotation.define<boolean>()

/**
 * An explicit request for the keyboard.
 *
 * Travels with the transaction for the same reason `requestExecution` does: it
 * is a declarative part of what the change *meant*, not a side channel around
 * the buffer, and only a mounted view can honour it.
 *
 * What asks for this is an edit that puts the cursor somewhere on purpose — an
 * empty sketch block waiting to be drawn in. Leaving the cursor there while the
 * keyboard is somewhere else would be half of the gesture: nothing would be
 * typed into it, and anything reading "where is the user" from focus would say
 * they had not arrived.
 */
export const requestFocus = Annotation.define<boolean>()

/** Read the origin off a transaction, defaulting to a user edit. */
export function originOf(transaction: {
  annotation: (annotation: typeof bufferOrigin) => BufferOrigin | undefined
}): BufferOrigin {
  return transaction.annotation(bufferOrigin) ?? 'user'
}
