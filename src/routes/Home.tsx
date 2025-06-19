import type { FormEvent, HTMLProps } from 'react'
import { useEffect, useState } from 'react'
import { toast } from 'react-hot-toast'
import { useHotkeys } from 'react-hotkeys-hook'
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom'

import { ActionButton } from '@src/components/ActionButton'
import { AppHeader } from '@src/components/AppHeader'
import Loading from '@src/components/Loading'
import ProjectCard from '@src/components/ProjectCard/ProjectCard'
import { PromptCard } from '@src/components/PromptCard'
import {
  HomeSearchBar,
  useHomeSearch,
  HomeItems,
  areHomeItemsProjects,
  areHomeItemsPrompts,
} from '@src/components/HomeSearchBar'
import { BillingDialog } from '@src/components/BillingDialog'
import { useQueryParamEffects } from '@src/hooks/useQueryParamEffects'
import { useMenuListener } from '@src/hooks/useMenu'
import { isDesktop } from '@src/lib/isDesktop'
import { PATHS } from '@src/lib/paths'
import { markOnce } from '@src/lib/performance'
import type { Project } from '@src/lib/project'
import type { Prompt } from '@src/lib/prompt'
import {
  getNextSearchParams,
  getSortFunction,
  getSortIcon,
} from '@src/lib/sorting'
import { reportRejection } from '@src/lib/trap'
import {
  useToken,
  commandBarActor,
  codeManager,
  kclManager,
  authActor,
  billingActor,
  systemIOActor,
  useSettings,
} from '@src/lib/singletons'
import { BillingTransition } from '@src/machines/billingMachine'
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
import {
  acceptOnboarding,
  needsToOnboard,
  onDismissOnboardingInvite,
} from '@src/routes/Onboarding/utils'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { ML_EXPERIMENTAL_MESSAGE } from '@src/lib/constants'
import { StatusBar } from '@src/components/StatusBar/StatusBar'
import { useNetworkMachineStatus } from '@src/components/NetworkMachineIndicator'
import {
  defaultLocalStatusBarItems,
  defaultGlobalStatusBarItems,
} from '@src/components/StatusBar/defaultStatusBarItems'
import { useSelector } from '@xstate/react'
import { withSiteBaseURL } from '@src/lib/withBaseURL'

type ReadWriteProjectState = {
  value: boolean
  error: unknown
}

// This route only opens in the desktop context for now,
// as defined in Router.tsx, so we can use the desktop APIs and types.
const Home = () => {
  useQueryParamEffects()
  const navigate = useNavigate()
  const readWriteProjectDir = useCanReadWriteProjectDirectory()
  const [nativeFileMenuCreated, setNativeFileMenuCreated] = useState(false)
  const apiToken = useToken()
  const networkMachineStatus = useNetworkMachineStatus()
  const billingContext = useSelector(billingActor, ({ context }) => context)
  const hasUnlimitedCredits = billingContext.credits === Infinity

  // Only create the native file menus on desktop
  useEffect(() => {
    if (isDesktop()) {
      window.electron
        .createHomePageMenu()
        .then(() => {
          setNativeFileMenuCreated(true)
        })
        .catch(reportRejection)
    }
    billingActor.send({ type: BillingTransition.Update, apiToken })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [])

  const location = useLocation()
  const settings = useSettings()
  const onboardingStatus = settings.app.onboardingStatus.current

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
  const projects = useFolders()
  const prompts = [{ prompt: 'lol'} , { prompt: 'never gonna give you up' }, {prompt: 'takethisli' }]
  const [tabSelected, setTabSelected] = useState<HomeTabKeys>(HomeTabKeys.Projects)
  const [items, setItems] = useState<Project[] | Prompt[]>(projects)
  const [searchParams, setSearchParams] = useSearchParams()
  const { searchResults, query, searchAgainst } = useHomeSearch(projects)
  const sortBy = searchParams.get('sort_by') ?? 'modified:desc'

  const onChangeTab = (key: HomeTabKeys) => {
    setTabSelected(key)
    switch (key) {
      case HomeTabKeys.Projects:
        setItems(projects)
        break
      case HomeTabKeys.Prompts:
        setItems(prompts)
        break
      default:
        const _ex: never = key
    }
  }

  useEffect(() => {
    searchAgainst(items)('')
  }, [items])

  const sidebarButtonClasses =
    'flex items-center p-2 gap-2 leading-tight border-transparent dark:border-transparent enabled:dark:border-transparent enabled:hover:border-primary/50 enabled:dark:hover:border-inherit active:border-primary dark:bg-transparent hover:bg-transparent'

  return (
    <div className="relative flex flex-col items-stretch h-screen w-screen overflow-hidden">
      <AppHeader nativeFileMenuCreated={nativeFileMenuCreated} />
      <div className="overflow-hidden self-stretch w-full flex-1 home-layout max-w-4xl lg:max-w-5xl xl:max-w-7xl px-4 mx-auto mt-8 lg:mt-24 lg:px-0">
        <HomeHeader
          tabSelected={tabSelected}
          onChangeHomeSearchBar={searchAgainst(items)}
          onChangeTab={onChangeTab}
          sortBy={sortBy}
          setSearchParams={setSearchParams}
          settings={settings}
          readWriteProjectDir={readWriteProjectDir}
          className="col-start-2 -col-end-1"
        />
        <aside className="lg:row-start-1 -row-end-1 grid sm:grid-cols-2 md:mb-12 lg:flex flex-col justify-between">
          <ul className="flex flex-col">
            {needsToOnboard(location, onboardingStatus) && (
              <li className="flex group">
                <ActionButton
                  Element="button"
                  onClick={() => {
                    acceptOnboarding({
                      onboardingStatus,
                      navigate,
                      codeManager,
                      kclManager,
                    }).catch(reportRejection)
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
                  onClick={onDismissOnboardingInvite}
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
                <Tooltip position="bottom-left">
                  <div className="text-sm flex flex-col max-w-xs">
                    <div className="text-xs flex justify-center item-center gap-1 pb-1 border-b border-chalkboard-50">
                      <CustomIcon name="beaker" className="w-4 h-4" />
                      <span>Experimental</span>
                    </div>
                    <p className="pt-2 text-left">{ML_EXPERIMENTAL_MESSAGE}</p>
                  </div>
                </Tooltip>
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
                  <BillingDialog billingActor={billingActor} />
                </div>
              </li>
            )}
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
        <HomeItemsArea tabSelected={tabSelected} searchResults={searchResults} sortBy={sortBy} query={query} />
      </div>
      <StatusBar
        globalItems={[
          ...(isDesktop() ? [networkMachineStatus] : []),
          ...defaultGlobalStatusBarItems({ location, filePath: undefined }),
        ]}
        localItems={defaultLocalStatusBarItems}
      />
    </div>
  )
}

enum HomeTabKeys {
  Projects,
  Prompts,
}

interface HomeTabProps {
  onChange: (key: HomeTabKeys) => void
  selected: HomeTabKeys,
}

function HomeTab(props: HomeTabProps) {
  const [selected, setSelected] = useState(props.selected)

  const tabs = [
    { name: 'Projects', key: HomeTabKeys.Projects },
    { name: 'Prompts', key: HomeTabKeys.Prompts },
  ]

  const cssTab = 'cursor-pointer p-4'
  const cssActive = `${cssTab} border rounded bg-green`
  const cssInactive = `${cssTab}`

  const onClickTab = (key: HomeTabKeys) => () => {
    setSelected(key)
    props.onChange(key)
  }

  return <div className="flex flex-row">
    { tabs.map(
      (el) => <div
        className={el.key === selected ? cssActive : cssInactive}
        onClick={onClickTab(el.key)}>
        { el.name }
      </div>
    )}
  </div>
}

interface HomeHeaderProps extends HTMLProps<HTMLDivElement> {
  tabSelected: HomeTabKeys,
  onChangeHomeSearchBar: (query: string) => void
  onChangeTab: (key: HomeTabKeys) => void
  sortBy: string
  setSearchParams: (params: Record<string, string>) => void
  settings: ReturnType<typeof useSettings>
  readWriteProjectDir: ReadWriteProjectState
}

function HomeHeader({
  tabSelected,
  onChangeHomeSearchBar,
  onChangeTab,
  sortBy,
  setSearchParams,
  settings,
  readWriteProjectDir,
  ...rest
}: HomeHeaderProps) {
  const isSortByModified =
    sortBy?.includes('modified') || !sortBy || sortBy === null

  return (
    <section {...rest}>
      <div className="flex flex-col md:flex-row gap-4 justify-between md:items-center select-none">
        <div className="flex gap-8 items-center">
          <HomeTab onChange={onChangeTab} selected={tabSelected} />
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <HomeSearchBar onChange={onChangeHomeSearchBar} />
          <div className="flex gap-2 items-center">
            <small>Sort by</small>
            <ActionButton
              Element="button"
              data-testid="home-sort-by-name"
              className={`text-xs border-primary/10 ${
                !sortBy.includes('name')
                  ? 'text-chalkboard-80 dark:text-chalkboard-40'
                  : ''
              }`}
              onClick={() =>
                setSearchParams(getNextSearchParams(sortBy, 'name'))
              }
              iconStart={{
                icon: getSortIcon(sortBy, 'name'),
                bgClassName: 'bg-transparent',
                iconClassName: !sortBy.includes('name')
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
                setSearchParams(getNextSearchParams(sortBy, 'modified'))
              }
              iconStart={{
                icon: sortBy ? getSortIcon(sortBy, 'modified') : 'arrowDown',
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

function NoResults() {
  return <div className="col-start-2 -col-end-1 w-full flex flex-col justify-center items-center">No results.</div>
}

interface HomeItemsAreaProps {
  tabSelected: HomeTabKeys,
  searchResults: HomeItems
  sortBy: string
  query: string
}

function HomeItemsArea(props: HomeItemsAreaProps) {
  let grid = null

  switch (props.tabSelected) {
    case HomeTabKeys.Projects:
     grid = areHomeItemsProjects(props.searchResults)
        ? <ResultGridProjects
            searchResults={props.searchResults}
            query={props.query}
            sortBy={props.sortBy}
        />
        : <NoResults />
      break
    case HomeTabKeys.Prompts:
      grid = areHomeItemsPrompts(props.searchResults)
        ? <ResultGridPrompts
            searchResults={props.searchResults}
            query={props.query}
            sortBy={props.sortBy}
          />
        : <NoResults />
      break
    default:
      const _ex: never = props.tabSelected
  }

  return  <div className="flex-1 col-start-2 -col-end-1 overflow-y-auto pr-2 pb-24">
    { grid }
  </div>
}

interface ResultGridProjectsProps {
  searchResults: Prompt[],
  query: string
  sortBy: string
}

function ResultGridPrompts(props) {
  return <div>
    {props.searchResults.map(
      (el) => <div key={el.prompt}>
        { el.prompt }
      </div>
    )}
  </div>
}

interface ResultGridProjectsProps extends HTMLProps<HTMLDivElement> {
  searchResults: Project[],
  query: string
  sortBy: string
}

function ResultGridProjects(props: ResultGridProjectsProps) {
  const state = useSystemIOState()

  return (
    <section data-testid="home-section" className={props.className}>
      {state.matches(SystemIOMachineStates.readingFolders) ? (
        <Loading isDummy={true}>Loading your Projects...</Loading>
      ) : (
        <>
          {props.searchResults.length > 0 ? (
            <ul className="grid w-full sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              { (props.searchResults ?? [])
                .sort(getSortFunction(props.sortBy))
                .map((item) =>
                    <ProjectCard
                      key={item.name}
                      project={item}
                      handleRenameProject={handleRenameProject}
                      handleDeleteProject={handleDeleteProject}
                    />
                )}
            </ul>
          ) : (
            <p className="p-4 my-8 border border-dashed rounded border-chalkboard-30 dark:border-chalkboard-70">
              No results found
              {items.length === 0
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
