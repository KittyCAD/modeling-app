import { isolateHistory } from '@codemirror/commands'
import { Transaction } from '@codemirror/state'
import { defineContract, defineService } from '@kittycad/registry'
import type { Editor } from '@src/lib/editors/registry/contract'
import type { AuthoringOperation } from '@src/lib/pyorigami/authoringTypes'
import { isErr, reportRejection } from '@src/lib/trap'
import {
  PYORIGAMI_AUTHOR_CHANNEL,
  PYORIGAMI_CANCEL_CHANNEL,
  type PyorigamiAuthorResult,
} from '@src/registry/plugins/pyorigami/ipc'

export interface PyorigamiAuthoringService {
  apply: (
    editor: Editor,
    source: string,
    operation: AuthoringOperation,
    signal: AbortSignal
  ) => Promise<Error | undefined>
}
export const { pyorigamiAuthoringService } = defineContract({
  pyorigamiAuthoringService: defineService<PyorigamiAuthoringService>(
    'pyorigami.authoring'
  ),
})

/** Imports and the requested operation commit together against the captured document revision. */
export const authoringService: PyorigamiAuthoringService = {
  apply: async (editor, source, operation, signal) => {
    if (editor.signal.aborted || signal.aborted)
      return new Error('This origami view is closed.')
    if (editor.contents.peek() !== source)
      return new Error(
        'The diagram changed. Wait for its preview before editing.'
      )
    const document = editor.state.doc
    const ipc = globalThis.window?.electron?.pluginIpc
    if (!ipc) return new Error('pyOrigami authoring requires the desktop app.')
    const runId = crypto.randomUUID()
    const cancel = () => {
      void ipc
        .invoke(PYORIGAMI_CANCEL_CHANNEL, { runId })
        .catch(reportRejection)
    }
    signal.addEventListener('abort', cancel, { once: true })
    editor.signal.addEventListener('abort', cancel, { once: true })
    try {
      const result = await ipc.invoke<PyorigamiAuthorResult>(
        PYORIGAMI_AUTHOR_CHANNEL,
        { runId, contents: source, src: editor.src.peek() ?? '', operation }
      )
      if (signal.aborted || editor.signal.aborted)
        return new Error('Origami authoring was cancelled.')
      if (!result.ok) return new Error(result.error)
      if (editor.state.doc !== document)
        return new Error(
          'The source changed during this edit. Try again with the updated diagram.'
        )
      if (source === result.contents) return
      // Keep the unchanged prefix/suffix out of the replacement so other cursors can map.
      let from = 0
      let oldEnd = source.length
      let newEnd = result.contents.length
      while (
        from < oldEnd &&
        from < newEnd &&
        source[from] === result.contents[from]
      )
        from++
      while (
        oldEnd > from &&
        newEnd > from &&
        source[oldEnd - 1] === result.contents[newEnd - 1]
      ) {
        oldEnd--
        newEnd--
      }
      editor.dispatch({
        changes: {
          from,
          to: oldEnd,
          insert: result.contents.slice(from, newEnd),
        },
        annotations: [
          isolateHistory.of('full'),
          Transaction.userEvent.of('input.pyorigami'),
        ],
      })
    } catch (cause) {
      return isErr(cause) ? cause : new Error(String(cause))
    } finally {
      signal.removeEventListener('abort', cancel)
      editor.signal.removeEventListener('abort', cancel)
    }
  },
}
