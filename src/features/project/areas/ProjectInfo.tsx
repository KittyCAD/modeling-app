import { useComputed } from '@preact/signals'
import { Button, EmptyState } from '@kittycad/ui-kit'
import { useService } from '@src/app/context'
import { projectSessionService } from '@src/contracts/projectSession'
import { formatRelativeTime, formatRevision } from '@src/lib/format'
import '../project.css'

/**
 * The project's title block, expanded.
 *
 * Same fields as the sheet card on the home screen, in the same order, so the
 * card and the panel teach each other. Below them, the two facts that are easy
 * to lose track of: which buffer is being read, and which one is executing.
 */
export function ProjectInfo() {
  const sessions = useService(projectSessionService)

  const session = useComputed(() => sessions.current.value)
  const project = useComputed(() => session.value?.project.value ?? null)
  const active = useComputed(() => session.value?.activeBuffer.value ?? null)
  const executing = useComputed(
    () => session.value?.executingBuffer.value ?? null
  )
  const buffers = useComputed(() => session.value?.buffers.value ?? [])

  if (!project.value) {
    return (
      <EmptyState
        icon="info"
        eyebrow="Project"
        title="No project open"
        description="Project details appear here once a project is open."
      />
    )
  }

  return (
    <div class="zds-info">
      <dl class="zds-info__block">
        <div class="zds-info__field">
          <dt class="zds-label">Name</dt>
          <dd class="zds-value">{project.value.name}</dd>
        </div>
        <div class="zds-info__field">
          <dt class="zds-label">Where</dt>
          <dd class="zds-value">{project.value.location ?? '—'}</dd>
        </div>
        <div class="zds-info__field">
          <dt class="zds-label">Rev</dt>
          <dd class="zds-value zds-numeric">
            {formatRevision(project.value.revision)}
          </dd>
        </div>
        <div class="zds-info__field">
          <dt class="zds-label">Edited</dt>
          <dd class="zds-value zds-numeric">
            {formatRelativeTime(project.value.modifiedAt)}
          </dd>
        </div>
        <div class="zds-info__field">
          <dt class="zds-label">Files</dt>
          <dd class="zds-value zds-numeric">{project.value.fileCount}</dd>
        </div>
      </dl>

      <hr class="zds-rule zds-info__rule" />

      <dl class="zds-info__block">
        <div class="zds-info__field">
          <dt class="zds-label">Reading</dt>
          <dd class="zds-value">{active.value?.name.value ?? 'nothing'}</dd>
        </div>
        <div class="zds-info__field">
          <dt class="zds-label">Executing</dt>
          <dd class="zds-value">{executing.value?.name.value ?? 'nothing'}</dd>
        </div>
      </dl>

      {buffers.value.length > 0 ? (
        <>
          <hr class="zds-rule zds-info__rule" />
          <p class="zds-label zds-info__heading">Open buffers</p>
          <ul class="zds-info__buffers">
            {buffers.value.map((buffer) => (
              <li class="zds-info__buffer" key={buffer.id}>
                <button
                  type="button"
                  class="zds-info__buffer-name"
                  aria-current={
                    active.value?.id === buffer.id ? 'true' : undefined
                  }
                  onClick={() => session.value?.setActiveBuffer(buffer.id)}
                >
                  {buffer.name}
                  {buffer.dirty.value ? (
                    <span class="zds-info__dirty" title="Unsaved changes">
                      ●
                    </span>
                  ) : null}
                </button>
                {buffer.languageId === 'kcl' &&
                executing.value?.id !== buffer.id ? (
                  <Button
                    variant="ghost"
                    size="small"
                    iconOnly
                    icon="play"
                    label={`Execute ${buffer.name.value}`}
                    onClick={() => session.value?.setExecutingBuffer(buffer.id)}
                  />
                ) : null}
                <Button
                  variant="ghost"
                  size="small"
                  iconOnly
                  icon="close"
                  label={`Close ${buffer.name.value}`}
                  onClick={() => session.value?.closeBuffer(buffer.id)}
                />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}
