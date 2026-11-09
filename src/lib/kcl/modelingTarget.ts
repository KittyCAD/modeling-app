import type { Editor } from '@src/lib/editors/registry/contract'
import type { KclSession } from '@src/lib/kcl/session'
import type { KclModelSnapshot } from '@src/lib/kcl/stdlibExtrude'

/** A command target survives focus changes, but becomes unavailable when its mode is released. */
export interface ModelingTarget {
  id: string
  editor: Editor
  session: KclSession
}
export function currentModel(
  target: ModelingTarget
): KclModelSnapshot | undefined {
  const snapshot = target.session.snapshot.peek()
  return snapshot &&
    snapshot.src === target.editor.src.peek() &&
    snapshot.contents === target.editor.contents.peek()
    ? snapshot
    : undefined
}

const snapshotIds = new WeakMap<KclModelSnapshot, string>()
/** A palette choice binds both the editor and the displayed execution; reexecution invalidates it. */
export function modelingTargetBinding(
  target: ModelingTarget
): string | undefined {
  const snapshot = currentModel(target)
  if (!snapshot) return
  let id = snapshotIds.get(snapshot)
  if (!id) {
    id = crypto.randomUUID()
    snapshotIds.set(snapshot, id)
  }
  return `${target.id}:${id}`
}
