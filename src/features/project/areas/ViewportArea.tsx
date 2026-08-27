import { useComputed } from '@preact/signals'
import { Button, EmptyState } from '@kittycad/ui-kit'
import { useService } from '@src/app/context'
import { projectSessionService } from '@src/contracts/projectSession'
import '../project.css'

/**
 * Where geometry appears.
 *
 * Two empty states, and they mean different things. Nothing executing is a
 * choice the user can make and undo. Nothing connected is an infrastructure
 * problem they cannot. Collapsing them into one "no model" message is how a
 * user ends up unable to tell which of the two they are looking at.
 */
export function ViewportArea() {
  const sessions = useService(projectSessionService)

  const session = useComputed(() => sessions.current.value)
  const executing = useComputed(
    () => session.value?.executingBuffer.value ?? null
  )
  const kclBuffers = useComputed(
    () =>
      session.value?.buffers.value.filter(
        (buffer) => buffer.languageId === 'kcl'
      ) ?? []
  )

  if (!executing.value) {
    return (
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
    )
  }

  return (
    <div class="zds-viewport zds-grid-field">
      <EmptyState
        scale="page"
        icon="unplugged"
        eyebrow="Model"
        title="Not connected to the engine"
        description={`${executing.value.name.value} is set to execute. Geometry appears once the modeling engine is connected.`}
      />
    </div>
  )
}
