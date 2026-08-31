import { useComputed } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { Button, EmptyState, Icon } from '@kittycad/ui-kit'
import { useService } from '@src/app/context'
import type { FileBackedTextBuffer } from '@src/contracts/buffers'
import { layoutService } from '@src/contracts/layout'
import { projectSessionService } from '@src/contracts/projectSession'
import { EXPLORER_AREA_ID } from '@src/features/project/areaIds'
import { BufferTabs } from '@src/features/project/areas/BufferTabs'
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
 * "No file open" is where a freshly opened project lands, so it is treated as a
 * destination with an action rather than as a blank. Once anything is open the
 * frame stays — the tab strip is part of the panel, not part of the file, so it
 * must not come and go with the selection.
 */
export function EditorArea() {
  const sessions = useService(projectSessionService)
  const layout = useService(layoutService)

  const session = useComputed(() => sessions.current.value)
  const buffers = useComputed(() => session.value?.buffers.value ?? [])
  const buffer = useComputed(() => session.value?.activeBuffer.value ?? null)

  const current = session.value
  if (!current || buffers.value.length === 0) {
    return (
      <EmptyState
        scale="page"
        icon="fileCode"
        eyebrow="Editor"
        title="No file open"
        description="Pick a file from Files to open it here. Opening a file does not change what the engine is executing."
        // Only offered when the tree is actually hidden: an action that does
        // nothing is worse than no action, and here the files are usually
        // already sitting alongside.
        actions={
          layout.isAreaOpen(EXPLORER_AREA_ID).value ? undefined : (
            <Button
              icon="sidebarLeft"
              label="Show files"
              onClick={() => layout.openArea(EXPLORER_AREA_ID)}
            />
          )
        }
      />
    )
  }

  return (
    <div class="zds-editor">
      <header class="zds-editor__bar">
        {/*
          The file tree's hide/show, outside the scrolling strip so it stays
          reachable however many files are open. In the bar of the panel the tree
          lives in rather than out on the rail: the tree is part of reading code,
          so its affordance belongs where the code is.
        */}
        <Button
          variant="ghost"
          size="small"
          iconOnly
          icon="sidebarLeft"
          label="Files"
          pressed={layout.isAreaOpen(EXPLORER_AREA_ID)}
          onClick={() => layout.toggleArea(EXPLORER_AREA_ID)}
        />
        <BufferTabs session={current} />
      </header>

      {buffer.value ? (
        <BufferEditor buffer={buffer.value} />
      ) : (
        /*
         * Open files, none selected. Reachable by deselecting rather than by
         * closing, so it says how to get back rather than how to start.
         */
        <EmptyState
          scale="page"
          icon="fileCode"
          eyebrow="Editor"
          title="Nothing selected"
          description="Choose one of the open files above."
        />
      )}
    </div>
  )
}

function BufferEditor({ buffer }: { buffer: FileBackedTextBuffer }) {
  const divergence = useComputed(() => buffer.divergence.value)

  return (
    <>
      {/*
        A file changed underneath unsaved edits. Nothing was overwritten, so the
        choice is the user's — and it is presented as a choice rather than as an
        error, because neither answer is wrong.
      */}
      {divergence.value !== null ? (
        <div class="zds-editor__divergence" role="alert">
          <Icon name="warning" size="small" />
          <span class="zds-editor__divergence-text">
            This file changed on disk while you had unsaved edits. Saving is
            paused until you choose.
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
    </>
  )
}
