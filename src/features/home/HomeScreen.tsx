import { type Signal, useComputed } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { Button, EmptyState } from '@kittycad/ui-kit'
import { useService } from '@src/app/context'
import { projectLibrariesService } from '@src/contracts/projectLibraries'
import { projectSessionService } from '@src/contracts/projectSession'
import { HomeSidebar } from '@src/features/home/HomeSidebar'
import { AddLibraryControl, LibraryList } from '@src/features/home/LibraryList'
import { LibraryProjects } from '@src/features/home/LibraryProjects'
import { type HomeView, resolveHomeLibrary } from '@src/features/home/homeView'
import './home.css'

interface HomeScreenProps {
  /**
   * What Home is showing, owned by the home feature so the URL can be derived
   * from it rather than driving it.
   */
  view: Signal<HomeView>
}

/**
 * Home: libraries, and the projects in one of them.
 *
 * With one library it shows that library's projects directly; the index only
 * appears once there is a choice to make. Selecting a library is application
 * state, and the route is derived from it — nothing here navigates.
 */
export function HomeScreen({ view }: HomeScreenProps) {
  const libraries = useService(projectLibrariesService)
  const sessions = useService(projectSessionService)

  const all = useComputed(() => libraries.libraries.value)
  const openError = useComputed(() => sessions.error.value)

  const selected = useComputed(() => resolveHomeLibrary(view.value, all.value))

  // Scan when the set of libraries changes, not on every render. Their ids
  // already encode path and type, so this key changes exactly when a rescan is
  // actually warranted.
  const libraryKey = useComputed(() =>
    all.value.map((library) => library.id).join('|')
  )

  useEffect(() => {
    if (libraryKey.value) void libraries.refresh()
  }, [libraryKey.value, libraries])

  if (all.value.length === 0) {
    return (
      <div class="zds-home zds-scroll">
        <div class="zds-home__inner">
          <EmptyState
            scale="page"
            icon="folder"
            eyebrow="No libraries"
            title="Nowhere to keep projects yet"
            description="A library is a folder that holds your projects. Add one to get started."
            actions={<AddLibraryControl />}
          />
        </div>
      </div>
    )
  }

  return (
    <div class="zds-home zds-scroll">
      <div class="zds-home__inner zds-home__inner--columns">
        <HomeSidebar />

        <div class="zds-home__body">
          {openError.value ? (
            <p class="zds-home__error" role="alert">
              {openError.value}
            </p>
          ) : null}

          {selected.value ? (
            <LibraryProjects
              library={selected.value}
              // Always offered, so managing libraries stays reachable even for
              // someone who only has one.
              onShowLibraries={() => {
                view.value = { kind: 'index' }
              }}
            />
          ) : (
            <div class="zds-home__section">
              <header class="zds-home__header">
                <div class="zds-home__titles">
                  <p class="zds-label">Libraries</p>
                  <h1 class="zds-display">Where your projects live</h1>
                </div>
                <div class="zds-home__actions">
                  <AddLibraryControl />
                </div>
              </header>

              <hr class="zds-rule zds-home__rule" />

              <LibraryList
                onSelect={(library) => {
                  view.value = { kind: 'library', libraryId: library.id }
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Shown in the top bar while Home is up, so refreshing is always reachable. */
export function HomeRefreshButton() {
  const libraries = useService(projectLibrariesService)

  return (
    <Button
      variant="chassis"
      icon="refresh"
      label="Refresh libraries"
      iconOnly
      onClick={() => {
        void libraries.refresh()
      }}
    />
  )
}
