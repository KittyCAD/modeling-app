import { useEffect, useRef } from 'preact/hooks'
import { Icon } from '@kittycad/ui-kit'
import type { FileBackedTextBuffer } from '@src/contracts/buffers'
import type { ProjectSession } from '@src/contracts/projectSession'
import '../project.css'

/**
 * The open buffers, as tabs.
 *
 * Two things this app needs a tab strip to say that most do not, and both come
 * from the same place: *viewing and executing are separate here*. A tab is which
 * file you are reading, and exactly one file — not necessarily that one — is the
 * one the engine is building. So the executing tab is marked, and the mark is not
 * the selection.
 *
 * Choosing what executes stays in the top bar, where the file crumb already owns
 * it. A second control for it here would be a second place to keep in step, and
 * the strip's job is to tell you the answer rather than to ask again.
 */

/** Which icon a buffer gets, from what it holds rather than from its name. */
const iconFor = (buffer: FileBackedTextBuffer) =>
  buffer.languageId.value === 'kcl' ? 'fileCode' : 'file'

function BufferTab({
  buffer,
  session,
  active,
  executing,
}: {
  buffer: FileBackedTextBuffer
  session: ProjectSession
  active: boolean
  executing: boolean
}) {
  const element = useRef<HTMLDivElement>(null)
  const name = buffer.name.value

  /**
   * Keep the selected tab where it can be seen.
   *
   * A tab strip that scrolls can put the active tab off the end — opening a
   * tenth file, or closing one and having the selection land on a neighbour that
   * has since scrolled away. `nearest` rather than `center`, so a tab already in
   * view is left exactly where it is.
   */
  useEffect(() => {
    if (!active) return
    element.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  const close = () => session.closeBuffer(buffer.id)

  return (
    <div
      ref={element}
      class="zds-tabs__tab"
      role="tab"
      aria-selected={active}
      // One stop in the tab order for the strip, not one per file: arrow keys
      // move between tabs, which is what a tablist promises.
      tabIndex={active ? 0 : -1}
      data-active={active ? 'true' : undefined}
      data-executing={executing ? 'true' : undefined}
      // The name is rarely enough — two folders can hold a `main.kcl` — so the
      // path is on the tooltip, along with what the marks mean.
      title={[
        session.relativePathFor(buffer) ?? 'scratch buffer',
        executing ? 'Executing' : null,
        buffer.dirty.value ? 'Unsaved changes' : null,
      ]
        .filter(Boolean)
        .join(' · ')}
      onClick={() => session.setActiveBuffer(buffer.id)}
      // Middle click closes, which is what a middle click does to a tab
      // everywhere else.
      onAuxClick={(event) => {
        if (event.button !== 1) return
        event.preventDefault()
        close()
      }}
    >
      <Icon name={iconFor(buffer)} size="small" />
      <span class="zds-tabs__name">{name}</span>

      {/*
        A dot for unsaved, and the close button beside it rather than instead of
        it. Editors that swap one for the other save a few pixels and cost you
        the ability to close a dirty file without first working out that the dot
        is a button.
      */}
      {buffer.dirty.value ? (
        <span class="zds-tabs__dirty" aria-hidden="true" />
      ) : null}

      <button
        type="button"
        class="zds-tabs__close"
        aria-label={`Close ${name}`}
        // Stopped here, or closing a tab would also select it — which is
        // visible when closing an inactive one.
        onClick={(event) => {
          event.stopPropagation()
          close()
        }}
      >
        <Icon name="close" size="small" />
      </button>
    </div>
  )
}

export function BufferTabs({ session }: { session: ProjectSession }) {
  const buffers = session.buffers.value
  const activeId = session.activeBuffer.value?.id ?? null
  const executingId = session.executingBuffer.value?.id ?? null

  /**
   * Arrow keys move the selection, not just the focus.
   *
   * The automatic-activation pattern, which is what a tab strip in an editor is
   * expected to do: arrowing through tabs shows each file as you pass it. The
   * alternative — move focus, press Enter — is for tablists where switching is
   * expensive, and switching a mounted view is not.
   */
  const onKeyDown = (event: KeyboardEvent) => {
    const step =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return

    const index = buffers.findIndex((buffer) => buffer.id === activeId)
    const next = buffers[index + step]
    if (!next) return

    event.preventDefault()
    session.setActiveBuffer(next.id)
  }

  return (
    <div
      class="zds-tabs"
      role="tablist"
      aria-label="Open files"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
    >
      {buffers.map((buffer) => (
        <BufferTab
          key={buffer.id}
          buffer={buffer}
          session={session}
          active={buffer.id === activeId}
          executing={buffer.id === executingId}
        />
      ))}
    </div>
  )
}
