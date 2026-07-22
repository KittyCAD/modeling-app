import { BillingDialog } from '@kittycad/ui-components'
import { effect as createSignalEffect } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import { ActionButton } from '@src/components/ActionButton'
import { Announcements } from '@src/components/Announcements'
import { AppHeader } from '@src/components/AppHeader'
import AppProjectCard from '@src/components/AppProjectCard/AppProjectCard'
import { CustomIcon, type CustomIconName } from '@src/components/CustomIcon'
import Loading from '@src/components/Loading'
import { useNetworkMachineStatus } from '@src/components/NetworkMachineIndicator'
import {
  ProjectSearchBar,
  useProjectSearch,
} from '@src/components/ProjectSearchBar'
import {
  defaultGlobalStatusBarItems,
  defaultLocalStatusBarItems,
} from '@src/components/StatusBar/defaultStatusBarItems'
import { StatusBar } from '@src/components/StatusBar/StatusBar'
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
import { BillingTransition } from '@src/lib/billing'
import { useApp, useSingletons } from '@src/lib/boot'
import { cloudSyncStatus, setCloudSyncProjectScope } from '@src/lib/cloudSync'
import { createRouteCommands } from '@src/lib/commandBarConfigs/routeCommandConfig'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import { isDesktop } from '@src/lib/isDesktop'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { PATHS } from '@src/lib/paths'
import { markOnce } from '@src/lib/performance'
import type { ProjectLibrary } from '@src/lib/projectLibraries'
import {
  getNextSearchParams,
  getSortFunction,
  getSortIcon,
} from '@src/lib/sorting'
import { reportRejection } from '@src/lib/trap'
import { platform } from '@src/lib/utils'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
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
import {
  type HomeProjectActionsService,
  type HomeProjectEntry,
  homeProjectActionsService,
  homeProjectEntriesValueSpec,
} from '@src/registry/contracts/homeProjects'
import {
  findKeymapItemForCommand,
  HOME_KEYMAP_SCOPE,
  keymapKeystrokesDisplay,
  keymapScopesValueSpec,
  keymapService,
} from '@src/registry/contracts/keymap'
import {
  getHomeProjectEntriesForLibrary,
  projectLibrariesValueSpec,
} from '@src/registry/contracts/projectLibraries'
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
import type { HTMLProps } from 'react'
import { useEffect, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import { waitFor } from 'xstate'

type ReadWriteProjectState = {
  value: boolean
  error: unknown
}

const PROJECT_LIBRARY_PREVIEW_LIMIT = 6

// This route only opens in the desktop context for now,
// as defined in Router.tsx, so we can use the desktop APIs and types.
const Home = () => {
  useSignals()
  const {
    auth,
    billing,
    commands,
    settings,
    systemIOActor,
    registry,
    userFeatures,
  } = useApp()
  const keymap = registry.optional(keymapService)
  const { kclManager } = useSingletons()
  const executingPath = useAbsoluteFilePath({ warnIfNoExecutingPath: false })
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
  const homeProjectEntries = registry.signal(homeProjectEntriesValueSpec).value
  const projectLibraries = registry.signal(projectLibrariesValueSpec).value
  const homeProjectActions = registry.get(homeProjectActionsService)
  const hasCloudSyncFeature = userFeatures.useHas(
    OPFS_CLOUD_FEATURE_FLAG,
    false
  )
  const { libraryId } = useParams()
  const routeSelectedProjectLibrary = libraryId
    ? projectLibraries.find((library) => library.id === libraryId)
    : undefined
  const singleProjectLibrary =
    !libraryId && projectLibraries.length === 1
      ? projectLibraries[0]
      : undefined
  const selectedProjectLibrary =
    routeSelectedProjectLibrary ?? singleProjectLibrary
  const scopedHomeProjectEntries = routeSelectedProjectLibrary
    ? getHomeProjectEntriesForLibrary(
        homeProjectEntries,
        routeSelectedProjectLibrary.id
      )
    : libraryId
      ? []
      : homeProjectEntries
  const [searchParams, setSearchParams] = useSearchParams()
  const { searchResults, query, setQuery } = useProjectSearch(
    scopedHomeProjectEntries
  )
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
  }, [])

  useEffect(() => {
    billing.send({ type: BillingTransition.Update, apiToken })
  }, [apiToken, billing])

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
      void navigate(`${PATHS.HOME}${PATHS.SETTINGS_USER}#libraries`)
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
          title={
            selectedProjectLibrary
              ? selectedProjectLibrary.title
              : libraryId
                ? 'Library not found'
                : 'Project Libraries'
          }
          library={selectedProjectLibrary}
          showLibraryBackLink={Boolean(routeSelectedProjectLibrary)}
          setQuery={setQuery}
          sort={sort}
          setSearchParams={setSearchParams}
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
                      argDefaultValues: selectedProjectLibrary
                        ? {
                            libraryId: selectedProjectLibrary.id,
                          }
                        : undefined,
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
        {selectedProjectLibrary || libraryId ? (
          <ProjectGrid
            searchResults={searchResults ?? []}
            projects={scopedHomeProjectEntries}
            localProjectsLoaded={projects !== undefined}
            query={query}
            sort={sort}
            projectStatuses={projectStatuses}
            projectActions={homeProjectActions}
            showCloudSyncUi={hasCloudSyncFeature}
            showSourceStatusBadges={false}
            className="flex-1 col-start-2 -col-end-1 overflow-y-auto pr-2 pb-24"
          />
        ) : (
          <ProjectLibraryOverview
            libraries={projectLibraries}
            searchResults={searchResults ?? []}
            projects={homeProjectEntries}
            localProjectsLoaded={projects !== undefined}
            query={query}
            sort={sort}
            projectStatuses={projectStatuses}
            projectActions={homeProjectActions}
            showCloudSyncUi={hasCloudSyncFeature}
            className="flex-1 col-start-2 -col-end-1 overflow-y-auto pr-2 pb-24"
          />
        )}
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
  title: string
  library?: ProjectLibrary
  showLibraryBackLink?: boolean
  setQuery: (query: string) => void
  sort: string
  setSearchParams: (params: Record<string, string>) => void
  readWriteProjectDir: ReadWriteProjectState
  projectSearchKeybinding?: string
}

function HomeHeader({
  title,
  library,
  showLibraryBackLink = false,
  setQuery,
  sort,
  setSearchParams,
  readWriteProjectDir,
  projectSearchKeybinding,
  ...rest
}: HomeHeaderProps) {
  const isSortByModified = sort?.includes('modified') || !sort || sort === null

  return (
    <section {...rest}>
      <div className="flex flex-col md:flex-row gap-4 justify-between md:items-center select-none">
        <div className="flex gap-8 items-center">
          <div className="flex flex-col gap-1">
            {library && showLibraryBackLink && (
              <Link
                to={PATHS.HOME}
                className="text-sm text-chalkboard-70 underline underline-offset-2 dark:text-chalkboard-30"
              >
                All libraries
              </Link>
            )}
            <h1 className="text-3xl font-bold">{title}</h1>
          </div>
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
      {library ? (
        <p className="my-4 break-words text-sm text-chalkboard-80 dark:text-chalkboard-30">
          Loaded from{' '}
          <Link
            data-testid="project-directory-settings-link"
            to={`${PATHS.HOME + PATHS.SETTINGS_USER}#libraries`}
            className="text-chalkboard-90 dark:text-chalkboard-20 underline underline-offset-2"
          >
            {library.path}
          </Link>
          .
        </p>
      ) : null}
      {!readWriteProjectDir.value && (
        <section>
          <div className="flex items-center select-none">
            <div className="flex gap-8 items-center justify-between grow bg-destroy-80 text-white py-1 px-4 my-2 rounded-sm">
              <p className="">{errorMessage(readWriteProjectDir.error)}</p>
              <Link
                data-testid="project-directory-settings-link"
                to={`${PATHS.HOME + PATHS.SETTINGS_USER}#libraries`}
                className="py-1 text-white underline underline-offset-2 text-sm"
              >
                Manage Project Libraries
              </Link>
            </div>
          </div>
        </section>
      )}
    </section>
  )
}

interface ProjectLibraryOverviewProps extends HTMLProps<HTMLDivElement> {
  libraries: ProjectLibrary[]
  searchResults: HomeProjectEntry[]
  projects: HomeProjectEntry[]
  localProjectsLoaded: boolean
  query: string
  sort: string
  projectStatuses: Map<string, ProjectStatus>
  projectActions: HomeProjectActionsService
  showCloudSyncUi: boolean
}

function getProjectLibraryRoute(library: ProjectLibrary) {
  return `${PATHS.LIBRARY}/${encodeURIComponent(library.id)}`
}

function getProjectLibraryIconName(library: ProjectLibrary): CustomIconName {
  if (library.icon === 'network' || library.type === 'cloud') {
    return 'network'
  }

  return 'folder'
}

function projectCountLabel(count: number) {
  return `${count} project${count === 1 ? '' : 's'}`
}

function ProjectLibraryOverview({
  libraries,
  searchResults,
  projects,
  localProjectsLoaded,
  query,
  sort,
  projectStatuses,
  projectActions,
  showCloudSyncUi,
  ...rest
}: ProjectLibraryOverviewProps) {
  const state = useSystemIOState()
  const isReadingFolders = state.matches(SystemIOMachineStates.readingFolders)
  const libraryRows = libraries
    .map((library) => ({
      library,
      projects: getHomeProjectEntriesForLibrary(
        query.length > 0 ? searchResults : projects,
        library.id
      ).toSorted(getSortFunction(sort)),
    }))
    .filter(({ projects }) => query.length === 0 || projects.length > 0)
  const loadingMore = isReadingFolders ? (
    <div className="py-4">
      <Loading isDummy={true}>Loading more projects...</Loading>
    </div>
  ) : null

  if (libraries.length === 0) {
    return <ProjectLibrariesEmptyState {...rest} />
  }

  return (
    <section data-testid="home-section" {...rest}>
      {!localProjectsLoaded && projects.length === 0 ? (
        <Loading isDummy={true}>Loading your Projects...</Loading>
      ) : (
        <>
          {libraryRows.length > 0 ? (
            <div className="flex flex-col gap-8">
              {libraryRows.map(({ library, projects }) => (
                <ProjectLibraryPreviewRow
                  key={library.id}
                  library={library}
                  projects={projects}
                  query={query}
                  projectStatuses={projectStatuses}
                  projectActions={projectActions}
                  showCloudSyncUi={showCloudSyncUi}
                />
              ))}
            </div>
          ) : (
            <p
              data-testid="projects-none"
              className="p-4 my-8 border border-dashed rounded border-chalkboard-30 dark:border-chalkboard-70"
            >
              No projects found
              {projects.length === 0
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

function ProjectLibrariesEmptyState(props: HTMLProps<HTMLDivElement>) {
  return (
    <section data-testid="home-section" {...props}>
      <div
        className="my-8 flex max-w-xl flex-col items-start gap-4 rounded-sm border border-dashed border-chalkboard-30 p-6 dark:border-chalkboard-70"
        data-testid="project-libraries-empty"
      >
        <span className="grid h-10 w-10 place-content-center rounded-sm bg-primary/10 text-primary dark:bg-chalkboard-90 dark:text-chalkboard-20">
          <CustomIcon name="folderPlus" className="h-6 w-6" />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">No project libraries</h2>
          <p className="text-sm text-chalkboard-70 dark:text-chalkboard-30">
            Add a library to choose where projects are loaded from.
          </p>
        </div>
        <ActionButton
          Element="link"
          to={`${PATHS.HOME + PATHS.SETTINGS_USER}#libraries`}
          iconStart={{
            icon: 'plus',
            bgClassName: '!bg-transparent',
          }}
          data-testid="project-libraries-empty-add"
        >
          Add library
        </ActionButton>
      </div>
    </section>
  )
}

interface ProjectLibraryPreviewRowProps {
  library: ProjectLibrary
  projects: HomeProjectEntry[]
  query: string
  projectStatuses: Map<string, ProjectStatus>
  projectActions: HomeProjectActionsService
  showCloudSyncUi: boolean
}

function ProjectLibraryPreviewRow({
  library,
  projects,
  query,
  projectStatuses,
  projectActions,
  showCloudSyncUi,
}: ProjectLibraryPreviewRowProps) {
  const previewProjects =
    query.length > 0
      ? projects
      : projects.slice(0, PROJECT_LIBRARY_PREVIEW_LIMIT)

  return (
    <section className="flex flex-col gap-3">
      <Link
        to={getProjectLibraryRoute(library)}
        className="group flex items-center gap-3 rounded-sm border border-transparent p-1 !no-underline hover:border-primary/30 hover:bg-primary/5"
        data-testid="project-library-link"
      >
        <span className="grid h-8 w-8 flex-none place-content-center rounded-sm bg-primary/10 text-primary dark:bg-chalkboard-90 dark:text-chalkboard-20">
          <CustomIcon
            name={getProjectLibraryIconName(library)}
            className="h-5 w-5"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold text-chalkboard-100 dark:text-chalkboard-10">
            {library.title}
          </span>
          <span className="block truncate text-xs text-chalkboard-70 dark:text-chalkboard-30">
            {library.path}
          </span>
        </span>
        <span className="hidden flex-none text-xs text-chalkboard-70 dark:text-chalkboard-30 sm:block">
          {projectCountLabel(projects.length)}
        </span>
        <CustomIcon
          name="arrowRight"
          className="h-5 w-5 flex-none text-chalkboard-60 group-hover:text-primary"
        />
      </Link>
      {previewProjects.length > 0 ? (
        <ProjectCardList
          projects={previewProjects}
          projectStatuses={projectStatuses}
          projectActions={projectActions}
          showCloudSyncUi={showCloudSyncUi}
          showSourceStatusBadges={false}
          density="compact"
          className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
        />
      ) : (
        <p
          className="rounded-sm border border-dashed border-chalkboard-30 p-4 text-sm text-chalkboard-70 dark:border-chalkboard-70 dark:text-chalkboard-30"
          data-testid="project-library-empty"
        >
          No projects
        </p>
      )}
    </section>
  )
}

interface ProjectGridProps extends HTMLProps<HTMLDivElement> {
  searchResults: HomeProjectEntry[]
  projects: HomeProjectEntry[]
  localProjectsLoaded: boolean
  query: string
  sort: string
  projectStatuses: Map<string, ProjectStatus>
  projectActions: HomeProjectActionsService
  showCloudSyncUi: boolean
  showSourceStatusBadges?: boolean
}

function ProjectGrid({
  searchResults,
  projects,
  localProjectsLoaded,
  query,
  sort,
  projectStatuses,
  projectActions,
  showCloudSyncUi,
  showSourceStatusBadges = true,
  ...rest
}: ProjectGridProps) {
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
      {!localProjectsLoaded && projects.length === 0 ? (
        <Loading isDummy={true}>Loading your Projects...</Loading>
      ) : (
        <>
          {searchResults.length > 0 ? (
            <ProjectCardList
              projects={sortedSearchResults}
              projectStatuses={projectStatuses}
              projectActions={projectActions}
              showCloudSyncUi={showCloudSyncUi}
              showSourceStatusBadges={showSourceStatusBadges}
            />
          ) : (
            <p
              data-testid="projects-none"
              className="p-4 my-8 border border-dashed rounded border-chalkboard-30 dark:border-chalkboard-70"
            >
              No projects found
              {projects.length === 0
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

interface ProjectCardListProps {
  projects: HomeProjectEntry[]
  projectStatuses: Map<string, ProjectStatus>
  projectActions: HomeProjectActionsService
  showCloudSyncUi: boolean
  density?: 'default' | 'compact'
  showDetails?: boolean
  showSourceStatusBadges?: boolean
  className?: string
}

function ProjectCardList({
  projects,
  projectStatuses,
  projectActions,
  showCloudSyncUi,
  density = 'default',
  showDetails = true,
  showSourceStatusBadges = true,
  className = 'grid w-full sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4',
}: ProjectCardListProps) {
  return (
    <ul className={className}>
      {projects.map((project) => (
        <AppProjectCard
          key={project.id}
          project={project}
          projectActions={projectActions}
          projectStatus={
            project.remoteProjectId
              ? projectStatuses.get(project.remoteProjectId)
              : undefined
          }
          density={density}
          showDetails={showDetails}
          showCloudSyncUi={showCloudSyncUi}
          showSourceStatusBadges={showSourceStatusBadges}
        />
      ))}
    </ul>
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

export default Home
