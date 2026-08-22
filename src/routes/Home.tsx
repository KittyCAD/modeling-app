import { BillingDialog } from '@kittycad/ui-components'
import { useSignals } from '@preact/signals-react/runtime'
import { ActionButton } from '@src/components/ActionButton'
import { Announcements } from '@src/components/Announcements'
import { AppHeader } from '@src/components/AppHeader'
import { CustomIcon } from '@src/components/CustomIcon'
import Loading from '@src/components/Loading'
import { useNetworkMachineStatus } from '@src/components/NetworkMachineIndicator'
import { useProjectSearch } from '@src/components/ProjectSearchBar'
import {
  defaultGlobalStatusBarItems,
  defaultLocalStatusBarItems,
} from '@src/components/StatusBar/defaultStatusBarItems'
import { StatusBar } from '@src/components/StatusBar/StatusBar'
import Tooltip from '@src/components/Tooltip'
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
import { createRouteCommands } from '@src/lib/commandBarConfigs/routeCommandConfig'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import { removeDragPreviewElement, setDragPreview } from '@src/lib/dragPreview'
import { getHomeProjectDisplayName } from '@src/lib/homeProjects'
import { isDesktop } from '@src/lib/isDesktop'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { PATHS } from '@src/lib/paths'
import { markOnce } from '@src/lib/performance'
import {
  type ProjectLibrary,
  projectLibrariesFromSettings,
} from '@src/lib/projectLibraries'
import { shouldShowFreeCloudProjectTrainingDisclosure } from '@src/lib/projectLibraries/trainingDisclosure'
import { getSortFunction } from '@src/lib/sorting'
import { reportRejection } from '@src/lib/trap'
import { platform } from '@src/lib/utils'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import {
  useCanReadWriteProjectDirectory,
  useFolders,
  useState as useSystemIOState,
} from '@src/machines/systemIO/hooks'
import { SystemIOMachineStates } from '@src/machines/systemIO/utils'
import type { WebContentSendPayload } from '@src/menu/channels'
import {
  type HomeProjectActionsService,
  type HomeProjectEntry,
  homeProjectActionsService,
  homeProjectEntriesValueSpec,
} from '@src/registry/contracts/homeProjects'
import { homeSidebarItemsValueSpec } from '@src/registry/contracts/homeSidebar'
import {
  findKeymapItemForCommand,
  HOME_KEYMAP_SCOPE,
  keymapKeystrokesDisplay,
  keymapScopesValueSpec,
  keymapService,
} from '@src/registry/contracts/keymap'
import {
  getHomeProjectEntriesForLibrary,
  projectLibraryRealizationsService,
  projectLibraryTypesValueSpec,
} from '@src/registry/contracts/projectLibraries'
import { projectSession } from '@src/registry/contracts/projectSession'
import {
  filterStatusBarItemsForScopes,
  statusBarGlobalItemsValueSpec,
  statusBarLocalItemsValueSpec,
} from '@src/registry/contracts/statusBar'
import { APP_COMMAND_IDS } from '@src/registry/extensions/commands/appCommands'
import { HomeHeader } from '@src/routes/HomeHeader'
import {
  type ProjectCardDragProps,
  ProjectCardList,
  type ProjectLibraryDragController,
  type ProjectLibraryDropTargetProps,
  ProjectLibraryPreviewRow,
} from '@src/routes/HomeProjectCards'
import {
  acceptOnboarding,
  needsToOnboard,
  onDismissOnboardingInvite,
  reportOnboardingStartFailure,
} from '@src/routes/Onboarding/utils'
import type { HTMLProps } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom'

const HOME_PROJECT_CARD_DRAG_MIME = 'application/x-zoo-home-project'
const HOME_PROJECT_CARD_DRAG_PREVIEW_ID = 'home-project-card-drag-preview'

interface HomeProjectCardDragData {
  projectId: string
}

function writeHomeProjectCardDragData(
  dataTransfer: DataTransfer,
  project: HomeProjectEntry
) {
  dataTransfer.clearData()
  dataTransfer.effectAllowed = 'move'
  dataTransfer.setData(
    HOME_PROJECT_CARD_DRAG_MIME,
    JSON.stringify({
      projectId: project.id,
    } satisfies HomeProjectCardDragData)
  )
  dataTransfer.setData('text/plain', getHomeProjectDisplayName(project))
}

function readHomeProjectCardDragData(
  dataTransfer: DataTransfer
): HomeProjectCardDragData | undefined {
  const serialized = dataTransfer.getData(HOME_PROJECT_CARD_DRAG_MIME)
  if (!serialized) {
    return undefined
  }

  try {
    const data = JSON.parse(serialized) as Partial<HomeProjectCardDragData>
    return typeof data.projectId === 'string'
      ? { projectId: data.projectId }
      : undefined
  } catch {
    return undefined
  }
}

interface UseProjectLibraryDragOptions {
  projects: HomeProjectEntry[]
  projectActions: HomeProjectActionsService
  onMoveToLibrary: (project: HomeProjectEntry, libraryId: string) => void
}

function useProjectLibraryDrag({
  projects,
  projectActions,
  onMoveToLibrary,
}: UseProjectLibraryDragOptions): ProjectLibraryDragController {
  const [draggedProjectId, setDraggedProjectId] = useState<string>()
  const [dragOverLibraryId, setDragOverLibraryId] = useState<string>()
  const draggedProject = useMemo(
    () =>
      draggedProjectId
        ? projects.find((project) => project.id === draggedProjectId)
        : undefined,
    [draggedProjectId, projects]
  )
  const finishProjectDrag = useCallback(() => {
    removeDragPreviewElement(HOME_PROJECT_CARD_DRAG_PREVIEW_ID)
    setDraggedProjectId(undefined)
    setDragOverLibraryId(undefined)
  }, [])
  const canMoveProjectToLibrary = useCallback(
    (project: HomeProjectEntry | undefined, library: ProjectLibrary) =>
      Boolean(
        project &&
          projectActions
            .getMoveToLibraryTargets(project)
            .some((target) => target.library.id === library.id)
      ),
    [projectActions]
  )
  const canDropOnLibrary = useCallback(
    (library: ProjectLibrary) =>
      canMoveProjectToLibrary(draggedProject, library),
    [canMoveProjectToLibrary, draggedProject]
  )
  const getProjectCardDragProps = useCallback(
    (project: HomeProjectEntry): ProjectCardDragProps => {
      if (!projectActions.canMoveToLibrary(project)) {
        return { draggable: false }
      }

      return {
        draggable: true,
        onDragStart: (event) => {
          if (!projectActions.canMoveToLibrary(project)) {
            event.preventDefault()
            return
          }

          const projectDisplayName = getHomeProjectDisplayName(project)
          writeHomeProjectCardDragData(event.dataTransfer, project)
          setDragPreview(event.dataTransfer, {
            id: HOME_PROJECT_CARD_DRAG_PREVIEW_ID,
            text: `Move ${projectDisplayName}`,
            offsetX: 12,
            offsetY: 12,
          })
          setDraggedProjectId(project.id)
          setDragOverLibraryId(undefined)
        },
        onDragEnd: finishProjectDrag,
      }
    },
    [finishProjectDrag, projectActions]
  )
  const getLibraryDropTargetProps = useCallback(
    (library: ProjectLibrary): ProjectLibraryDropTargetProps => ({
      onDragOver: (event) => {
        if (!canDropOnLibrary(library)) {
          return
        }

        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setDragOverLibraryId(library.id)
      },
      onDragLeave: (event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        ) {
          return
        }

        setDragOverLibraryId((currentLibraryId) =>
          currentLibraryId === library.id ? undefined : currentLibraryId
        )
      },
      onDrop: (event) => {
        if (!canDropOnLibrary(library)) {
          return
        }

        const droppedProjectId =
          readHomeProjectCardDragData(event.dataTransfer)?.projectId ??
          draggedProject?.id
        const project = projects.find((entry) => entry.id === droppedProjectId)
        if (!project || !canMoveProjectToLibrary(project, library)) {
          finishProjectDrag()
          return
        }

        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'move'
        onMoveToLibrary(project, library.id)
        finishProjectDrag()
      },
    }),
    [
      canDropOnLibrary,
      canMoveProjectToLibrary,
      draggedProject?.id,
      finishProjectDrag,
      onMoveToLibrary,
      projects,
    ]
  )
  const isLibraryDragOver = useCallback(
    (library: ProjectLibrary) =>
      dragOverLibraryId === library.id && canDropOnLibrary(library),
    [canDropOnLibrary, dragOverLibraryId]
  )

  useEffect(() => {
    return () => removeDragPreviewElement(HOME_PROJECT_CARD_DRAG_PREVIEW_ID)
  }, [])

  return useMemo(
    () => ({
      getProjectCardDragProps,
      getLibraryDropTargetProps,
      isLibraryDragOver,
    }),
    [getLibraryDropTargetProps, getProjectCardDragProps, isLibraryDragOver]
  )
}

// This route only opens in the desktop context for now,
// as defined in Router.tsx, so we can use the desktop APIs and types.
const Home = () => {
  useSignals()
  const app = useApp()
  const { auth, billing, commands, settings, registry, userFeatures } = app
  const keymap = registry.optional(keymapService)
  const { kclManager } = useSingletons()
  const settingsActor = settings.actor
  useQueryParamEffects()

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
  const homeProjectEntries = registry.signal(homeProjectEntriesValueSpec).value
  const projectStatuses = useProjectStatuses(homeProjectEntries, apiToken)
  const homeSidebarItems = registry.signal(homeSidebarItemsValueSpec).value
  const settingsValues = settings.useSettings()
  const projectLibraryTypes = registry.signal(
    projectLibraryTypesValueSpec
  ).value
  const projectLibraries = projectLibrariesFromSettings(
    settingsValues.app.libraries.current
  ).map((library) => ({
    ...library,
    icon: projectLibraryTypes.get(library.type)?.icon ?? library.icon,
  }))
  const projectLibraryRealizations = registry.optional(
    projectLibraryRealizationsService
  )
  const projectLibraryWatchKey = projectLibraries
    .map((library) =>
      [library.id, library.type, library.path, library.source ?? ''].join(':')
    )
    .join('|')
  const homeProjectActions = registry.get(homeProjectActionsService)
  const session = registry.get(projectSession)
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
  const selectedProjectLibraryId = selectedProjectLibrary?.id
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
  const moveProjectToLibrary = useCallback(
    (project: HomeProjectEntry, libraryId?: string) => {
      if (!homeProjectActions.canMoveToLibrary(project)) {
        return
      }

      commands.send({
        type: 'Find and select command',
        data: {
          groupId: 'projects',
          name: 'Move project',
          argDefaultValues: {
            project: project.id,
            ...(libraryId ? { library: libraryId } : {}),
          },
        },
      })
    },
    [commands, homeProjectActions]
  )
  const projectLibraryDrag = useProjectLibraryDrag({
    projects: homeProjectEntries,
    projectActions: homeProjectActions,
    onMoveToLibrary: moveProjectToLibrary,
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: projectLibraryWatchKey tracks library identity and paths without rebinding on icon/title-only renders.
  useEffect(() => {
    return projectLibraryRealizations?.watchConfiguredLibraries({
      libraries: projectLibraries,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- projectLibraryWatchKey tracks library identity and paths without rebinding on icon/title-only renders.
  }, [projectLibraryRealizations, projectLibraryWatchKey])

  useEffect(() => {
    session.setCurrentProjectLibraryId(selectedProjectLibraryId)

    return () => {
      if (session.getCurrentProjectLibraryId() === selectedProjectLibraryId) {
        session.setCurrentProjectLibraryId(undefined)
      }
    }
  }, [session, selectedProjectLibraryId])

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
  const machineApiEnabled = settingsValues.app.machineApi.current
  const onboardingStatus = settingsValues.app.onboardingStatus.current

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
          showFreeCloudProjectTrainingDisclosure={shouldShowFreeCloudProjectTrainingDisclosure(
            {
              library: selectedProjectLibrary,
              hasSubscription: billingContext.hasSubscription,
            }
          )}
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
                    void acceptOnboarding({
                      app,
                      onboardingStatus,
                      navigate,
                    }).catch(reportOnboardingStartFailure)
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
            {homeSidebarItems
              .filter((item) => item.isVisible?.() ?? true)
              .map(({ id, Component }) => (
                <li key={id} className="contents">
                  <Component className={sidebarButtonClasses} />
                </li>
              ))}
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
            onMoveToLibrary={moveProjectToLibrary}
            projectLibraryEmptyTestId="project-library-empty"
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
            onMoveToLibrary={moveProjectToLibrary}
            projectLibraryDrag={projectLibraryDrag}
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
            hasCloudSyncFeature,
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
  onMoveToLibrary: (project: HomeProjectEntry) => void
  projectLibraryDrag?: ProjectLibraryDragController
}

function shouldShowLoadingMoreProjects(
  state: ReturnType<typeof useSystemIOState>
) {
  return (
    state.matches(SystemIOMachineStates.readingFolders) &&
    !state.context.hasListedProjects
  )
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
  onMoveToLibrary,
  projectLibraryDrag,
  ...rest
}: ProjectLibraryOverviewProps) {
  const state = useSystemIOState()
  const libraryRows = libraries
    .map((library) => ({
      library,
      projects: getHomeProjectEntriesForLibrary(
        query.length > 0 ? searchResults : projects,
        library.id
      ).toSorted(getSortFunction(sort)),
    }))
    .filter(({ projects }) => query.length === 0 || projects.length > 0)
  const loadingMore = shouldShowLoadingMoreProjects(state) ? (
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
                  onMoveToLibrary={onMoveToLibrary}
                  projectLibraryDrag={projectLibraryDrag}
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

interface ProjectGridProps extends HTMLProps<HTMLDivElement> {
  searchResults: HomeProjectEntry[]
  projects: HomeProjectEntry[]
  localProjectsLoaded: boolean
  query: string
  sort: string
  projectStatuses: Map<string, ProjectStatus>
  projectActions: HomeProjectActionsService
  showCloudSyncUi: boolean
  onMoveToLibrary: (project: HomeProjectEntry) => void
  showSourceStatusBadges?: boolean
  projectLibraryEmptyTestId?: string
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
  onMoveToLibrary,
  showSourceStatusBadges = true,
  projectLibraryEmptyTestId,
  ...rest
}: ProjectGridProps) {
  const state = useSystemIOState()
  const sortedSearchResults = searchResults.toSorted(getSortFunction(sort))
  const loadingMore = shouldShowLoadingMoreProjects(state) ? (
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
              onMoveToLibrary={onMoveToLibrary}
              showSourceStatusBadges={showSourceStatusBadges}
            />
          ) : (
            <p
              data-testid="projects-none"
              className="p-4 my-8 border border-dashed rounded border-chalkboard-30 dark:border-chalkboard-70"
            >
              <span data-testid={projectLibraryEmptyTestId}>
                No projects found
              </span>
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

export default Home
