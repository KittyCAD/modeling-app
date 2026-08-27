import { useComputed, useSignal } from '@preact/signals'
import {
  Button,
  EmptyState,
  Icon,
  SheetCard,
  TextField,
} from '@kittycad/ui-kit'
import { useService } from '@src/app/context'
import { projectLibrariesService } from '@src/contracts/projectLibraries'
import { projectSessionService } from '@src/contracts/projectSession'
import { libraryIcon } from '@src/features/home/libraryIcon'
import { formatRelativeTime, matchesQuery } from '@src/lib/format'
import type { ProjectLibrary } from '@src/lib/projectLibraries'
import './home.css'

interface LibraryProjectsProps {
  library: ProjectLibrary
  /** Opens the library index. Always available, so libraries stay manageable. */
  onShowLibraries: () => void
}

/**
 * The projects in one library.
 *
 * The header names the library and where it actually is, because "where did
 * this project just get saved" is the question a multi-library setup makes
 * possible to get wrong.
 */
export function LibraryProjects({
  library,
  onShowLibraries,
}: LibraryProjectsProps) {
  const libraries = useService(projectLibrariesService)
  const sessions = useService(projectSessionService)

  const query = useSignal('')
  const renamingId = useSignal<string | null>(null)
  const renameDraft = useSignal('')

  const type = useComputed(() => libraries.type(library.type))
  const projects = useComputed(() => libraries.realizationsFor(library.id))
  const filtered = useComputed(() =>
    projects.value.filter((project) =>
      matchesQuery(project.title ?? project.name, query.value)
    )
  )
  const scanning = useComputed(
    () => libraries.state.value === 'scanning' && projects.value.length === 0
  )
  const failure = useComputed(() => libraries.error.value)

  const createProject = () => {
    void libraries.createProject(library.id, 'untitled').then((created) => {
      if (created) void sessions.open(created.id)
    })
  }

  return (
    <div class="zds-home__section">
      <header class="zds-home__header">
        <div class="zds-home__titles">
          <button
            type="button"
            class="zds-home__back"
            onClick={onShowLibraries}
          >
            <Icon name="arrowLeft" size="small" />
            <span>All libraries</span>
          </button>
          <h1 class="zds-display">{library.title}</h1>
          <p class="zds-home__library-meta">
            <Icon name={libraryIcon(library, type.value)} size="small" />
            <span class="zds-value">{library.path}</span>
          </p>
        </div>
        <div class="zds-home__actions">
          <TextField
            label="Filter projects"
            hideLabel
            type="search"
            icon="search"
            placeholder="Filter"
            value={query}
            onValueInput={(value) => {
              query.value = value
            }}
            class="zds-home__search"
          />
          <Button
            variant="primary"
            icon="plus"
            label="New project"
            onClick={createProject}
          />
        </div>
      </header>

      <hr class="zds-rule zds-home__rule" />

      {failure.value ? (
        <p class="zds-home__error" role="alert">
          {failure.value}
        </p>
      ) : null}

      {scanning.value ? (
        <EmptyState
          icon="refresh"
          eyebrow="Scanning"
          title="Looking for projects"
          description={`Reading ${library.path}`}
        />
      ) : projects.value.length === 0 ? (
        <EmptyState
          scale="page"
          icon="folder"
          eyebrow="Empty library"
          title="No projects in this library yet"
          description={`A project is a folder of KCL files in ${library.path}. Create one and it opens straight into the editor.`}
          actions={
            <Button
              variant="primary"
              icon="plus"
              label="New project"
              onClick={createProject}
            />
          }
        />
      ) : filtered.value.length === 0 ? (
        <EmptyState
          scale="page"
          icon="search"
          eyebrow="No matches"
          title={`Nothing matches “${query.value}”`}
          description="Clear the filter to see every project in this library."
          actions={
            <Button
              label="Clear filter"
              onClick={() => {
                query.value = ''
              }}
            />
          }
        />
      ) : (
        <ul class="zds-home__grid">
          {filtered.value.map((project) => {
            const moveTargets = libraries.moveTargetsFor(project.id)
            const isRenaming = renamingId.value === project.id

            return (
              <li key={project.id}>
                {isRenaming ? (
                  <div class="zds-home__rename">
                    <TextField
                      label="Project name"
                      hideLabel
                      value={renameDraft}
                      autofocus
                      onValueInput={(value) => {
                        renameDraft.value = value
                      }}
                      onSubmit={(value) => {
                        renamingId.value = null
                        void libraries.renameProject(project.id, value)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') renamingId.value = null
                      }}
                    />
                  </div>
                ) : (
                  <SheetCard
                    name={project.title ?? project.name}
                    fields={[
                      {
                        label: 'Edited',
                        value: formatRelativeTime(project.modifiedAt),
                      },
                      { label: 'KCL', value: String(project.kclFileCount) },
                      { label: 'Files', value: String(project.fileCount) },
                    ]}
                    onOpen={() => {
                      void sessions.open(project.id)
                    }}
                    actions={
                      <>
                        <Button
                          variant="ghost"
                          size="small"
                          iconOnly
                          icon="pencil"
                          label={`Rename ${project.name}`}
                          onClick={() => {
                            renameDraft.value = project.title ?? project.name
                            renamingId.value = project.id
                          }}
                        />
                        {moveTargets.length > 0 ? (
                          <Button
                            variant="ghost"
                            size="small"
                            iconOnly
                            icon="arrowUpRight"
                            label={`Move ${project.name} to ${moveTargets[0].title}`}
                            onClick={() => {
                              void libraries.moveProject(
                                project.id,
                                moveTargets[0].id
                              )
                            }}
                          />
                        ) : null}
                        <Button
                          variant="ghost"
                          size="small"
                          iconOnly
                          icon="trash"
                          label={`Delete ${project.name}`}
                          onClick={() => {
                            void libraries.deleteProject(project.id)
                          }}
                        />
                      </>
                    }
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
