import type { FormEvent, HTMLProps } from 'react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'react-hot-toast'
import { useHotkeys } from 'react-hotkeys-hook'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { ActionButton } from '@src/components/ActionButton'
import { AppHeader } from '@src/components/AppHeader'
import Loading from '@src/components/Loading'
import { LowerRightControls } from '@src/components/LowerRightControls'
import ProjectCard from '@src/components/ProjectCard/ProjectCard'
import {
  ProjectSearchBar,
  useProjectSearch,
} from '@src/components/ProjectSearchBar'
import { useCreateFileLinkQuery } from '@src/hooks/useCreateFileLinkQueryWatcher'
import { useMenuListener } from '@src/hooks/useMenu'
import { useProjectsContext } from '@src/hooks/useProjectsContext'
import { isDesktop } from '@src/lib/isDesktop'
import { PATHS } from '@src/lib/paths'
import { markOnce } from '@src/lib/performance'
import type { Project } from '@src/lib/project'
import { kclManager } from '@src/lib/singletons'
import {
  getNextSearchParams,
  getSortFunction,
  getSortIcon,
} from '@src/lib/sorting'
import { reportRejection } from '@src/lib/trap'
import { authActor, useSettings } from '@src/machines/appMachine'
import { commandBarActor } from '@src/machines/commandBarMachine'
import type { WebContentSendPayload } from '@src/menu/channels'

type ReadWriteProjectState = {
  value: boolean
  error: unknown
}

// This route only opens in the desktop context for now,
// as defined in Router.tsx, so we can use the desktop APIs and types.
const Home = () => {
  const { state, send } = useProjectsContext()
  const [readWriteProjectDir, setReadWriteProjectDir] =
    useState<ReadWriteProjectState>({
      value: true,
      error: undefined,
    })

  // Only create the native file menus on desktop
  useEffect(() => {
    if (isDesktop()) {
      window.electron.createHomePageMenu().catch(reportRejection)
    }
  }, [])

  // Keep a lookout for a URL query string that invokes the 'import file from URL' command
  useCreateFileLinkQuery((argDefaultValues) => {
    commandBarActor.send({
      type: 'Find and select command',
      data: {
        groupId: 'projects',
        name: 'Import file from URL',
        argDefaultValues,
      },
    })
  })

  const navigate = useNavigate()
  const settings = useSettings()

  // Menu listeners
  const cb = (data: WebContentSendPayload) => {
    if (data.menuLabel === 'File.New project') {
      commandBarActor.send({
        type: 'Find and select command',
        data: {
          groupId: 'projects',
          name: 'Create project',
          argDefaultValues: {
            name: settings.projects.defaultProjectName.current,
          },
        },
      })
    } else if (data.menuLabel === 'File.Open project') {
      commandBarActor.send({
        type: 'Find and select command',
        data: {
          groupId: 'projects',
          name: 'Open project',
        },
      })
    } else if (data.menuLabel === 'Edit.Rename project') {
      commandBarActor.send({
        type: 'Find and select command',
        data: {
          groupId: 'projects',
          name: 'Rename project',
        },
      })
    } else if (data.menuLabel === 'Edit.Delete project') {
      commandBarActor.send({
        type: 'Find and select command',
        data: {
          groupId: 'projects',
          name: 'Delete project',
        },
      })
    } else if (data.menuLabel === 'File.Import file from URL') {
      commandBarActor.send({
        type: 'Find and select command',
        data: {
          groupId: 'projects',
          name: 'Import file from URL',
        },
      })
    } else if (data.menuLabel === 'File.Preferences.User settings') {
      navigate(PATHS.HOME + PATHS.SETTINGS)
    } else if (data.menuLabel === 'File.Preferences.Keybindings') {
      navigate(PATHS.HOME + PATHS.SETTINGS_KEYBINDINGS)
    } else if (data.menuLabel === 'File.Preferences.User default units') {
      navigate(PATHS.HOME + PATHS.SETTINGS_USER + '#defaultUnit')
    } else if (data.menuLabel === 'Edit.Change project directory') {
      navigate(PATHS.HOME + PATHS.SETTINGS_USER + '#projectDirectory')
    } else if (data.menuLabel === 'File.Sign out') {
      authActor.send({ type: 'Log out' })
    } else if (
      data.menuLabel === 'View.Command Palette...' ||
      data.menuLabel === 'Help.Command Palette...'
    ) {
      commandBarActor.send({ type: 'Open' })
    } else if (data.menuLabel === 'File.Preferences.Theme') {
      commandBarActor.send({
        type: 'Find and select command',
        data: {
          groupId: 'settings',
          name: 'app.theme',
        },
      })
    } else if (data.menuLabel === 'File.Preferences.Theme color') {
      navigate(PATHS.HOME + PATHS.SETTINGS_USER + '#themeColor')
    }
  }
  useMenuListener(cb)

  // Cancel all KCL executions while on the home page
  useEffect(() => {
    markOnce('code/didLoadHome')
    kclManager.cancelAllExecutions()
  }, [])

  useHotkeys('backspace', (e) => {
    e.preventDefault()
  })
  useHotkeys(
    isDesktop() ? 'mod+,' : 'shift+mod+,',
    () => navigate(PATHS.HOME + PATHS.SETTINGS),
    {
      splitKey: '|',
    }
  )
  const ref = useRef<HTMLDivElement>(null)

  const projects = state?.context.projects ?? []
  const [searchParams, setSearchParams] = useSearchParams()
  const { searchResults, query, setQuery } = useProjectSearch(projects)
  const sort = searchParams.get('sort_by') ?? 'modified:desc'

  // Update the default project name and directory in the home machine
  // when the settings change
  useEffect(() => {
    send({
      type: 'assign',
      data: {
        defaultProjectName: settings.projects.defaultProjectName.current,
        defaultDirectory: settings.app.projectDirectory.current,
      },
    })

    // Must be a truthy string, not '' or null or undefined
    if (settings.app.projectDirectory.current) {
      window.electron
        .canReadWriteDirectory(settings.app.projectDirectory.current)
        .then((res) => {
          setReadWriteProjectDir(res)
        })
        .catch(reportRejection)
    }
  }, [
    settings.app.projectDirectory.current,
    settings.projects.defaultProjectName.current,
    send,
  ])

  return (
    <div className="relative flex flex-col h-screen overflow-hidden" ref={ref}>
      <AppHeader showToolbar={false} />
      <div className="overflow-hidden home-layout max-w-4xl xl:max-w-6xl mb-12 px-4 mx-auto mt-24 lg:px-0">
        <HomeHeader
          setQuery={setQuery}
          sort={sort}
          setSearchParams={setSearchParams}
          settings={settings}
          readWriteProjectDir={readWriteProjectDir}
          className="col-start-2 -col-end-1"
        />
        <aside className="row-start-2 -row-end-1 flex flex-col justify-between">
          <div className="flex flex-col">
            <ActionButton
              Element="button"
              onClick={() =>
                commandBarActor.send({
                  type: 'Find and select command',
                  data: {
                    groupId: 'projects',
                    name: 'Create project',
                    argDefaultValues: {
                      name: settings.projects.defaultProjectName.current,
                    },
                  },
                })
              }
              className="group !text-sm flex items-center !bg-primary !text-chalkboard-10 !border-primary hover:shadow-inner hover:hue-rotate-15"
              iconStart={{
                icon: 'plus',
                size: 'lg',
                bgClassName: '!bg-transparent rounded-sm',
                iconClassName:
                  '!text-chalkboard-10 transition-transform group-active:rotate-90',
              }}
              data-testid="home-new-file"
            >
              Create project
            </ActionButton>
          </div>
          <div className="flex flex-col"></div>
        </aside>
        <ProjectGrid
          state={state}
          send={send}
          searchResults={searchResults}
          projects={projects}
          query={query}
          sort={sort}
          className="flex-1 col-start-2 -col-end-1 overflow-y-auto pr-2 pb-24"
        />
        <LowerRightControls />
      </div>
    </div>
  )
}

interface HomeHeaderProps extends HTMLProps<HTMLDivElement> {
  setQuery: (query: string) => void
  sort: string
  setSearchParams: (params: Record<string, string>) => void
  settings: ReturnType<typeof useSettings>
  readWriteProjectDir: ReadWriteProjectState
}

function HomeHeader({
  setQuery,
  sort,
  setSearchParams,
  settings,
  readWriteProjectDir,
  ...rest
}: HomeHeaderProps) {
  const isSortByModified = sort?.includes('modified') || !sort || sort === null

  /** Type narrowing function of unknown error to a string */
  function errorMessage(error: unknown): string {
    if (error != undefined && error instanceof Error) {
      return error.message
    } else if (error && typeof error === 'object') {
      return JSON.stringify(error)
    } else if (typeof error === 'string') {
      return error
    } else {
      return 'Unknown error'
    }
  }

  return (
    <section {...rest}>
      <div className="flex justify-between items-center select-none">
        <div className="flex gap-8 items-center">
          <h1 className="text-3xl font-bold">Projects</h1>
        </div>
        <div className="flex gap-2 items-center">
          <ProjectSearchBar setQuery={setQuery} />
          <small>Sort by</small>
          <ActionButton
            Element="button"
            data-testid="home-sort-by-name"
            className={
              'text-xs border-primary/10 ' +
              (!sort.includes('name')
                ? 'text-chalkboard-80 dark:text-chalkboard-40'
                : '')
            }
            onClick={() => setSearchParams(getNextSearchParams(sort, 'name'))}
            iconStart={{
              icon: getSortIcon(sort, 'name'),
              bgClassName: 'bg-transparent',
              iconClassName: !sort.includes('name')
                ? '!text-chalkboard-90 dark:!text-chalkboard-30'
                : '',
            }}
          >
            Name
          </ActionButton>
          <ActionButton
            Element="button"
            data-testid="home-sort-by-modified"
            className={
              'text-xs border-primary/10 ' +
              (!isSortByModified
                ? 'text-chalkboard-80 dark:text-chalkboard-40'
                : '')
            }
            onClick={() =>
              setSearchParams(getNextSearchParams(sort, 'modified'))
            }
            iconStart={{
              icon: sort ? getSortIcon(sort, 'modified') : 'arrowDown',
              bgClassName: 'bg-transparent',
              iconClassName: !isSortByModified
                ? '!text-chalkboard-90 dark:!text-chalkboard-30'
                : '',
            }}
          >
            Last Modified
          </ActionButton>
        </div>
      </div>
      <p className="my-4 text-sm text-chalkboard-80 dark:text-chalkboard-30">
        Loaded from{' '}
        <Link
          data-testid="project-directory-settings-link"
          to={`${PATHS.HOME + PATHS.SETTINGS_USER}#projectDirectory`}
          className="text-chalkboard-90 dark:text-chalkboard-20 underline underline-offset-2"
        >
          {settings.app.projectDirectory.current}
        </Link>
        .
      </p>
      {!readWriteProjectDir.value && (
        <section>
          <div className="flex items-center select-none">
            <div className="flex gap-8 items-center justify-between grow bg-destroy-80 text-white py-1 px-4 my-2 rounded-sm">
              <p className="">{errorMessage(readWriteProjectDir.error)}</p>
              <Link
                data-testid="project-directory-settings-link"
                to={`${PATHS.HOME + PATHS.SETTINGS_USER}#projectDirectory`}
                className="py-1 text-white underline underline-offset-2 text-sm"
              >
                Change Project Directory
              </Link>
            </div>
          </div>
        </section>
      )}
    </section>
  )
}

interface ProjectGridProps extends HTMLProps<HTMLDivElement> {
  state: ReturnType<typeof useProjectsContext>['state']
  send: ReturnType<typeof useProjectsContext>['send']
  searchResults: Project[]
  projects: Project[]
  query: string
  sort: string
}

function ProjectGrid({
  state,
  send,
  searchResults,
  projects,
  query,
  sort,
  ...rest
}: ProjectGridProps) {
  async function handleRenameProject(
    e: FormEvent<HTMLFormElement>,
    project: Project
  ) {
    const { newProjectName } = Object.fromEntries(
      new FormData(e.target as HTMLFormElement)
    )

    if (typeof newProjectName === 'string' && newProjectName.startsWith('.')) {
      toast.error('Project names cannot start with a dot (.)')
      return
    }

    if (newProjectName !== project.name) {
      send({
        type: 'Rename project',
        data: { oldName: project.name, newName: newProjectName as string },
      })
    }
  }

  async function handleDeleteProject(project: Project) {
    send({
      type: 'Delete project',
      data: { name: project.name || '' },
    })
  }

  return (
    <section data-testid="home-section" {...rest}>
      {state?.matches('Reading projects') ? (
        <Loading>Loading your Projects...</Loading>
      ) : (
        <>
          {searchResults.length > 0 ? (
            <ul className="grid w-full md:grid-cols-2 xl:grid-cols-4 gap-4">
              {searchResults.sort(getSortFunction(sort)).map((project) => (
                <ProjectCard
                  key={project.name}
                  project={project}
                  handleRenameProject={handleRenameProject}
                  handleDeleteProject={handleDeleteProject}
                />
              ))}
            </ul>
          ) : (
            <p className="p-4 my-8 border border-dashed rounded border-chalkboard-30 dark:border-chalkboard-70">
              No Projects found
              {projects.length === 0
                ? ', ready to make your first one?'
                : ` with the search term "${query}"`}
            </p>
          )}
        </>
      )}
    </section>
  )
}

export default Home
