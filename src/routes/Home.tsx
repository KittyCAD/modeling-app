import type { FormEvent, HTMLProps } from 'react'
import { useEffect, useRef } from 'react'
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
import { authActor, systemIOActor, useSettings } from '@src/lib/singletons'
import { commandBarActor } from '@src/lib/singletons'
import {
  useCanReadWriteProjectDirectory,
  useFolders,
  useState as useSystemIOState,
} from '@src/machines/systemIO/hooks'
import {
  SystemIOMachineEvents,
  SystemIOMachineStates,
} from '@src/machines/systemIO/utils'
import type { WebContentSendPayload } from '@src/menu/channels'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'

type ReadWriteProjectState = {
  value: boolean
  error: unknown
}

// This route only opens in the desktop context for now,
// as defined in Router.tsx, so we can use the desktop APIs and types.
const Home = () => {
  const readWriteProjectDir = useCanReadWriteProjectDirectory()

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
    if (data.menuLabel === 'File.Create project') {
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
      navigate(`${PATHS.HOME}${PATHS.SETTINGS_USER}#defaultUnit`)
    } else if (data.menuLabel === 'Edit.Change project directory') {
      navigate(`${PATHS.HOME}${PATHS.SETTINGS_USER}#projectDirectory`)
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
      navigate(`${PATHS.HOME}${PATHS.SETTINGS_USER}#themeColor`)
    } else if (data.menuLabel === 'File.Add file to project') {
      commandBarActor.send({
        type: 'Find and select command',
        data: {
          name: 'add-kcl-file-to-project',
          groupId: 'application',
        },
      })
    } else if (data.menuLabel === 'Design.Create with Zoo Text-To-CAD') {
      commandBarActor.send({
        type: 'Find and select command',
        data: {
          name: 'Text-to-CAD',
          groupId: 'application',
          argDefaultValues: {
            method: 'newProject',
            newProjectName: settings.projects.defaultProjectName.current,
          },
        },
      })
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
  const projects = useFolders()
  const [searchParams, setSearchParams] = useSearchParams()
  const { searchResults, query, setQuery } = useProjectSearch(projects)
  const sort = searchParams.get('sort_by') ?? 'modified:desc'
  const sidebarButtonClasses =
    'flex items-center p-2 gap-2 leading-tight border-transparent dark:border-transparent enabled:dark:border-transparent enabled:hover:border-primary/50 enabled:dark:hover:border-inherit active:border-primary dark:bg-transparent hover:bg-transparent'

  return (
    <div className="relative flex flex-col h-screen overflow-hidden" ref={ref}>
      <AppHeader showToolbar={false} />
      <div className="overflow-hidden home-layout max-w-4xl xl:max-w-7xl mb-12 px-4 mx-auto mt-24 lg:px-0">
        <HomeHeader
          setQuery={setQuery}
          sort={sort}
          setSearchParams={setSearchParams}
          settings={settings}
          readWriteProjectDir={readWriteProjectDir}
          className="col-start-2 -col-end-1"
        />
        <aside className="row-start-1 -row-end-1 flex flex-col justify-between">
          <ul className="flex flex-col">
            <li className="contents">
              <ActionButton
                Element="button"
                onClick={() =>
                  commandBarActor.send({
                    type: 'Find and select command',
                    data: {
                      groupId: 'projects',
                      name: 'Create project',
                    },
                  })
                }
                className={sidebarButtonClasses}
                iconStart={{
                  icon: 'plus',
                  bgClassName: '!bg-transparent rounded-sm',
                }}
                data-testid="home-new-file"
              >
                Create project
              </ActionButton>
            </li>
            <li className="contents">
              <ActionButton
                Element="button"
                onClick={() =>
                  commandBarActor.send({
                    type: 'Find and select command',
                    data: {
                      groupId: 'application',
                      name: 'Text-to-CAD',
                      argDefaultValues: {
                        method: 'newProject',
                        newProjectName:
                          settings.projects.defaultProjectName.current,
                      },
                    },
                  })
                }
                className={sidebarButtonClasses}
                iconStart={{
                  icon: 'sparkles',
                  bgClassName: '!bg-transparent rounded-sm',
                }}
                data-testid="home-text-to-cad"
              >
                Generate with Text-to-CAD
              </ActionButton>
            </li>
            <li className="contents">
              <ActionButton
                Element="button"
                onClick={() =>
                  commandBarActor.send({
                    type: 'Find and select command',
                    data: {
                      groupId: 'application',
                      name: 'add-kcl-file-to-project',
                      argDefaultValues: {
                        source: 'kcl-samples',
                        method: 'newProject',
                        newProjectName:
                          settings.projects.defaultProjectName.current,
                      },
                    },
                  })
                }
                className={sidebarButtonClasses}
                iconStart={{
                  icon: 'importFile',
                  bgClassName: '!bg-transparent rounded-sm',
                }}
                data-testid="home-create-from-sample"
              >
                Create from a sample
              </ActionButton>
            </li>
          </ul>
          <ul className="flex flex-col">
            <li className="contents">
              <ActionButton
                Element="externalLink"
                to="https://zoo.dev/docs"
                onClick={openExternalBrowserIfDesktop(
                  'https://zoo.dev/account'
                )}
                className={sidebarButtonClasses}
                iconStart={{
                  icon: 'person',
                  bgClassName: '!bg-transparent rounded-sm',
                }}
                data-testid="home-account"
              >
                View your account
              </ActionButton>
            </li>
            <li className="contents">
              <ActionButton
                Element="externalLink"
                to="https://zoo.dev/blog"
                onClick={openExternalBrowserIfDesktop('https://zoo.dev/blog')}
                className={sidebarButtonClasses}
                iconStart={{
                  icon: 'glasses',
                  bgClassName: '!bg-transparent rounded-sm',
                }}
                data-testid="home-blog"
              >
                Read the Zoo blog
              </ActionButton>
            </li>
          </ul>
        </aside>
        <ProjectGrid
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
            className={`text-xs border-primary/10 ${
              !sort.includes('name')
                ? 'text-chalkboard-80 dark:text-chalkboard-40'
                : ''
            }`}
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
            className={`text-xs border-primary/10 ${
              !isSortByModified
                ? 'text-chalkboard-80 dark:text-chalkboard-40'
                : ''
            }`}
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
  searchResults: Project[]
  projects: Project[]
  query: string
  sort: string
}

function ProjectGrid({
  searchResults,
  projects,
  query,
  sort,
  ...rest
}: ProjectGridProps) {
  const state = useSystemIOState()

  return (
    <section data-testid="home-section" {...rest}>
      {state.matches(SystemIOMachineStates.readingFolders) ? (
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
              No projects found
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

/** Type narrowing function of unknown error to a string */
function errorMessage(error: unknown): string {
  if (error !== undefined && error instanceof Error) {
    return error.message
  }
  if (error && typeof error === 'object') {
    return JSON.stringify(error)
  }
  if (typeof error === 'string') {
    return error
  }
  return 'Unknown error'
}

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
    systemIOActor.send({
      type: SystemIOMachineEvents.renameProject,
      data: {
        requestedProjectName: String(newProjectName),
        projectName: project.name,
      },
    })
  }
}

async function handleDeleteProject(project: Project) {
  systemIOActor.send({
    type: SystemIOMachineEvents.deleteProject,
    data: { requestedProjectName: project.name },
  })
}

export default Home
