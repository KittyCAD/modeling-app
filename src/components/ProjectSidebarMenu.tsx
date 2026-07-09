import { Popover, Transition } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import type { ActionButtonProps } from '@src/components/ActionButton'
import { ActionButton } from '@src/components/ActionButton'
import { useCloudSyncProjectConflict } from '@src/components/CloudConflictDialog'
import { CustomIcon } from '@src/components/CustomIcon'
import { Logo } from '@src/components/Logo'
import Tooltip from '@src/components/Tooltip'
import usePlatform from '@src/hooks/usePlatform'
import type { App } from '@src/lib/app'
import { sendAddFileToProjectCommandForCurrentProject } from '@src/lib/commandBarConfigs/applicationCommandConfig'
import { APP_NAME } from '@src/lib/constants'
import { hotkeyDisplay } from '@src/lib/hotkeys'
import { isDesktop } from '@src/lib/isDesktop'
import { getProjectRelativeFilePath, PATHS } from '@src/lib/paths'
import type { FileEntry, Project } from '@src/lib/project'
import { getProjectDisplayName } from '@src/lib/projectDisplayName'
import type { IndexLoaderData } from '@src/lib/types'
import {
  findKeymapItemForCommand,
  keymapKeystrokesDisplay,
  keymapScopesValueSpec,
  keymapService,
} from '@src/registry/contracts/keymap'
import {
  type ProjectExplorerProjectMenuItem,
  type ProjectExplorerProjectMenuItemContext,
  projectExplorerProjectMenuItemsValueSpec,
} from '@src/registry/contracts/projectExplorer'
import { useSelector } from '@xstate/react'
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { SnapshotFrom } from 'xstate'

interface ProjectSidebarMenuProps extends React.PropsWithChildren {
  enableMenu?: boolean
  project?: Project
  file?: FileEntry
  hasCloudSyncFeature?: boolean
  app?: App
  absoluteFilePath?: string
  onProjectClose?: ProjectCloseHandler
  onHomeNavigate?: () => void
}

type ProjectCloseHandler = (
  file: FileEntry | null,
  projectPath: string | null,
  redirect: boolean
) => void
type ProjectMenuItem =
  | ActionButtonProps
  | {
      kind: 'contributed'
      item: ProjectExplorerProjectMenuItem
      context: ProjectExplorerProjectMenuItemContext
    }
  | {
      kind: 'break'
      id: string
    }
  | null

function isContributedProjectMenuItem(
  item: Exclude<ProjectMenuItem, null>
): item is Extract<Exclude<ProjectMenuItem, null>, { kind: 'contributed' }> {
  return (
    typeof item === 'object' && 'kind' in item && item.kind === 'contributed'
  )
}

function isProjectMenuBreak(
  item: Exclude<ProjectMenuItem, null>
): item is Extract<Exclude<ProjectMenuItem, null>, { kind: 'break' }> {
  return typeof item === 'object' && 'kind' in item && item.kind === 'break'
}

const noopProjectClose: ProjectCloseHandler = () => undefined
const noopHomeNavigate = () => undefined

export function canNavigateHome({
  isDesktopApp,
  hasCloudSyncFeature,
}: {
  isDesktopApp: boolean
  hasCloudSyncFeature: boolean
}) {
  return isDesktopApp || hasCloudSyncFeature
}

const ProjectSidebarMenu = ({
  project,
  file,
  enableMenu = false,
  hasCloudSyncFeature = false,
  app,
  absoluteFilePath,
  onProjectClose = noopProjectClose,
  onHomeNavigate = noopHomeNavigate,
  children,
}: ProjectSidebarMenuProps) => {
  // Make room for traffic lights on desktop left side.
  // TODO: make sure this doesn't look like shit on Linux or Windows
  const trafficLightsOffset = window.electron?.os.isMac ? 'ml-20' : ''
  const homeNavigationEnabled = canNavigateHome({
    isDesktopApp: isDesktop(),
    hasCloudSyncFeature,
  })
  const projectDisplayName = project ? getProjectDisplayName(project) : APP_NAME

  return (
    <div className={`!no-underline flex min-w-0 gap-2 ${trafficLightsOffset}`}>
      <div className="relative group/home">
        <AppLogoLink
          project={project}
          file={file}
          enabled={homeNavigationEnabled}
          onProjectClose={onProjectClose}
          onHomeNavigate={onHomeNavigate}
        />
        {homeNavigationEnabled && (
          <Tooltip position="bottom-left">Go home</Tooltip>
        )}
      </div>
      {enableMenu ? (
        app ? (
          <ProjectMenuPopover
            app={app}
            project={project}
            file={file}
            filePath={absoluteFilePath}
            homeNavigationEnabled={homeNavigationEnabled}
            onProjectClose={onProjectClose}
            onHomeNavigate={onHomeNavigate}
          />
        ) : null
      ) : (
        <span
          className="hidden self-center px-2 select-none cursor-default text-sm text-chalkboard-110 dark:text-chalkboard-20 whitespace-nowrap lg:block"
          data-testid="project-name"
        >
          {projectDisplayName}
        </span>
      )}
      {children}
    </div>
  )
}

function AppLogoLink({
  project,
  file,
  enabled,
  onProjectClose,
  onHomeNavigate,
}: {
  project?: IndexLoaderData['project']
  file?: IndexLoaderData['file']
  enabled: boolean
  onProjectClose: ProjectCloseHandler
  onHomeNavigate: () => void
}) {
  const wrapperClassName =
    "cursor-pointer relative group-hover/home:before:outline h-full grid flex-none place-content-center group p-1.5 before:block before:content-[''] before:absolute before:inset-0 before:bottom-1 before:z-[-1] before:bg-primary before:rounded-b-sm"
  const logoClassName = 'w-auto h-4 text-chalkboard-10'

  if (!enabled) {
    return (
      <div
        data-testid="app-logo"
        className="relative h-full grid flex-none place-content-center group p-1.5 before:block before:content-[''] before:absolute before:inset-0 before:bottom-1 before:z-[-1] before:bg-primary before:rounded-b-sm"
      >
        <Logo data-onboarding-id="app-logo" className={logoClassName} />
        <span className="sr-only">{APP_NAME}</span>
      </div>
    )
  }

  return (
    <Link
      data-testid="app-logo"
      onClick={() => {
        onProjectClose(file || null, project?.path || null, false)
        onHomeNavigate()
      }}
      to={PATHS.HOME}
      className={`${wrapperClassName} hover:before:brightness-110`}
    >
      <Logo data-onboarding-id="app-logo" className={logoClassName} />
      <span className="sr-only">{APP_NAME}</span>
    </Link>
  )
}

function ProjectMenuPopover({
  app,
  project,
  file,
  filePath,
  homeNavigationEnabled,
  onProjectClose,
  onHomeNavigate,
}: {
  app: App
  project?: IndexLoaderData['project']
  file?: IndexLoaderData['file']
  filePath?: string
  homeNavigationEnabled: boolean
  onProjectClose: ProjectCloseHandler
  onHomeNavigate: () => void
}) {
  useSignals()
  const { machineManager, commands, settings } = app
  const machineApiEnabled = settings.useSettings().app.machineApi.current
  const platform = usePlatform()
  const navigate = useNavigate()
  const keymap = app.registry.optional(keymapService)
  const projectSettingsKeybinding = keymapKeystrokesDisplay(
    keymap
      ? findKeymapItemForCommand(
          keymap.keymap.value,
          'zds.settings.open',
          keymap.getCurrentScopes(),
          app.registry.signal(keymapScopesValueSpec).value
        )?.keystrokes
      : [`mod+${isDesktop() ? '' : 'shift'}+,`],
    platform
  )
  const cloudConflictMetadata = useCloudSyncProjectConflict(project?.path)
  const commandsSelector = (state: SnapshotFrom<typeof commands.actor>) =>
    state.context.commands
  const commandList = useSelector(commands.actor, commandsSelector)
  const projectPath = project?.path
  const contributedProjectMenuItems = app.registry.signal(
    projectExplorerProjectMenuItemsValueSpec
  ).value

  const exportCommandInfo = { name: 'Export', groupId: 'modeling' }
  const exportProjectZipCommandInfo = {
    name: 'export-project-zip',
    groupId: 'application',
  }
  const makeCommandInfo = { name: 'Make', groupId: 'modeling' }
  const findCommand = useCallback(
    (obj: { name: string; groupId: string }) =>
      Boolean(
        commandList.find(
          (c) => c.name === obj.name && c.groupId === obj.groupId
        )
      ),
    [commandList]
  )
  const machineCount = machineManager.machines.length

  // We filter this memoized list so that no orphan "break" elements are rendered.
  const projectMenuItems = useMemo<Exclude<ProjectMenuItem, null>[]>(
    () => {
      const items: ProjectMenuItem[] = [
        {
          id: 'settings',
          Element: 'button' as const,
          children: (
            <>
              <span className="flex-1" data-testid="project-settings">
                Project settings
              </span>
              {projectSettingsKeybinding && (
                <kbd className="hotkey">{projectSettingsKeybinding}</kbd>
              )}
            </>
          ),
          onClick: () => {
            const targetPath =
              filePath !== undefined
                ? filePath + PATHS.SETTINGS_PROJECT
                : PATHS.HOME + PATHS.SETTINGS_PROJECT
            void navigate(targetPath)
          },
        },
        { kind: 'break', id: 'after-settings' },
        ...contributedProjectMenuItems.flatMap<ProjectMenuItem>((item) => {
          if (!projectPath || !project) {
            return []
          }

          const context = { projectPath, project }
          if (item.Component) {
            return [{ kind: 'contributed' as const, item, context }]
          }

          if (item.isVisible && !item.isVisible(context)) {
            return []
          }

          const disabled =
            typeof item.disabled === 'function'
              ? item.disabled(context)
              : item.disabled
          const label =
            typeof item.label === 'function' ? item.label(context) : item.label
          const dataTestId =
            typeof item.dataTestId === 'function'
              ? item.dataTestId(context)
              : item.dataTestId
          const className =
            typeof item.className === 'function'
              ? item.className(context)
              : item.className

          return [
            {
              id: item.id,
              Element: 'button' as const,
              className,
              children: (
                <span className="flex-1" data-testid={dataTestId}>
                  {label}
                </span>
              ),
              disabled,
              onClick: () => item.onSelect?.(context),
            },
          ]
        }),
        {
          id: 'importFile',
          Element: 'button' as const,
          children: (
            <>
              <span className="flex-1">Add file to project</span>
              <kbd className="hotkey">
                {hotkeyDisplay('mod+alt+l', platform)}
              </kbd>
            </>
          ),
          onClick: () =>
            sendAddFileToProjectCommandForCurrentProject(
              settings.actor,
              commands.actor
            ),
        },
        {
          id: 'export',
          Element: 'button' as const,
          children: (
            <>
              <span className="flex-1">Export current part</span>
              <kbd className="hotkey">
                {hotkeyDisplay('ctrl+shift+e', platform)}
              </kbd>
              {!findCommand(exportCommandInfo) && (
                <Tooltip
                  position="right"
                  wrapperClassName="!max-w-none min-w-fit"
                >
                  Awaiting engine connection
                </Tooltip>
              )}
            </>
          ),
          disabled: !findCommand(exportCommandInfo),
          onClick: () =>
            commands.send({
              type: 'Find and select command',
              data: exportCommandInfo,
            }),
        },
        {
          id: 'download-project-zip',
          Element: 'button' as const,
          className: isDesktop() ? 'hidden' : '',
          children: (
            <>
              <span className="flex-1">Download project files</span>
              {!findCommand(exportProjectZipCommandInfo) && (
                <Tooltip
                  position="right"
                  wrapperClassName="!max-w-none min-w-fit"
                >
                  Project export unavailable
                </Tooltip>
              )}
            </>
          ),
          disabled: !findCommand(exportProjectZipCommandInfo),
          onClick: () =>
            commands.send({
              type: 'Find and select command',
              data: exportProjectZipCommandInfo,
            }),
        },
        {
          id: 'make',
          Element: 'button' as const,
          className: !isDesktop() || !machineApiEnabled ? 'hidden' : '',
          children: (
            <>
              <span>Make current part</span>
              {!findCommand(makeCommandInfo) && (
                <Tooltip
                  position="right"
                  wrapperClassName="!max-w-none min-w-fit"
                >
                  Awaiting engine connection
                </Tooltip>
              )}
            </>
          ),
          disabled: !findCommand(makeCommandInfo) || machineCount === 0,
          onClick: () => {
            commands.send({
              type: 'Find and select command',
              data: makeCommandInfo,
            })
          },
        },
        { kind: 'break', id: 'before-go-home' },
        {
          id: 'go-home',
          Element: 'button' as const,
          children: 'Go to Home',
          className: !homeNavigationEnabled ? 'hidden' : '',
          onClick: () => {
            onProjectClose(file || null, project?.path || null, true)
            onHomeNavigate()
          },
        },
      ]
      return items.filter((props): props is Exclude<ProjectMenuItem, null> => {
        if (!props) {
          return false
        }
        if (isProjectMenuBreak(props)) {
          return true
        }
        if (isContributedProjectMenuItem(props)) {
          return true
        }
        return !props.className?.includes('hidden')
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    [
      platform,
      findCommand,
      machineApiEnabled,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      commands.send,
      onHomeNavigate,
      onProjectClose,
      homeNavigationEnabled,
      projectPath,
      project,
      contributedProjectMenuItems,
      commands.actor,
      file,
      filePath,
      machineCount,
      navigate,
      projectSettingsKeybinding,
      settings.actor,
    ]
  )

  const menuItemClassName =
    'relative !font-sans flex items-center gap-2 rounded-sm py-1.5 px-2 cursor-pointer hover:bg-chalkboard-20 dark:hover:bg-chalkboard-80 border-none text-left '

  return (
    <Popover className="relative min-w-0">
      <ProjectBreadcrumbButton
        project={project}
        file={file}
        hasCloudConflict={Boolean(cloudConflictMetadata)}
      />

      <Transition
        enter="duration-100 ease-out"
        enterFrom="opacity-0 -translate-y-2"
        enterTo="opacity-100 translate-y-0"
        as={Fragment}
      >
        <Popover.Panel
          className={`z-10 absolute top-full left-0 mt-1 pb-1 w-52 bg-chalkboard-10 dark:bg-chalkboard-90
          border border-solid border-chalkboard-20 dark:border-chalkboard-90 rounded
          shadow-lg`}
        >
          {({ close }) => (
            <ul className="relative flex flex-col items-stretch content-stretch p-0.5">
              {projectMenuItems.map((props, index) => {
                if (isProjectMenuBreak(props)) {
                  return index !== projectMenuItems.length - 1 ? (
                    <li key={props.id} className="contents">
                      <hr className="border-chalkboard-20 dark:border-chalkboard-80" />
                    </li>
                  ) : null
                }

                if (isContributedProjectMenuItem(props)) {
                  const Component = props.item.Component
                  return Component ? (
                    <Component
                      key={props.item.id}
                      context={props.context}
                      className={menuItemClassName}
                      close={close}
                    />
                  ) : null
                }

                const { id, className, children, ...rest } = props
                return (
                  <li key={id} className="contents">
                    <ActionButton
                      {...rest}
                      className={menuItemClassName + (className ?? '')}
                      onMouseUp={() => {
                        close()
                      }}
                    >
                      {children}
                    </ActionButton>
                  </li>
                )
              })}
            </ul>
          )}
        </Popover.Panel>
      </Transition>
    </Popover>
  )
}

export function ProjectBreadcrumbButton({
  project,
  file,
  hasCloudConflict = false,
}: {
  project?: IndexLoaderData['project']
  file?: IndexLoaderData['file']
  hasCloudConflict?: boolean
}) {
  // Breadcrumb for project and project-relative file path
  const relativeFilePath = getProjectRelativeFilePath(project, file)
  const formattedRelativeFilePath = relativeFilePath.replaceAll('/', ' / ')
  const projectDisplayName = project ? getProjectDisplayName(project) : ''
  const breadCrumb = {
    projectName: projectDisplayName,
    sep: ' / ',
    filePath: formattedRelativeFilePath,
  }
  const breadCrumbTooltip = breadCrumb.projectName
    ? `${breadCrumb.projectName}${breadCrumb.sep}${breadCrumb.filePath}`
    : breadCrumb.filePath
  const projectNameRef = useRef<HTMLSpanElement>(null)
  const filePathRef = useRef<HTMLSpanElement>(null)
  const [isBreadCrumbTruncated, setIsBreadCrumbTruncated] = useState(false)

  useEffect(() => {
    const isTruncated = (element: HTMLElement | null) =>
      Boolean(element && element.scrollWidth > element.clientWidth)

    const updateTruncatedState = () => {
      setIsBreadCrumbTruncated(
        isTruncated(projectNameRef.current) || isTruncated(filePathRef.current)
      )
    }

    updateTruncatedState()

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(updateTruncatedState)
        : null

    if (projectNameRef.current) {
      resizeObserver?.observe(projectNameRef.current)
    }
    if (filePathRef.current) {
      resizeObserver?.observe(filePathRef.current)
    }

    window.addEventListener('resize', updateTruncatedState)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateTruncatedState)
    }
  })

  return (
    <Popover.Button
      className="gap-1 rounded-sm mr-auto max-h-min min-w-0 max-w-full border-0 py-1 px-2 flex items-center focus-visible:outline-appForeground dark:hover:bg-chalkboard-90"
      data-testid="project-sidebar-toggle"
    >
      <div className="flex min-w-0 items-baseline py-0.5 text-sm">
        {project && (
          <>
            <span
              ref={projectNameRef}
              className="hidden whitespace-nowrap md:block max-w-80 truncate"
              data-testid="app-header-project-name"
            >
              {breadCrumb.projectName}
            </span>
            <span className="hidden whitespace-pre md:inline">
              {breadCrumb.sep}
            </span>
          </>
        )}
        <span
          ref={filePathRef}
          className="min-w-0 truncate text-sm text-chalkboard-110 dark:text-chalkboard-20 whitespace-nowrap"
          data-testid="app-header-file-name"
        >
          {breadCrumb.filePath}
        </span>
      </div>
      {hasCloudConflict && (
        <span
          className="hidden shrink-0 rounded bg-warn-20 px-1.5 py-0.5 text-[10px] font-medium leading-none text-warn-90 dark:bg-warn-80 dark:text-warn-10 sm:inline-flex"
          data-testid="project-sidebar-cloud-conflict-badge"
        >
          Cloud conflict
        </span>
      )}
      <CustomIcon
        name="caretDown"
        className="w-4 h-4 shrink-0 text-chalkboard-70 dark:text-chalkboard-40 ui-open:rotate-180"
      />
      {isBreadCrumbTruncated && (
        <Tooltip
          position="bottom-left"
          hoverOnly
          contentClassName="max-w-[min(80vw,48rem)] break-all text-left"
        >
          {breadCrumbTooltip}
        </Tooltip>
      )}
    </Popover.Button>
  )
}

export default ProjectSidebarMenu
