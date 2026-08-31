import { useComputed } from '@preact/signals'
import { type IconName, Menu } from '@kittycad/ui-kit'
import { useService } from '@src/app/context'
import {
  type ProjectSessionService,
  projectSessionService,
} from '@src/contracts/projectSession'
import { kclFileChoices } from '@src/features/shell/kclFileChoices'
import './shell.css'

/**
 * The files this project can execute, as a menu on the file crumb.
 *
 * Clicking a file makes it both visible and executing. Those are separate
 * things — deliberately, everywhere else — but a chooser that changed what runs
 * without showing it would be a control with an invisible effect, and one that
 * showed a file without running it would not be the control that was asked for.
 *
 * A flat chooser rather than the explorer panel. Every file is one click away
 * with no folder to open first, and the explorer's own create-rename-delete
 * affordances stay where they belong.
 */
export function FileMenu({ session }: { session: ProjectSessionService }) {
  const executingPath = useComputed(() => {
    const current = session.current.value
    const buffer = current?.executingBuffer.value
    return buffer && current ? current.relativePathFor(buffer) : null
  })
  const groups = useComputed(() =>
    kclFileChoices(session.current.value?.files.value ?? [])
  )
  const filesState = useComputed(
    () => session.current.value?.filesState.value ?? 'loading'
  )

  const choose = async (path: string) => {
    const current = session.current.value
    if (!current) return

    const buffer = await current.openFile(path)
    // Opening a KCL file adopts it only when nothing is executing yet, so the
    // second choice needs saying out loud.
    current.setExecutingBuffer(buffer.id)
  }

  /*
   * An empty list means different things while loading, after a failure, and in
   * a project that really has no KCL — and "no KCL files" is the wrong claim for
   * the first two, since it describes the project rather than the attempt.
   */
  const nothingToShow = () => {
    if (filesState.value === 'loading') return 'Reading the project…'
    if (filesState.value === 'error') return 'Could not read the project'
    return 'No KCL files in this project'
  }

  const sections =
    groups.value.length === 0
      ? [
          {
            id: 'empty',
            items: [{ id: 'none', label: nothingToShow(), disabled: true }],
          },
        ]
      : groups.value.map((group) => ({
          id: group.directory || 'root',
          label: group.directory || undefined,
          items: group.files.map((file) => ({
            id: file.path,
            label: file.name,
            // The executing file is marked rather than disabled: clicking it is
            // a reasonable way to bring it back on screen.
            icon: (file.path === executingPath.value
              ? 'play'
              : 'fileCode') as IconName,
            onSelect: () => {
              void choose(file.path).catch((error) => {
                // A file that vanished between the listing and the click. The
                // explorer reports the project as it is on the next refresh.
                console.warn(`shell: could not open ${file.path}`, error)
              })
            },
          })),
        }))

  return (
    <Menu
      label="Choose the file to execute"
      align="start"
      sections={sections}
      trigger={({ open, toggle, ref }) => (
        <button
          type="button"
          ref={ref}
          class="zds-crumbs__file"
          aria-expanded={open}
          onClick={toggle}
        >
          {/*
            The *executing* file, not the one on screen.
            It showed the active buffer, which made this the only part of the
            control that meant something else: its label says "choose the file to
            execute", its list marks the executing one, and choosing sets it. And
            now that the code pane has tabs, which file you are reading is
            answered there — so the top bar is free to answer the question only it
            can, which is what the model is being built from.

            The path rather than the name, because two folders can hold a
            `main.kcl` and this is the one place that has to be unambiguous.
          */}
          {executingPath.value ?? 'Choose a file'}
        </button>
      )}
    />
  )
}

/**
 * What is open, in mono, project then file.
 *
 * The project is a readout — the only action on it goes home, because that is
 * the only place "up" can mean here. The file is a chooser, since "which file"
 * is a question the top bar is already answering and the answer is changeable.
 */
export function Crumbs() {
  const session = useService(projectSessionService)

  const project = useComputed(
    () => session.current.value?.project.value ?? null
  )
  const buffer = useComputed(
    () => session.current.value?.activeBuffer.value ?? null
  )

  if (!project.value) return null

  return (
    <nav class="zds-crumbs" aria-label="Open project">
      <span class="zds-crumbs__project">
        {project.value.title ?? project.value.name}
      </span>
      <span class="zds-crumbs__separator" aria-hidden="true">
        /
      </span>
      <FileMenu session={session} />
      {buffer.value?.dirty.value ? (
        <span class="zds-crumbs__dirty" title="Unsaved changes">
          ●
        </span>
      ) : null}
    </nav>
  )
}
