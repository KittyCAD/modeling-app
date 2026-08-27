import { useComputed, useSignal } from '@preact/signals'
import {
  Button,
  EmptyState,
  SheetCard,
  Spinner,
  TextField,
} from '@kittycad/ui-kit'
import { useService } from '@src/app/context'
import { commandService } from '@src/contracts/commands'
import { projectCatalogService } from '@src/contracts/projects'
import { projectSessionService } from '@src/contracts/projectSession'
import {
  formatRelativeTime,
  formatRevision,
  matchesQuery,
} from '@src/lib/format'
import './home.css'

/**
 * The sheet index.
 *
 * Projects are laid out as drawing sheets, and the screen is titled like a
 * drawing set rather than a dashboard: an eyebrow, a ruled line, then the
 * sheets. No hero, no stat tiles — the content is the list, and the list is
 * what someone came here to act on.
 */
export function HomeScreen() {
  const catalog = useService(projectCatalogService)
  const session = useService(projectSessionService)
  const commands = useService(commandService)

  const query = useSignal('')

  const projects = useComputed(() => catalog.projects.value)
  const filtered = useComputed(() =>
    projects.value.filter((project) => matchesQuery(project.name, query.value))
  )
  const isLoading = useComputed(
    () => catalog.state.value === 'loading' && projects.value.length === 0
  )
  const openError = useComputed(() => session.error.value)

  return (
    <div class="zds-home zds-scroll">
      <div class="zds-home__inner">
        <header class="zds-home__header">
          <div class="zds-home__titles">
            <p class="zds-label">Projects</p>
            <h1 class="zds-display">Open a project</h1>
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
              onClick={() => commands.run('project.new')}
            />
          </div>
        </header>

        <hr class="zds-rule zds-home__rule" />

        {openError.value ? (
          <p class="zds-home__error" role="alert">
            {openError.value}
          </p>
        ) : null}

        {isLoading.value ? (
          <div class="zds-home__loading">
            <Spinner label="Loading projects" />
            <p class="zds-body-secondary">Looking for projects</p>
          </div>
        ) : projects.value.length === 0 ? (
          <EmptyState
            scale="page"
            icon="folder"
            eyebrow="No projects"
            title="Nothing here yet"
            description="A project is a folder of KCL files. Create one and it opens straight into the editor."
            actions={
              <Button
                variant="primary"
                icon="plus"
                label="New project"
                onClick={() => commands.run('project.new')}
              />
            }
          />
        ) : filtered.value.length === 0 ? (
          <EmptyState
            scale="page"
            icon="search"
            eyebrow="No matches"
            title={`Nothing matches “${query.value}”`}
            description="Clear the filter to see every project."
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
            {filtered.value.map((project) => (
              <li key={project.id}>
                <SheetCard
                  name={project.name}
                  fields={[
                    { label: 'Rev', value: formatRevision(project.revision) },
                    {
                      label: 'Edited',
                      value: formatRelativeTime(project.modifiedAt),
                    },
                    { label: 'Files', value: String(project.fileCount) },
                  ]}
                  onOpen={() => {
                    void session.open(project.id)
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
