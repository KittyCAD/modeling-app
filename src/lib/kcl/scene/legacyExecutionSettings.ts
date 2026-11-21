import { effect, untracked } from '@preact/signals-core'
import type { SceneExecutionSettings } from '@src/lib/kcl/scene/executionSettings'
import { reportRejection } from '@src/lib/trap'

/**
 * Request execution when a contributed input changes for the active, connected
 * legacy scene. Rust decides whether to reuse geometry or reapply settings.
 * `execute-streamed` inputs do not refresh geometry-only connections.
 *
 * `capture` binds the execution callback to the current file, project, and
 * connection. File opening and reconnecting own their initial execution, so
 * changes while inactive or disconnected update the baseline without running.
 */
export function observeLegacySceneExecutionSettings({
  settings,
  active,
  connected,
  geometryOnly,
  capture,
}: {
  settings: SceneExecutionSettings
  active: () => boolean
  connected: () => boolean
  geometryOnly: () => boolean
  capture: () => {
    isCurrent: () => boolean
    execute: () => Promise<unknown>
  }
}) {
  let previousExecute = settings.executeRevision.peek()
  let previousStreamed = settings.streamedRevision.peek()
  return effect(() => {
    const enabled = active()
    const hasConnection = connected()
    const execute = settings.executeRevision.value
    const streamed = settings.streamedRevision.value
    const executeChanged = execute !== previousExecute
    const streamedChanged = streamed !== previousStreamed
    previousExecute = execute
    previousStreamed = streamed
    if (!enabled || !hasConnection) return
    // Reads made while scheduling execution must not become refresh inputs.
    untracked(() => {
      if (!executeChanged && !(streamedChanged && !geometryOnly())) return
      const owner = capture()
      if (owner.isCurrent()) void owner.execute().catch(reportRejection)
    })
  })
}
