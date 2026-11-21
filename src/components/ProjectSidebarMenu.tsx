import { Popover } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import {
  HeaderMenuItems,
  type HeaderMenuItem,
  type HeaderMenuAction,
  headerMenuItemClassName,
  headerMenuPanelClassName,
} from '@src/components/HeaderMenu'
import { ProjectNavigation } from '@src/components/ProjectNavigation'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import usePlatform from '@src/hooks/usePlatform'
import type { App } from '@src/lib/app'
import { selectCommand } from '@src/lib/commandUtils'
import { APP_NAME } from '@src/lib/constants'
import { hotkeyDisplay } from '@src/lib/hotkeys'
import { isDesktop } from '@src/lib/isDesktop'
import { getProjectRelativeFilePath, PATHS } from '@src/lib/paths'
import type { FileEntry, Project } from '@src/lib/project'
import { getProjectDisplayName } from '@src/lib/projectDisplayName'
import { reportRejection } from '@src/lib/trap'
import type { IndexLoaderData } from '@src/lib/types'
import {
  findKeymapItemForCommand,
  keymapKeystrokesDisplay,
  keymapScopesFacet,
  keymapService,
} from '@src/registry/contracts/keymap'
import {
  type ProjectExplorerProjectBreadcrumbBadge,
  type ProjectExplorerProjectBreadcrumbBadgeContext,
  projectExplorerProjectBreadcrumbBadgesFacet,
  projectExplorerProjectMenuItemsFacet,
} from '@src/registry/contracts/projectExplorer'
import { useSelector } from '@xstate/react'
import { useEffect, useRef, useState } from 'react'
// eslint-disable-next-line zds/no-react-router-hooks -- URL-state migration: project-menu navigation (useNavigate).
import { useNavigate } from 'react-router-dom'
import type { SnapshotFrom } from 'xstate'

type ProjectSidebarMenuProps = React.PropsWithChildren<
  {
    project?: Project
    file?: FileEntry
    absoluteFilePath?: string
    onProjectClose?: ProjectCloseHandler
    onHomeNavigate?: () => void
  } & ({ enableMenu: true; app: App } | { enableMenu?: false; app?: never })
>

type ProjectCloseHandler = (
  file: FileEntry | null,
  projectPath: string | null,
  redirect: boolean
) => void
type ProjectBreadcrumbBadgeItem = {
  item: ProjectExplorerProjectBreadcrumbBadge
  context: ProjectExplorerProjectBreadcrumbBadgeContext
}

const noopProjectClose: ProjectCloseHandler = () => undefined
const noopHomeNavigate = () => undefined
const projectMenuItemLabelClassName = 'min-w-0 flex-1 truncate'
const projectMenuItemHotkeyClassName = 'hotkey shrink-0'

const ProjectSidebarMenu = (props: ProjectSidebarMenuProps) => {
  const {
    project,
    file,
    absoluteFilePath,
    onProjectClose = noopProjectClose,
    onHomeNavigate = noopHomeNavigate,
    children,
  } = props
  const projectDisplayName = project ? getProjectDisplayName(project) : APP_NAME

  return (
    <div className="flex min-w-0 items-stretch gap-2">
      <ProjectNavigation
        onHomeNavigate={() => {
          onProjectClose(file ?? null, project?.path ?? null, false)
          onHomeNavigate()
        }}
      />
      {props.enableMenu ? (
        <ProjectMenuPopover
          app={props.app}
          project={project}
          file={file}
          filePath={absoluteFilePath}
          onProjectClose={onProjectClose}
          onHomeNavigate={onHomeNavigate}
        />
      ) : (
        <span
          className="hidden self-center px-2 select-none cursor-default text-sm text-default whitespace-nowrap lg:block"
          data-testid="project-name"
        >
          {projectDisplayName}
        </span>
      )}
      {children}
    </div>
  )
}

function ProjectMenuPopover({
  app,
  project,
  file,
  filePath,
  onProjectClose,
  onHomeNavigate,
}: {
  app: App
  project?: IndexLoaderData['project']
  file?: IndexLoaderData['file']
  filePath?: string
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
          app.registry.observe(keymapScopesFacet).value
        )?.keystrokes
      : [`mod+${isDesktop() ? '' : 'shift'}+,`],
    platform
  )
  const commandsSelector = (state: SnapshotFrom<typeof commands.actor>) =>
    state.context.commands
  const commandList = useSelector(commands.actor, commandsSelector)
  const projectPath = project?.path
  const contributedProjectMenuItems = app.registry.observe(
    projectExplorerProjectMenuItemsFacet
  ).value
  const contributedProjectBreadcrumbBadges = app.registry.observe(
    projectExplorerProjectBreadcrumbBadgesFacet
  ).value

  const exportCommand = { name: 'Export', groupId: 'modeling' }
  const zipCommand = { name: 'export-project-zip', groupId: 'application' }
  const makeCommand = { name: 'Make', groupId: 'modeling' }
  const hasCommand = ({ name, groupId }: { name: string; groupId: string }) =>
    commandList.some(
      (command) => command.name === name && command.groupId === groupId
    )
  const commandItem = (
    id: string,
    label: string,
    command: { name: string; groupId: string },
    shortcut?: string,
    unavailable = 'Awaiting engine connection'
  ): HeaderMenuAction & { Element: 'button' } => ({
    id,
    Element: 'button',
    disabled: !hasCommand(command),
    onClick: () => selectCommand(commands, command),
    children: (
      <>
        <span className={projectMenuItemLabelClassName}>{label}</span>
        {shortcut && (
          <kbd className={projectMenuItemHotkeyClassName}>
            {hotkeyDisplay(shortcut, platform)}
          </kbd>
        )}
        {!hasCommand(command) && (
          <Tooltip position="right" wrapperClassName="!max-w-none min-w-fit">
            {unavailable}
          </Tooltip>
        )}
      </>
    ),
  })
  const projectActions: HeaderMenuItem[] = []
  const footer: HeaderMenuItem[] = []
  if (project) {
    projectActions.push({
      id: 'duplicate-project',
      Element: 'button',
      children: (
        <span
          className={projectMenuItemLabelClassName}
          data-testid="project-sidebar-duplicate-project"
        >
          Duplicate project
        </span>
      ),
      onClick: () => {
        const editor = app.project?.executingEditor.value
        const path = app.project?.executingPath
        void app.projectOperations
          .duplicateProject(
            project,
            getProjectDisplayName(project),
            path ? { path, contents: editor?.code ?? '' } : undefined
          )
          .then((created) =>
            app.projectSession.openFile(created.path, {
              projectPath: created.path,
            })
          )
          .catch(reportRejection)
      },
    })
    const context = { project, projectPath: project.path }
    for (const item of contributedProjectMenuItems) {
      if (item.isVisible && !item.isVisible(context)) continue
      const target = item.placement === 'footer' ? footer : projectActions
      if (item.Component) {
        const Component = item.Component
        target.push({
          id: item.id,
          kind: 'custom',
          render: (close) => (
            <Component
              context={context}
              className={headerMenuItemClassName}
              close={close}
            />
          ),
        })
      } else {
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
        const disabled =
          typeof item.disabled === 'function'
            ? item.disabled(context)
            : item.disabled
        target.push({
          id: item.id,
          Element: 'button',
          className,
          disabled,
          children: (
            <span
              className={projectMenuItemLabelClassName}
              data-testid={dataTestId}
            >
              {label}
            </span>
          ),
          onClick: () => item.onSelect(context),
        })
      }
    }
  }
  const fileActions: HeaderMenuItem[] = [
    {
      id: 'importFile',
      Element: 'button',
      children: (
        <>
          <span className={projectMenuItemLabelClassName}>
            Add file to project
          </span>
          <kbd className={projectMenuItemHotkeyClassName}>
            {hotkeyDisplay('mod+alt+l', platform)}
          </kbd>
        </>
      ),
      onClick: () =>
        selectCommand(commands, {
          name: 'add-kcl-file-to-project',
          groupId: 'application',
          argDefaultValues: {
            method: 'existingProject',
            projectName: project?.name,
          },
        }),
    },
    commandItem('export', 'Export', exportCommand, 'ctrl+shift+e'),
  ]
  if (!isDesktop())
    fileActions.push(
      commandItem(
        'download-project-zip',
        'Download project files',
        zipCommand,
        undefined,
        'Project export unavailable'
      )
    )
  if (isDesktop() && machineApiEnabled)
    fileActions.push({
      ...commandItem('make', 'Make current part', makeCommand),
      disabled:
        !hasCommand(makeCommand) || machineManager.machines.length === 0,
    })
  const groups: HeaderMenuItem[][] = [
    [
      {
        id: 'settings',
        Element: 'button',
        children: (
          <>
            <span
              className={projectMenuItemLabelClassName}
              data-testid="project-settings"
            >
              Project settings
            </span>
            {projectSettingsKeybinding && (
              <kbd className={projectMenuItemHotkeyClassName}>
                {projectSettingsKeybinding}
              </kbd>
            )}
          </>
        ),
        onClick: () => {
          void navigate((filePath ?? PATHS.HOME) + PATHS.SETTINGS_PROJECT)
        },
      },
    ],
    projectActions,
    fileActions,
    [
      ...footer,
      {
        id: 'go-home',
        Element: 'button',
        children: 'Go to Home',
        onClick: () => {
          onProjectClose(file ?? null, project?.path ?? null, true)
          onHomeNavigate()
        },
      },
    ],
  ]
  const projectBreadcrumbBadges: ProjectBreadcrumbBadgeItem[] =
    project && projectPath
      ? contributedProjectBreadcrumbBadges
          .filter(
            (item) =>
              !item.isVisible || item.isVisible({ project, projectPath })
          )
          .map((item) => ({ item, context: { project, projectPath } }))
      : []
  return (
    <Popover className="relative min-w-0 self-center [-webkit-app-region:no-drag]">
      <ProjectBreadcrumbButton
        project={project}
        file={file}
        contributedBadges={projectBreadcrumbBadges}
      />
      <Popover.Panel
        data-testid="project-sidebar-menu"
        className={`${headerMenuPanelClassName} left-0`}
      >
        {({ close }) => <HeaderMenuItems groups={groups} close={close} />}
      </Popover.Panel>
    </Popover>
  )
}

export function ProjectBreadcrumbButton({
  project,
  file,
  contributedBadges = [],
}: {
  project?: IndexLoaderData['project']
  file?: IndexLoaderData['file']
  contributedBadges?: ProjectBreadcrumbBadgeItem[]
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
  const badgeClassName =
    'hidden shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none sm:inline-flex'

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
  }, [projectDisplayName, formattedRelativeFilePath])

  return (
    <Popover.Button
      className="gap-1 rounded-sm mr-auto max-h-min min-w-0 max-w-full border-0 py-1 px-2 flex items-center focus-visible:outline-appForeground hover:bg-3"
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
          className="min-w-0 truncate text-sm text-default whitespace-nowrap"
          data-testid="app-header-file-name"
        >
          {breadCrumb.filePath}
        </span>
      </div>
      {contributedBadges.map(({ item, context }) => {
        if (item.Component) {
          const Component = item.Component
          return (
            <Component
              key={item.id}
              context={context}
              className={badgeClassName}
            />
          )
        }

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

        return (
          <span
            key={item.id}
            className={`${badgeClassName} ${className ?? ''}`}
            data-testid={dataTestId}
          >
            {label}
          </span>
        )
      })}
      <CustomIcon
        name="caretDown"
        className="w-4 h-4 shrink-0 text-2 ui-open:rotate-180"
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
