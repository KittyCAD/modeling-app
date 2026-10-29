import { useSignals } from '@preact/signals-react/runtime'
import { getAutomaticallyRenderEnabledFromSettings } from '@src/lib/automaticRendering'
import { useApp } from '@src/lib/boot'
import { reportRejection } from '@src/lib/trap'
import { projectSession } from '@src/registry/contracts/projectSession'

export function CodeExecutionControls() {
  useSignals()
  const app = useApp()
  const settings = app.settings.useSettings()
  const automatic = getAutomaticallyRenderEnabledFromSettings(settings)
  const editor =
    app.registry.signal(projectSession).value?.executingEditor.value
  if (!editor) return null
  const dirty = editor.hasEditsSinceLastExecution.value
  const executing = editor.isExecuting.value
  const buttonClass =
    'px-2 py-0.5 text-xs border border-chalkboard-30 rounded-sm disabled:opacity-40'

  return (
    <div
      data-testid="code-execution-controls"
      className="shrink-0 px-2 py-1 border-b border-chalkboard-50/20"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={buttonClass}
          aria-label={
            automatic ? 'Pause execution' : 'Resume automatic execution'
          }
          aria-pressed={!automatic}
          onClick={() => {
            app.settings.actor.send({
              type: 'set.textEditor.automaticallyRender',
              data: { level: 'user', value: !automatic },
            })
            if (!automatic && dirty && !executing) {
              editor.executeCode().catch(reportRejection)
            }
          }}
        >
          {automatic ? 'Pause' : 'Resume'}
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={executing || !dirty}
          onClick={() => {
            editor.executeCode().catch(reportRejection)
          }}
        >
          Execute
        </button>
        {!automatic && <span className="text-xs text-2">Execution paused</span>}
      </div>
      {!automatic && dirty && (
        <p role="status" className="text-xs mt-1 text-2">
          Execute your changes to enable modeling tools. You can still rotate,
          zoom, and pan.
        </p>
      )}
    </div>
  )
}
