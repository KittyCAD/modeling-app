import { useComputed } from '@preact/signals'
import { Button, EmptyState, Spinner } from '@kittycad/ui-kit'
import { useService } from '@src/app/context'
import { executionCoordinatorService } from '@src/contracts/execution'
import { idleExecutionState } from '@src/contracts/execution'
import { projectSessionService } from '@src/contracts/projectSession'
import '../project.css'

/**
 * Where geometry appears.
 *
 * Four distinct states, and they mean genuinely different things. Collapsing
 * them into one "no model" message is how someone ends up unable to tell which
 * of them they are looking at:
 *
 * - nothing executing — a choice the user made and can undo
 * - running — wait
 * - the KCL does not parse — their problem, and fixable, with the count of what
 *   is wrong
 * - parses, but no engine — infrastructure, and nothing they can do about it
 */
export function ViewportArea() {
  const sessions = useService(projectSessionService)
  const coordinator = useService(executionCoordinatorService)

  const session = useComputed(() => sessions.current.value)
  const executing = useComputed(
    () => session.value?.executingBuffer.value ?? null
  )
  const kclBuffers = useComputed(
    () =>
      session.value?.buffers.value.filter(
        (buffer) => buffer.languageId.value === 'kcl'
      ) ?? []
  )
  const state = useComputed(() =>
    executing.value
      ? coordinator.stateFor(executing.value.id).value
      : idleExecutionState('none')
  )

  if (!executing.value) {
    return (
      <div class="zds-viewport zds-grid-field">
        <EmptyState
          scale="page"
          icon="cube"
          eyebrow="Model"
          title="No file is executing"
          description="Choose which file drives the model. It does not have to be the file you are reading."
          actions={
            kclBuffers.value.length > 0 ? (
              <Button
                icon="play"
                label={`Execute ${kclBuffers.value[0].name.value}`}
                onClick={() =>
                  session.value?.setExecutingBuffer(kclBuffers.value[0].id)
                }
              />
            ) : undefined
          }
        />
      </div>
    )
  }

  const name = executing.value.name.value
  const errors = state.value.diagnostics.filter(
    (diagnostic) => diagnostic.severity === 'error'
  ).length

  if (state.value.status === 'running' || state.value.status === 'queued') {
    return (
      <div class="zds-viewport zds-grid-field">
        <EmptyState
          scale="page"
          eyebrow="Model"
          title={`Running ${name}`}
          description="Reading the program and checking it for errors."
          actions={<Spinner label={`Executing ${name}`} size="large" />}
        />
      </div>
    )
  }

  if (state.value.status === 'failed') {
    return (
      <div class="zds-viewport zds-grid-field">
        <EmptyState
          scale="page"
          icon="warning"
          eyebrow="Model"
          title="Could not run this file"
          description={state.value.error ?? 'The execution engine failed.'}
        />
      </div>
    )
  }

  if (errors > 0) {
    return (
      <div class="zds-viewport zds-grid-field">
        <EmptyState
          scale="page"
          icon="error"
          eyebrow="Model"
          title={`${name} has ${errors} error${errors === 1 ? '' : 's'}`}
          description="The errors are marked in the editor's gutter. Geometry appears once the program parses."
        />
      </div>
    )
  }

  return (
    <div class="zds-viewport zds-grid-field">
      <EmptyState
        scale="page"
        icon="unplugged"
        eyebrow="Model"
        title="Not connected to the engine"
        description={
          state.value.runCount > 0
            ? `${name} parses cleanly. Geometry appears once the modeling engine is connected.`
            : `${name} is set to execute. Geometry appears once the modeling engine is connected.`
        }
      />
    </div>
  )
}
