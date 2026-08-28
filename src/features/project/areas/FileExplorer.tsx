import {
  Button,
  ContextMenu,
  type ContextMenuTargetProps,
  EmptyState,
  Icon,
  Spinner,
  TextField,
} from '@kittycad/ui-kit'
import { useComputed, useSignalEffect } from '@preact/signals'
import { useService, useValueSpec } from '@src/app/context'
import { commandService } from '@src/contracts/commands'
import { fileExplorerContextMenuItemsValueSpec } from '@src/contracts/fileExplorer'
import { keybindingService } from '@src/contracts/keybindings'
import type { ProjectSession } from '@src/contracts/projectSession'
import { projectSessionService } from '@src/contracts/projectSession'
import type { ProjectFile } from '@src/contracts/projects'
import {
  cancelDelete,
  cancelDraft,
  collapseAll,
  confirmDelete,
  type Draft,
  directoryFor,
  draft,
  expandedPaths,
  namesIn,
  pendingDelete,
  requestDelete,
  selectedPath,
  startCreate,
  startRename,
  submitDraft,
  syncProject,
  toggleExpanded,
  updateDraft,
} from '@src/features/project/areas/fileExplorerState'
import { resolveContextMenu } from '@src/lib/contextMenu'
import type { ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import '../project.css'

/** Active while the file tree has focus, so F2 and Delete mean what they say. */
export const PROJECT_EXPLORER_SCOPE = 'projectExplorer.focused'

const iconFor = (file: ProjectFile) => {
  if (file.kind === 'directory') return 'folder' as const
  if (file.name.endsWith('.kcl')) return 'fileCode' as const
  return 'file' as const
}

/**
 * The panel's own actions, rendered in its heading strip.
 *
 * Up here rather than on each row because they act on the tree rather than on
 * anything in it: a new file goes into whatever is selected, or into the root
 * when nothing is.
 */
export function FileExplorerActions() {
  const sessions = useService(projectSessionService)
  const files = useComputed(() => sessions.current.value?.files.value ?? [])

  const create = (mode: 'file' | 'directory') => {
    const directory = directoryFor(files.value, selectedPath.value)
    startCreate(mode, directory, namesIn(files.value, directory))
  }

  return (
    <>
      <Button
        variant="ghost"
        size="small"
        iconOnly
        icon="filePlus"
        label="New file"
        onClick={() => create('file')}
      />
      <Button
        variant="ghost"
        size="small"
        iconOnly
        icon="folderPlus"
        label="New folder"
        onClick={() => create('directory')}
      />
      <Button
        variant="ghost"
        size="small"
        iconOnly
        icon="collapse"
        label="Collapse folders"
        onClick={collapseAll}
      />
      <Button
        variant="ghost"
        size="small"
        iconOnly
        icon="refresh"
        label="Refresh files"
        onClick={() => void sessions.current.value?.refreshFiles()}
      />
    </>
  )
}

/**
 * A name being typed, for a new entry or a rename.
 *
 * The same row for all three, because they are the same act: the difference is
 * only where the name lands, and that is already decided by the time this is on
 * screen.
 */
function DraftRow({
  state,
  depth,
  session,
}: {
  state: Draft
  depth: number
  session: ProjectSession | null
}) {
  const input = useRef<HTMLInputElement>(null)

  /**
   * Select the name, not just focus it.
   *
   * The field opens with a name already in it, so the first keystroke should
   * replace it — and for a rename the stem is selected without the extension,
   * because renaming `bracket.kcl` almost never means changing `.kcl`.
   *
   * On mount only, which is why every draft row is keyed by what it is drafting:
   * going from a new file to a rename is a different row, not the same one with
   * different text.
   */
  useEffect(() => {
    const element = input.current
    if (!element) return

    element.focus()
    const name = state.value
    const dot = name.lastIndexOf('.')
    element.setSelectionRange(0, dot > 0 ? dot : name.length)
    // biome-ignore lint/correctness/useExhaustiveDependencies: mount only; the
    // row is keyed, so a different draft is a different row.
  }, [])

  return (
    <li class="zds-tree__draft" style={{ '--zds-tree-depth': String(depth) }}>
      <div class="zds-tree__draft-field">
        <Icon
          name={state.mode === 'directory' ? 'folderPlus' : 'filePlus'}
          size="small"
        />
        <TextField
          label={
            state.mode === 'rename'
              ? 'New name'
              : `Name of the new ${state.mode}`
          }
          hideLabel
          size="small"
          value={state.value}
          disabled={state.busy}
          inputRef={input}
          onValueInput={updateDraft}
          onSubmit={() => session && void submitDraft(session)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              // Stopped as well, or the dialog or panel above would also read
              // this Escape and close on top of the cancel.
              event.stopPropagation()
              cancelDraft()
            }
          }}
          // Clicking elsewhere abandons it, which is what a click elsewhere
          // means everywhere else in the app.
          onBlur={() => {
            if (!draft.peek()?.busy) cancelDraft()
          }}
        />
      </div>
      {state.error ? (
        <p class="zds-tree__error" role="alert">
          {state.error}
        </p>
      ) : null}
    </li>
  )
}

function RowActions({
  file,
  files,
}: {
  file: ProjectFile
  files: readonly ProjectFile[]
}) {
  return (
    <span class="zds-tree__actions">
      {file.kind === 'directory' ? (
        <>
          <Button
            variant="ghost"
            size="small"
            iconOnly
            icon="filePlus"
            label={`New file in ${file.name}`}
            onClick={(event) => {
              event.stopPropagation()
              startCreate('file', file.path, namesIn(files, file.path))
            }}
          />
          <Button
            variant="ghost"
            size="small"
            iconOnly
            icon="folderPlus"
            label={`New folder in ${file.name}`}
            onClick={(event) => {
              event.stopPropagation()
              startCreate('directory', file.path, namesIn(files, file.path))
            }}
          />
        </>
      ) : null}
      <Button
        variant="ghost"
        size="small"
        iconOnly
        icon="pencil"
        label={`Rename ${file.name}`}
        onClick={(event) => {
          event.stopPropagation()
          startRename(file.path)
        }}
      />
      <Button
        variant="ghost"
        size="small"
        iconOnly
        icon="trash"
        label={`Delete ${file.name}`}
        onClick={(event) => {
          event.stopPropagation()
          requestDelete(file.path)
        }}
      />
    </span>
  )
}

/**
 * The confirmation, in the row rather than over it.
 *
 * A dialog for this would cover the tree at the moment you want to check what
 * else is in there. The removal goes to the OS trash where there is one, which
 * is what makes a single confirmation enough.
 */
function DeleteRow({
  file,
  depth,
  session,
}: {
  file: ProjectFile
  depth: number
  session: ProjectSession | null
}) {
  const state = pendingDelete.value

  return (
    <li
      class="zds-tree__confirm"
      style={{ '--zds-tree-depth': String(depth) }}
      role="alert"
    >
      <span class="zds-tree__confirm-text">
        Delete <span class="zds-value">{file.name}</span>
        {file.kind === 'directory' ? ' and everything in it' : ''}?
      </span>
      <Button
        size="small"
        label="Cancel"
        disabled={state?.busy ?? false}
        onClick={cancelDelete}
      />
      <Button
        size="small"
        variant="danger"
        label="Delete"
        disabled={state?.busy ?? false}
        onClick={() => session && void confirmDelete(session)}
      />
      {state?.error ? <p class="zds-tree__error">{state.error}</p> : null}
    </li>
  )
}

function FileRow({
  file,
  depth,
  files,
  session,
  activePath,
}: {
  file: ProjectFile
  depth: number
  files: readonly ProjectFile[]
  session: ProjectSession | null
  activePath: string | null
}) {
  const editing = draft.value
  const deleting = pendingDelete.value

  if (editing?.mode === 'rename' && editing.target === file.path) {
    return (
      <DraftRow
        key={`${editing.mode}:${editing.target}`}
        state={editing}
        depth={depth}
        session={session}
      />
    )
  }

  if (deleting?.path === file.path) {
    return <DeleteRow file={file} depth={depth} session={session} />
  }

  const isSelected = selectedPath.value === file.path
  const isActive = activePath === file.path

  if (file.kind === 'directory') {
    const isOpen = expandedPaths.value.has(file.path)

    return (
      <li>
        <FileRowContextMenu
          file={file}
          session={session}
          render={(contextMenu) => (
            <div class="zds-tree__line">
              <button
                type="button"
                class="zds-tree__row zds-tree__row--directory"
                style={{ '--zds-tree-depth': String(depth) }}
                aria-expanded={isOpen}
                aria-haspopup={contextMenu['aria-haspopup']}
                data-selected={isSelected ? 'true' : undefined}
                onContextMenu={contextMenu.onContextMenu}
                onClick={() => {
                  selectedPath.value = file.path
                  toggleExpanded(file.path)
                }}
              >
                <Icon
                  name={isOpen ? 'chevronDown' : 'chevronRight'}
                  size="small"
                  class="zds-tree__twisty"
                />
                <Icon name="folder" size="small" />
                <span class="zds-tree__name">{file.name}</span>
              </button>
              <RowActions file={file} files={files} />
            </div>
          )}
        />

        {isOpen ? (
          <Children
            files={file.children ?? []}
            parent={file.path}
            depth={depth + 1}
            root={files}
            session={session}
            activePath={activePath}
          />
        ) : null}
      </li>
    )
  }

  return (
    <li>
      <FileRowContextMenu
        file={file}
        session={session}
        render={(contextMenu) => (
          <div class="zds-tree__line">
            <button
              type="button"
              class="zds-tree__row"
              style={{ '--zds-tree-depth': String(depth) }}
              aria-current={isActive ? 'true' : undefined}
              aria-haspopup={contextMenu['aria-haspopup']}
              data-selected={isSelected ? 'true' : undefined}
              onContextMenu={contextMenu.onContextMenu}
              onClick={() => {
                selectedPath.value = file.path
                void session?.openFile(file.path)
              }}
            >
              <Icon name={iconFor(file)} size="small" />
              <span class="zds-tree__name">{file.name}</span>
            </button>
            <RowActions file={file} files={files} />
          </div>
        )}
      />
    </li>
  )
}

/** A row supplies the context; the ui-kit only owns opening and positioning. */
function FileRowContextMenu({
  file,
  session,
  render,
}: {
  file: ProjectFile
  session: ProjectSession | null
  render: (props: ContextMenuTargetProps) => ComponentChildren
}) {
  const contributions = useValueSpec(fileExplorerContextMenuItemsValueSpec)
  const commands = useService(commandService)

  return (
    <ContextMenu
      label={`Actions for ${file.name}`}
      sections={() => {
        if (!session) return []
        return resolveContextMenu(
          contributions.value,
          { entry: file, session },
          commands
        )
      }}
      target={(props) =>
        render({
          ...props,
          onContextMenu: (event) => {
            // Commands without arguments act on the tree selection. A context
            // click names that selection before resolving their availability.
            selectedPath.value = file.path
            props.onContextMenu(event)
          },
        })
      }
    />
  )
}

/**
 * One directory's contents, with a draft row when the new entry belongs here.
 *
 * The draft is placed by the tree rather than injected into the file list. A
 * fake entry would have to be filtered back out of everything that reads the
 * files — the tabs, the URL, the executing buffer — and one of them would
 * eventually forget.
 */
function Children({
  files,
  parent,
  depth,
  root,
  session,
  activePath,
}: {
  files: readonly ProjectFile[]
  parent: string
  depth: number
  root: readonly ProjectFile[]
  session: ProjectSession | null
  activePath: string | null
}) {
  const editing = draft.value
  const drafting =
    editing && editing.mode !== 'rename' && editing.target === parent

  return (
    <ul class={depth === 0 ? 'zds-tree' : undefined}>
      {drafting && editing ? (
        <DraftRow
          key={`${editing.mode}:${editing.target}`}
          state={editing}
          depth={depth}
          session={session}
        />
      ) : null}
      {files.map((file) => (
        <FileRow
          key={file.path}
          file={file}
          depth={depth}
          files={root}
          session={session}
          activePath={activePath}
        />
      ))}
    </ul>
  )
}

/**
 * The project's files.
 *
 * Selecting a file opens a buffer for viewing. It deliberately does not change
 * what the engine is executing — that is a separate, explicit choice, so you
 * can read one file while another drives the model.
 *
 * Creating, renaming and deleting are the session's operations, not this
 * component's: they move buffers and touch the filesystem, and this only decides
 * where a name is typed. What it does own is the tree's own state — which folders
 * are open, which row is selected, what is being typed — which lives beside it in
 * `fileExplorerState`.
 */
export function FileExplorer() {
  const sessions = useService(projectSessionService)

  const session = useComputed(() => sessions.current.value)
  const files = useComputed(() => session.value?.files.value ?? [])
  const state = useComputed(() => session.value?.filesState.value ?? 'loading')
  const activePath = useComputed(
    () => session.value?.activeBufferPath.value ?? null
  )

  // A different project is a different tree: nothing about which folders were
  // open or what was selected carries over. Mounting is not such a change —
  // the panel unmounts whenever it is toggled shut.
  const projectId = useComputed(() => session.value?.project.value.id ?? null)
  useSignalEffect(() => {
    syncProject(projectId.value)
  })

  if (state.value === 'loading') {
    return (
      <div class="zds-tree__status">
        <Spinner label="Loading files" size="small" />
      </div>
    )
  }

  if (state.value === 'error') {
    return (
      <EmptyState
        icon="warning"
        eyebrow="Files"
        title="Could not read this project"
        description="The project's files could not be listed. Refreshing may be enough."
        actions={
          <Button
            size="small"
            icon="refresh"
            label="Refresh"
            onClick={() => void session.value?.refreshFiles()}
          />
        }
      />
    )
  }

  const editing = draft.value
  const draftingAtRoot = editing && editing.mode !== 'rename' && !editing.target

  if (files.value.length === 0 && !draftingAtRoot) {
    return (
      <EmptyState
        icon="file"
        eyebrow="Files"
        title="No files in this project"
        description="Add a .kcl file to start modeling."
        actions={
          <Button
            size="small"
            icon="filePlus"
            label="New file"
            onClick={() => startCreate('file', '', [])}
          />
        }
      />
    )
  }

  return (
    <TreeRoot>
      <Children
        files={files.value}
        parent=""
        depth={0}
        root={files.value}
        session={session.value}
        activePath={activePath.value}
      />
    </TreeRoot>
  )
}

/**
 * Holds the explorer's keymap scope while anything inside has focus.
 *
 * `focusin` and `focusout` rather than `focus` and `blur`, because only the
 * former pair bubbles — the focus lands on a row's button, not on this element.
 * Moving between two rows fires both, which is harmless: the scope is a set, so
 * removing and re-adding it in one tick is not observable to a keystroke.
 */
function TreeRoot({ children }: { children: ComponentChildren }) {
  const keys = useService(keybindingService)
  const scope = keys.focusScope(PROJECT_EXPLORER_SCOPE)

  /*
   * Drop the scope on the way out.
   *
   * Removing a focused element does not reliably fire `focusout`, and toggling
   * the panel shut with a row focused does exactly that — leaving `Delete` live
   * everywhere with no tree on screen to explain it.
   */
  useEffect(() => () => keys.removeScope(PROJECT_EXPLORER_SCOPE), [keys])

  return (
    <div
      class="zds-tree-root"
      onFocusIn={scope.onFocus}
      onFocusOut={scope.onBlur}
    >
      {children}
    </div>
  )
}
