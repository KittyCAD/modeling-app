import { effect as createSignalEffect } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import type { Dispatch, FormEvent, HTMLProps, SetStateAction } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'react-hot-toast'
import { useHotkeys } from 'react-hotkeys-hook'
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom'

import { BillingDialog } from '@kittycad/ui-components'
import { ActionButton } from '@src/components/ActionButton'
import { Announcements } from '@src/components/Announcements'
import { AppHeader } from '@src/components/AppHeader'
import Loading from '@src/components/Loading'
import { useNetworkMachineStatus } from '@src/components/NetworkMachineIndicator'
import ProjectCard from '@src/components/ProjectCard/ProjectCard'
import {
  ProjectSearchBar,
  useProjectSearch,
} from '@src/components/ProjectSearchBar'
import { StatusBar } from '@src/components/StatusBar/StatusBar'
import {
  defaultGlobalStatusBarItems,
  defaultLocalStatusBarItems,
} from '@src/components/StatusBar/defaultStatusBarItems'
import Tooltip from '@src/components/Tooltip'
import { useAbsoluteFilePath } from '@src/hooks/useAbsoluteFilePath'
import { useMenuListener } from '@src/hooks/useMenu'
import {
  type ProjectStatus,
  useProjectStatuses,
} from '@src/hooks/useProjectStatus'
import { useQueryParamEffects } from '@src/hooks/useQueryParamEffects'
import {
  autoUpdateDownloadProgressSignal,
  autoUpdateReadySignal,
} from '@src/lib/autoUpdate'
import { useApp, useSingletons } from '@src/lib/boot'
import { cloudSyncStatus, setCloudSyncProjectScope } from '@src/lib/cloudSync'
import { createRouteCommands } from '@src/lib/commandBarConfigs/routeCommandConfig'
import { isDesktop } from '@src/lib/isDesktop'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import {
  type OptimisticProjectRenames,
  applyOptimisticProjectRenames,
  pruneSettledOptimisticProjectRenames,
} from '@src/lib/optimisticProjectRenames'
import { PATHS } from '@src/lib/paths'
import { markOnce } from '@src/lib/performance'
import type { Project } from '@src/lib/project'
import { getProjectDisplayName } from '@src/lib/projectDisplayName'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import {
  getNextSearchParams,
  getSortFunction,
  getSortIcon,
} from '@src/lib/sorting'
import { reportRejection } from '@src/lib/trap'
import { platform } from '@src/lib/utils'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import { BillingTransition } from '@src/machines/billingMachine'
import {
  useCanReadWriteProjectDirectory,
  useFolders,
  useState as useSystemIOState,
} from '@src/machines/systemIO/hooks'
import type { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import {
  SystemIOMachineEvents,
  SystemIOMachineStates,
} from '@src/machines/systemIO/utils'
import type { WebContentSendPayload } from '@src/menu/channels'
import {
  HOME_KEYMAP_SCOPE,
  findKeymapItemForCommand,
  keymapKeystrokesDisplay,
  keymapScopesValueSpec,
  keymapService,
} from '@src/registry/contracts/keymap'
import {
  filterStatusBarItemsForScopes,
  statusBarGlobalItemsValueSpec,
  statusBarLocalItemsValueSpec,
} from '@src/registry/contracts/statusBar'
import { APP_COMMAND_IDS } from '@src/registry/extensions/commands/appCommands'
import {
  acceptOnboarding,
  needsToOnboard,
  onDismissOnboardingInvite,
} from '@src/routes/Onboarding/utils'
import { type ActorRefFrom, waitFor } from 'xstate'

type ReadWriteProjectState = {
  value: boolean
  error: unknown
}

// This route only opens in the desktop context for now,
// as defined in Router.tsx, so we can use the desktop APIs and types.
const Home = () => {
  useSignals()
  const { auth, billing, commands, settings, systemIOActor, registry } =
    useApp()
  const keymap = registry.optional(keymapService)
  const { kclManager } = useSingletons()
  const executingPath = useAbsoluteFilePath()
  const settingsActor = settings.actor
  useQueryParamEffects(kclManager)

  useEffect(() => {
    if (!keymap) {
      return
    }

    keymap.applyScope(HOME_KEYMAP_SCOPE)

    return () => {
      keymap.removeScope(HOME_KEYMAP_SCOPE)
    }
  }, [keymap])

  const navigate = useNavigate()
  const location = useLocation()
  const readWriteProjectDir = useCanReadWriteProjectDirectory()
  const [nativeFileMenuCreated, setNativeFileMenuCreated] = useState(false)
  const apiToken = auth.useToken()
  const networkMachineStatus = useNetworkMachineStatus()
  const billingContext = billing.useContext()
  const hasUnlimitedCredits = billingContext.balance === Infinity
  const openBillingLinkExternally = openExternalBrowserIfDesktop()

  const projects = useFolders()
  const projectStatuses = useProjectStatuses(projects, apiToken)
  const [optimisticProjectRenames, setOptimisticProjectRenames] =
    useState<OptimisticProjectRenames>({})
  const optimisticProjects = useMemo(
    () => applyOptimisticProjectRenames(projects, optimisticProjectRenames),
    [projects, optimisticProjectRenames]
  )
  const [searchParams, setSearchParams] = useSearchParams()
  const { searchResults, query, setQuery } =
    useProjectSearch(optimisticProjects)
  const projectSearchKeybinding = keymapKeystrokesDisplay(
    keymap
      ? findKeymapItemForCommand(
          keymap.keymap.value,
          APP_COMMAND_IDS.search.focusProjects,
          [HOME_KEYMAP_SCOPE],
          registry.signal(keymapScopesValueSpec).value
        )?.keystrokes
      : undefined,
    platform()
  )
  const sort = searchParams.get('sort_by') ?? 'modified:desc'
  const sidebarButtonClasses =
    'flex items-center p-2 gap-2 leading-tight border-transparent dark:border-transparent enabled:dark:border-transparent enabled:hover:border-primary/50 enabled:dark:hover:border-inherit active:border-primary dark:bg-transparent hover:bg-transparent'

  useEffect(() => {
    setCloudSyncProjectScope(undefined)
  }, [])

  useEffect(() => {
    setOptimisticProjectRenames((renames) =>
      pruneSettledOptimisticProjectRenames(projects, renames)
    )
  }, [projects])

  useEffect(() => {
    const { RouteTelemetryCommand, RouteSettingsCommand } = createRouteCommands(
      navigate,
      location,
      ''
    )

    commands.send({
      type: 'Add commands',
      data: {
        commands: [RouteTelemetryCommand, RouteSettingsCommand],
      },
    })

    return () => {
      commands.send({
        type: 'Remove commands',
        data: {
          commands: [RouteTelemetryCommand, RouteSettingsCommand],
        },
      })
    }
  }, [navigate, location, commands])

  // Only create the native file menus on desktop
  useEffect(() => {
    if (window.electron) {
      window.electron
        .createHomePageMenu()
        .then(() => {
          setNativeFileMenuCreated(true)
        })
        .catch(reportRejection)
    }
    billing.send({ type: BillingTransition.Update, apiToken })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [])

  const autoUpdateDownloadProgress = autoUpdateDownloadProgressSignal.value
  const autoUpdateReady = autoUpdateReadySignal.value
  const settingsValues = settings.useSettings()
  const machineApiEnabled = settingsValues.app.machineApi.current
  const onboardingStatus = settingsValues.app.onboardingStatus.current

  useEffect(() => {
    let disposed = false
    let lastHandledSyncedAt: string | undefined

    const disposeCloudSyncRefreshEffect = createSignalEffect(() => {
      const syncedAt = cloudSyncStatus.value.lastSyncedAt
      if (!syncedAt || syncedAt === lastHandledSyncedAt) {
        return
      }

      lastHandledSyncedAt = syncedAt
      void waitFor(systemIOActor, (state) =>
        state.matches(SystemIOMachineStates.idle)
      )
        .then(() => {
          if (disposed || lastHandledSyncedAt !== syncedAt) {
            return
          }
          systemIOActor.send({
            type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
          })
        })
        .catch(reportRejection)
    })

    return () => {
      disposed = true
      disposeCloudSyncRefreshEffect()
    }
  }, [systemIOActor])

  // Menu listeners
  const cb = (data: WebContentSendPayload) => {
    if (data.menuLabel === 'File.Create project') {
      commands.send({
        type: 'Find and select command',
        data: {
          groupId: 'projects',
          name: 'Create project',
          argDefaultValues: {
            name: settingsValues.projects.defaultProjectName.current,
          },
        },
      })
    } else if (data.menuLabel === 'File.Open project') {
      commands.send({
        type: 'Find and select command',
        data: {
          groupId: 'projects',
          name: 'Open project',
        },
      })
    } else if (data.menuLabel === 'Edit.Rename project') {
      const currentProject = settingsActor.getSnapshot().context.currentProject
      commands.send({
        type: 'Find and select command',
        data: {
          groupId: 'projects',
          name: 'Rename project',
          argDefaultValues: {
            oldName: currentProject?.name,
            newName: currentProject?.name,
          },
        },
      })
    } else if (data.menuLabel === 'Edit.Delete project') {
      const currentProject = settingsActor.getSnapshot().context.currentProject
      commands.send({
        type: 'Find and select command',
        data: {
          groupId: 'projects',
          name: 'Delete project',
          argDefaultValues: {
            name: currentProject?.name,
          },
        },
      })
    } else if (data.menuLabel === 'File.Import file from URL') {
      commands.send({
        type: 'Find and select command',
        data: {
          groupId: 'projects',
          name: 'Import file from URL',
        },
      })
    } else if (data.menuLabel === 'File.Preferences.User settings') {
      void navigate(PATHS.HOME + PATHS.SETTINGS)
    } else if (data.menuLabel === 'File.Preferences.Keybindings') {
      void navigate(PATHS.HOME + PATHS.SETTINGS_KEYBINDINGS)
    } else if (data.menuLabel === 'File.Preferences.User default units') {
      void navigate(`${PATHS.HOME}${PATHS.SETTINGS_USER}#defaultUnit`)
    } else if (data.menuLabel === 'Edit.Change project directory') {
      void navigate(`${PATHS.HOME}${PATHS.SETTINGS_USER}#projectDirectory`)
    } else if (data.menuLabel === 'File.Sign out') {
      auth.send({ type: 'Log out' })
    } else if (
      data.menuLabel === 'View.Command Palette...' ||
      data.menuLabel === 'Help.Command Palette...'
    ) {
      commands.send({ type: 'Open' })
    } else if (data.menuLabel === 'File.Preferences.Theme') {
      commands.send({
        type: 'Find and select command',
        data: {
          groupId: 'settings',
          name: 'app.theme',
        },
      })
    } else if (data.menuLabel === 'File.Add file to project') {
      commands.send({
        type: 'Find and select command',
        data: {
          name: 'add-kcl-file-to-project',
          groupId: 'application',
        },
      })
    }
  }
  useMenuListener(cb)

  // Cancel all KCL executions while on the home page
  useEffect(() => {
    markOnce('code/didLoadHome')
    kclManager.cancelAllExecutions()
  }, [kclManager])

  useHotkeys('backspace', (e) => {
    e.preventDefault()
  })
  return (
    <div className="relative flex flex-col items-stretch h-screen w-screen overflow-hidden">
      <AppHeader nativeFileMenuCreated={nativeFileMenuCreated} />
      <div className="overflow-hidden self-stretch w-full flex-1 home-layout max-w-4xl lg:max-w-5xl xl:max-w-7xl px-4 mx-auto mt-8 lg:mt-24 lg:px-0">
        <HomeHeader
          data-testid="home-header"
          setQuery={setQuery}
          sort={sort}
          setSearchParams={setSearchParams}
          settings={settingsValues}
          readWriteProjectDir={readWriteProjectDir}
          projectSearchKeybinding={projectSearchKeybinding}
          className="col-start-2 -col-end-1"
        />
        <aside
          data-testid="home-sidebar"
          className="lg:row-start-1 -row-end-1 grid sm:grid-cols-2 md:mb-12 lg:flex flex-col justify-between"
        >
          <ul className="flex flex-col">
            {needsToOnboard(location, onboardingStatus) && (
              <li className="flex group">
                <ActionButton
                  Element="button"
                  onClick={() => {
                    acceptOnboarding({
                      onboardingStatus,
                      navigate,
                      kclManager,
                      systemIOActor,
                      settingsActor,
                      executingPath,
                    })
                  }}
                  className={`${sidebarButtonClasses} !text-primary flex-1`}
                  iconStart={{
                    icon: 'play',
                    bgClassName: '!bg-primary rounded-sm',
                    iconClassName: '!text-white',
                  }}
                  data-testid="home-tutorial-button"
                >
                  {onboardingStatus === '' ? 'Start' : 'Continue'} tutorial
                </ActionButton>
                <ActionButton
                  Element="button"
                  onClick={() => onDismissOnboardingInvite(settingsActor)}
                  className={`${sidebarButtonClasses} hidden group-hover:flex flex-none ml-auto`}
                  iconStart={{
                    icon: 'close',
                    bgClassName: '!bg-transparent rounded-sm',
                  }}
                  data-testid="onboarding-dismiss"
                >
                  <Tooltip>Dismiss tutorial</Tooltip>
                </ActionButton>
              </li>
            )}
            <li className="contents">
              <ActionButton
                Element="button"
                onClick={() =>
                  commands.send({
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
                  commands.send({
                    type: 'Find and select command',
                    data: {
                      groupId: 'application',
                      name: 'create-a-sample',
                      argDefaultValues: {
                        source: 'kcl-samples',
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
            {!hasUnlimitedCredits && (
              <li className="contents">
                <div className="my-2">
                  <BillingDialog
                    upgradeHref={withSiteBaseURL('/design-studio-pricing')}
                    accountHref={withSiteBaseURL('/account/billing')}
                    billingClick={openBillingLinkExternally}
                    error={billingContext.error}
                    balance={billingContext.balance}
                    allowance={billingContext.allowance}
                    userPaymentBalance={billingContext.userPaymentBalance}
                  />
                </div>
              </li>
            )}
            <li className="contents">
              <Announcements token={apiToken} />
            </li>
            <li className="contents">
              <ActionButton
                Element="externalLink"
                to={withSiteBaseURL('/account')}
                onClick={openExternalBrowserIfDesktop(
                  withSiteBaseURL('/account')
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
                to={withSiteBaseURL('/blog')}
                onClick={openExternalBrowserIfDesktop(withSiteBaseURL('/blog'))}
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
          searchResults={searchResults ?? []}
          projects={optimisticProjects}
          query={query}
          sort={sort}
          projectStatuses={projectStatuses}
          handleRenameProject={handleRenameProject(
            systemIOActor,
            setOptimisticProjectRenames
          )}
          className="flex-1 col-start-2 -col-end-1 overflow-y-auto pr-2 pb-24"
        />
      </div>
      <StatusBar
        globalItems={[
          ...(isDesktop() && machineApiEnabled ? [networkMachineStatus] : []),
          ...defaultGlobalStatusBarItems({
            autoUpdateDownloadProgress,
            autoUpdateReady,
            onRestartToUpdate: () => {
              window.electron?.appRestart()
            },
          }),
          ...filterStatusBarItemsForScopes(
            registry.signal(statusBarGlobalItemsValueSpec).value,
            ['home']
          ),
        ]}
        localItems={[
          ...filterStatusBarItemsForScopes(
            registry.signal(statusBarLocalItemsValueSpec).value,
            ['home']
          ),
          ...defaultLocalStatusBarItems,
        ]}
      />
    </div>
  )
}

interface HomeHeaderProps extends HTMLProps<HTMLDivElement> {
  setQuery: (query: string) => void
  sort: string
  setSearchParams: (params: Record<string, string>) => void
  settings: SettingsType
  readWriteProjectDir: ReadWriteProjectState
  projectSearchKeybinding?: string
}

function HomeHeader({
  setQuery,
  sort,
  setSearchParams,
  settings,
  readWriteProjectDir,
  projectSearchKeybinding,
  ...rest
}: HomeHeaderProps) {
  const isSortByModified = sort?.includes('modified') || !sort || sort === null

  return (
    <section {...rest}>
      <div className="flex flex-col md:flex-row gap-4 justify-between md:items-center select-none">
        <div className="flex gap-8 items-center">
          <h1 className="text-3xl font-bold">Projects</h1>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <ProjectSearchBar
            setQuery={setQuery}
            keybinding={projectSearchKeybinding}
          />
          <div className="flex gap-2 items-center">
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
  projects: Project[] | undefined
  query: string
  sort: string
  projectStatuses: Map<string, ProjectStatus>
  handleRenameProject: (
    e: FormEvent<HTMLFormElement>,
    project: Project
  ) => Promise<void>
}

function ProjectGrid({
  searchResults,
  projects,
  query,
  sort,
  projectStatuses,
  handleRenameProject,
  ...rest
}: ProjectGridProps) {
  const { systemIOActor } = useApp()
  const state = useSystemIOState()
  const isReadingFolders = state.matches(SystemIOMachineStates.readingFolders)
  const sortedSearchResults = searchResults.toSorted(getSortFunction(sort))
  const loadingMore = isReadingFolders ? (
    <div className="py-4">
      <Loading isDummy={true}>Loading more projects...</Loading>
    </div>
  ) : null

  return (
    <section data-testid="home-section" {...rest}>
      {projects === undefined || (isReadingFolders && projects.length === 0) ? (
        <Loading isDummy={true}>Loading your Projects...</Loading>
      ) : (
        <>
          {searchResults.length > 0 ? (
            <ul className="grid w-full sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {sortedSearchResults.map((project) => (
                <ProjectCard
                  key={project.name}
                  project={project}
                  projectStatus={
                    project.cloudProjectId
                      ? projectStatuses.get(project.cloudProjectId)
                      : undefined
                  }
                  handleRenameProject={handleRenameProject}
                  handleDeleteProject={handleDeleteProject(systemIOActor)}
                />
              ))}
            </ul>
          ) : (
            <p
              data-testid="projects-none"
              className="p-4 my-8 border border-dashed rounded border-chalkboard-30 dark:border-chalkboard-70"
            >
              No projects found
              {projects !== undefined && projects.length === 0
                ? ', ready to make your first one?'
                : ` with the search term "${query}"`}
            </p>
          )}
          {loadingMore}
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

function handleRenameProject(
  systemIOActor: ActorRefFrom<typeof systemIOMachine>,
  setOptimisticProjectRenames: Dispatch<
    SetStateAction<OptimisticProjectRenames>
  >
) {
  return async function (e: FormEvent<HTMLFormElement>, project: Project) {
    const { newProjectName } = Object.fromEntries(
      new FormData(e.target as HTMLFormElement)
    )

    if (
      !project.cloudProjectId &&
      typeof newProjectName === 'string' &&
      newProjectName.startsWith('.')
    ) {
      toast.error('Project names cannot start with a period.')
      return
    }

    if (newProjectName !== getProjectDisplayName(project)) {
      if (project.cloudProjectId && typeof newProjectName === 'string') {
        setOptimisticProjectRenames((renames) => ({
          ...renames,
          [project.cloudProjectId as string]: {
            title: newProjectName,
            modified: Date.now(),
          },
        }))
      }

      systemIOActor.send({
        type: SystemIOMachineEvents.renameProject,
        data: {
          requestedProjectName: String(newProjectName),
          projectName: project.name,
          redirect: false,
        },
      })
    }
  }
}

function handleDeleteProject(
  systemIOActor: ActorRefFrom<typeof systemIOMachine>
) {
  return async function (project: Project) {
    systemIOActor.send({
      type: SystemIOMachineEvents.deleteProject,
      data: {
        requestedProjectName: String(project.name),
      },
    })
  }
}

export default Home
