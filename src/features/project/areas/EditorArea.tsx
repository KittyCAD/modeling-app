import { useComputed } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { Button, EmptyState, Icon } from '@kittycad/ui-kit'
import { useService } from '@src/app/context'
import type { FileBackedTextBuffer } from '@src/contracts/buffers'
import { layoutService } from '@src/contracts/layout'
import { projectSessionService } from '@src/contracts/projectSession'
import { EXPLORER_AREA_ID } from '@src/features/project/areaIds'
import '../project.css'

/**
 * A mounted CodeMirror view for one buffer.
 *
 * Deliberately thin, and deliberately not the owner of anything. Mounting
 * attaches a view to a buffer that already exists and already holds the
 * document; unmounting detaches it. Neither is a document lifecycle operation,
 * which is why closing this pane does not lose the document, the dirty state, or
 * the undo stack.
 *
 * Keyed on `buffer.id`, so switching buffers tears down one view and builds
 * another rather than trying to swap a document underneath a live view.
 */
function BufferView({ buffer }: { buffer: FileBackedTextBuffer }) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const parent = host.current
    if (!parent) return
    return buffer.attachView(parent)
  }, [buffer])

  return <div class="zds-editor__host" ref={host} />
}

/**
 * The editor pane.
 *
 * "No active buffer" is where a freshly opened project lands, so it is treated
 * as a destination with an action rather than as a blank.
 */
export function EditorArea() {
  const sessions = useService(projectSessionService)
  const layout = useService(layoutService)

  const buffer = useComputed(
    () => sessions.current.value?.activeBuffer.value ?? null
  )

  if (!buffer.value) {
    return (
      <EmptyState
        scale="page"
        icon="fileCode"
        eyebrow="Editor"
        title="No file open"
        description="Pick a file from Files to open it here. Opening a file does not change what the engine is executing."
        actions={
          <Button
            icon="sidebarLeft"
            label="Show files"
            onClick={() => layout.openArea(EXPLORER_AREA_ID)}
          />
        }
      />
    )
  }

  return <BufferEditor buffer={buffer.value} />
}

function BufferEditor({ buffer }: { buffer: FileBackedTextBuffer }) {
  const sessions = useService(projectSessionService)

  const divergence = useComputed(() => buffer.divergence.value)

  return (
    <div class="zds-editor">
      <header class="zds-editor__bar">
        <span class="zds-label">{buffer.languageId}</span>
        <span class="zds-editor__path zds-value">
          {sessions.current.value?.relativePathFor(buffer) ?? 'scratch buffer'}
        </span>
        {buffer.dirty.value ? (
          <span class="zds-editor__dirty zds-label" title="Unsaved changes">
            Unsaved
          </span>
        ) : null}
        <Button
          variant="ghost"
          size="small"
          iconOnly
          icon="close"
          label={`Close ${buffer.name.value}`}
          onClick={() => sessions.current.value?.closeBuffer(buffer.id)}
        />
      </header>

      {/*
        A file changed underneath unsaved edits. Nothing was overwritten, so the
        choice is the user's — and it is presented as a choice rather than as an
        error, because neither answer is wrong.
      */}
      {divergence.value !== null ? (
        <div class="zds-editor__divergence" role="alert">
          <Icon name="warning" size="small" />
          <span class="zds-editor__divergence-text">
            This file changed on disk while you had unsaved edits.
          </span>
          <Button
            size="small"
            label="Keep mine"
            onClick={() => buffer.dismissDivergence()}
          />
          <Button
            size="small"
            variant="primary"
            label="Use the file"
            onClick={() => buffer.acceptDivergence()}
          />
        </div>
      ) : null}

      {/* Keyed so a buffer switch rebuilds the view rather than reusing it. */}
      <BufferView buffer={buffer} key={buffer.id} />
    </div>
  )
}
