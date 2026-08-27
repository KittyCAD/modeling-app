import { useComputed } from '@preact/signals'
import { Button, EmptyState, Icon, Spinner } from '@kittycad/ui-kit'
import { useService } from '@src/app/context'
import type { ProjectFile } from '@src/contracts/projects'
import { projectSessionService } from '@src/contracts/projectSession'
import '../project.css'

const iconFor = (file: ProjectFile) => {
  if (file.kind === 'directory') return 'folder' as const
  if (file.name.endsWith('.kcl')) return 'fileCode' as const
  return 'file' as const
}

interface FileRowProps {
  file: ProjectFile
  depth: number
  activePath: string | null
  onOpen: (path: string) => void
}

function FileRow({ file, depth, activePath, onOpen }: FileRowProps) {
  if (file.kind === 'directory') {
    return (
      <li>
        {/* Directories are labels, not controls: there is nothing to open. A
            collapse affordance arrives with nesting deep enough to need it. */}
        <div
          class="zds-tree__row zds-tree__row--directory"
          style={{ '--zds-tree-depth': String(depth) }}
        >
          <Icon name="folder" size="small" />
          <span class="zds-tree__name">{file.name}</span>
        </div>
        <ul>
          {(file.children ?? []).map((child) => (
            <FileRow
              key={child.path}
              file={child}
              depth={depth + 1}
              activePath={activePath}
              onOpen={onOpen}
            />
          ))}
        </ul>
      </li>
    )
  }

  const isActive = activePath === file.path

  return (
    <li>
      <button
        type="button"
        class="zds-tree__row"
        style={{ '--zds-tree-depth': String(depth) }}
        aria-current={isActive ? 'true' : undefined}
        onClick={() => onOpen(file.path)}
      >
        <Icon name={iconFor(file)} size="small" />
        <span class="zds-tree__name">{file.name}</span>
      </button>
    </li>
  )
}

/**
 * The project's files.
 *
 * Selecting a file opens a buffer for viewing. It deliberately does not change
 * what the engine is executing — that is a separate, explicit choice, so you
 * can read one file while another drives the model.
 */
export function FileExplorer() {
  const sessions = useService(projectSessionService)

  const session = useComputed(() => sessions.current.value)
  const files = useComputed(() => session.value?.files.value ?? [])
  const state = useComputed(() => session.value?.filesState.value ?? 'loading')
  const activePath = useComputed(
    () => session.value?.activeBuffer.value?.path.value ?? null
  )

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

  if (files.value.length === 0) {
    return (
      <EmptyState
        icon="file"
        eyebrow="Files"
        title="No files in this project"
        description="Add a .kcl file to start modeling."
      />
    )
  }

  return (
    <ul class="zds-tree">
      {files.value.map((file) => (
        <FileRow
          key={file.path}
          file={file}
          depth={0}
          activePath={activePath.value}
          onOpen={(path) => void session.value?.openFile(path)}
        />
      ))}
    </ul>
  )
}
