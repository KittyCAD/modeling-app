import { useComputed } from '@preact/signals'
import { Button, EmptyState } from '@kittycad/ui-kit'
import { useService } from '@src/app/context'
import { layoutService } from '@src/contracts/layout'
import { projectSessionService } from '@src/contracts/projectSession'
import { EXPLORER_AREA_ID } from '@src/features/project/areaIds'
import '../project.css'

/**
 * Where a buffer is read and edited.
 *
 * For now it renders the buffer's text read-only, and says so. The real
 * CodeMirror view — where the document, its undo history, and every
 * single-file transaction live — replaces the body of this component without
 * changing anything around it, because the area only ever reaches the buffer
 * through the session.
 *
 * "No active buffer" is the state you land in when a project opens, so it is
 * treated as a destination with an action rather than as a blank.
 */
export function EditorArea() {
  const sessions = useService(projectSessionService)
  const layout = useService(layoutService)

  const buffer = useComputed(
    () => sessions.current.value?.activeBuffer.value ?? null
  )
  const lines = useComputed(() => buffer.value?.text.value.split('\n') ?? [])

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

  return (
    <div class="zds-editor">
      <header class="zds-editor__bar">
        <span class="zds-label">{buffer.value.languageId}</span>
        <span class="zds-editor__path zds-value">{buffer.value.path}</span>
        <span class="zds-editor__badge zds-label">Read-only preview</span>
      </header>
      <div class="zds-editor__body zds-scroll">
        <pre class="zds-editor__doc">
          <code>
            {lines.value.map((line, index) => (
              // Lines are positional by nature; the index is the identity.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              <span class="zds-editor__line" key={index}>
                <span class="zds-editor__gutter" aria-hidden="true">
                  {index + 1}
                </span>
                <span class="zds-editor__text">{line || ' '}</span>
              </span>
            ))}
          </code>
        </pre>
      </div>
    </div>
  )
}
