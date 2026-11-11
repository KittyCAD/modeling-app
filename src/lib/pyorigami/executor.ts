import { defineExecutorCapability } from '@src/lib/executors/registry/contract'
import { matchesPyorigami } from '@src/lib/pyorigami/document'
import { isErr, reportRejection } from '@src/lib/trap'
import {
  PYORIGAMI_CANCEL_CHANNEL,
  PYORIGAMI_RENDER_CHANNEL,
  type PyorigamiRenderResult,
} from '@src/registry/plugins/pyorigami/ipc'

/** Each source snapshot owns a cancellable Python process in the desktop runtime. */
export const pyorigamiExecutorCapability = defineExecutorCapability({
  id: 'pyorigami.svg',
  matches: matchesPyorigami,
  execute: async (contents, { src, signal }) => {
    const ipc = globalThis.window?.electron?.pluginIpc
    if (!ipc) return new Error('pyOrigami rendering requires the desktop app.')
    if (signal.aborted) return new Error('pyOrigami rendering was cancelled.')
    const runId = crypto.randomUUID()
    const cancel = () => {
      void ipc
        .invoke(PYORIGAMI_CANCEL_CHANNEL, { runId })
        .catch(reportRejection)
    }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      const result = await ipc.invoke<PyorigamiRenderResult>(
        PYORIGAMI_RENDER_CHANNEL,
        { runId, contents, src }
      )
      if (signal.aborted) return new Error('pyOrigami rendering was cancelled.')
      return result.ok
        ? { pages: result.pages, authoring: result.authoring }
        : new Error(result.error)
    } catch (cause) {
      return isErr(cause) ? cause : new Error(String(cause))
    } finally {
      signal.removeEventListener('abort', cancel)
    }
  },
})
