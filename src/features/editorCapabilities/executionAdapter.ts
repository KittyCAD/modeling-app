import { lintGutter, setDiagnostics } from '@codemirror/lint'
import type { Diagnostic } from '@codemirror/lint'
import { effect } from '@preact/signals'
import type { EditorCapability } from '@src/contracts/buffers'
import type {
  ExecutionCoordinator,
  ExecutionDiagnostic,
} from '@src/contracts/execution'
import type { ProjectSnapshot } from '@src/contracts/projectSession'
import { bufferOrigin, requestExecution } from '@src/lib/buffers/annotations'
import { hashString } from '@src/lib/hash'

/** Quiet period before submitting. Long enough to not execute mid-word. */
const EXECUTE_DEBOUNCE_MS = 350

export interface ExecutionAdapterDependencies {
  coordinator: () => ExecutionCoordinator
  /** The project as it stands, for executors that resolve imports. */
  captureSnapshot: () => ProjectSnapshot | null
  /**
   * Whether something else is publishing diagnostics for a language.
   *
   * CodeMirror's lint state holds one writer's worth of diagnostics, so two
   * writers means whichever ran last wins and the other's disappear without a
   * trace. When a language server is serving a language it owns the gutter,
   * because it answers per keystroke rather than per execution and it knows about
   * more than one file. The coordinator's diagnostics are still produced — they
   * are what a headless caller reads — they just do not reach the view.
   */
  diagnosticsOwnedElsewhere?: (languageId: string) => boolean
}

const toCodeMirrorDiagnostic = (
  diagnostic: ExecutionDiagnostic
): Diagnostic => ({
  from: diagnostic.from,
  to: diagnostic.to,
  severity: diagnostic.severity,
  message: diagnostic.message,
})

/**
 * The privileged execution adapter.
 *
 * Applies only to eligible buffers — KCL, and the one holding the executing
 * role — so an ordinary buffer never acquires a path to the modelling runtime.
 * That eligibility is *structural*, which is why toggling which buffer executes
 * reconfigures the bundle exactly once rather than being checked on every
 * keystroke.
 *
 * The adapter itself owns nothing asynchronous. It submits a versioned capture
 * and renders whatever comes back; scheduling, supersession, cancellation, and
 * staleness are all the coordinator's, because an extension that owned them
 * would tie the runtime's lifetime to a mounted view.
 *
 * Diagnostics return through `setDiagnostics`, a transaction carrying
 * declarative data. No callbacks in effect payloads, and no rebuild of the
 * extension bundle — diagnostics are volatile, and volatile values must not
 * reconfigure an editor.
 */
export function createExecutionAdapterCapability(
  dependencies: ExecutionAdapterDependencies
): EditorCapability {
  return {
    id: 'editor.executionAdapter',
    order: 50,
    appliesTo: (context) =>
      context.languageId === 'kcl' && context.executing && !context.readOnly,

    // The gutter is the only structural part: somewhere to draw the markers.
    extension: () => [lintGutter()],

    bind: (buffer) => {
      let timer: number | undefined
      let disposed = false

      /** Nothing should be submitted after teardown. */
      const active = () => !disposed

      const submit = () => {
        if (!active()) return

        const path = buffer.path.peek()
        const project = dependencies.captureSnapshot()
        if (!project) return

        const contents = buffer.text.peek()
        dependencies.coordinator().request({
          bufferId: buffer.id,
          // Captured now, so a result arriving later can be checked against it.
          bufferVersion: buffer.version.peek(),
          pathRevision: buffer.pathRevision.peek(),
          path,
          languageId: buffer.languageId.peek(),
          contents,
          contentId: hashString(contents),
          project,
        })
      }

      const schedule = () => {
        window.clearTimeout(timer)
        timer = window.setTimeout(submit, EXECUTE_DEBOUNCE_MS)
      }

      const stopWatchingEdits = buffer.onChange((change) => {
        // An explicit re-run goes now: the user asked, so there is no typing to
        // wait out.
        if (
          change.transactions.some((transaction) =>
            transaction.annotation(requestExecution)
          )
        ) {
          window.clearTimeout(timer)
          submit()
          return
        }

        if (!change.docChanged) return
        // A reconfiguration is not a content change.
        if (change.origin === 'capability') return
        schedule()
      })

      /**
       * Push results into the document.
       *
       * Guarded on the result's version: the coordinator already rejects stale
       * results, and this is the second half of the same check, since a result
       * can be current when accepted and stale by the time it renders.
       */
      const stopWatchingResults = effect(() => {
        const state = dependencies.coordinator().stateFor(buffer.id).value
        if (state.resultVersion === null) return
        if (state.resultVersion !== buffer.version.peek()) return

        // Read inside the effect so it follows a server starting or stopping
        // mid-session rather than whatever was true when the buffer opened.
        if (
          dependencies.diagnosticsOwnedElsewhere?.(buffer.languageId.peek())
        ) {
          return
        }

        buffer.dispatch({
          ...setDiagnostics(
            buffer.state.peek(),
            state.diagnostics.map(toCodeMirrorDiagnostic)
          ),
          // Marked so nothing downstream mistakes it for an edit: it changes no
          // text, so persistence ignores it and history never sees it.
          annotations: bufferOrigin.of('semantic'),
        })
      })

      // Run once on becoming eligible, so a buffer that is already open reports
      // its diagnostics without waiting for the next keystroke.
      submit()

      return () => {
        disposed = true
        window.clearTimeout(timer)
        stopWatchingEdits()
        stopWatchingResults()
        // The buffer is no longer eligible, or no longer exists at all. A run
        // still in flight for it is wasted engine time.
        dependencies.coordinator().cancel(buffer.id)
      }
    },
  }
}
