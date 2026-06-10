import { Popover, Transition } from '@headlessui/react'
import { useSelector } from '@xstate/react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { SnapshotFrom } from 'xstate'

import type { ActionButtonProps } from '@src/components/ActionButton'
import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import { Logo } from '@src/components/Logo'
import { useLspContext } from '@src/components/LspProvider'
import Tooltip from '@src/components/Tooltip'
import { useAbsoluteFilePath } from '@src/hooks/useAbsoluteFilePath'
import usePlatform from '@src/hooks/usePlatform'
import { useApp, useSingletons } from '@src/lib/boot'
import { sendAddFileToProjectCommandForCurrentProject } from '@src/lib/commandBarConfigs/applicationCommandConfig'
import { APP_NAME } from '@src/lib/constants'
import { hotkeyDisplay } from '@src/lib/hotkeys'
import { isDesktop } from '@src/lib/isDesktop'
import { PATHS, getProjectRelativeFilePath } from '@src/lib/paths'
import type { FileEntry, Project } from '@src/lib/project'
import type { IndexLoaderData } from '@src/lib/types'

interface ProjectSidebarMenuProps extends React.PropsWithChildren {
  enableMenu?: boolean
  project?: Project
  file?: FileEntry
}

const ProjectSidebarMenu = ({
  project,
  file,
  enableMenu = false,
  children,
}: ProjectSidebarMenuProps) => {
  // Make room for traffic lights on desktop left side.
  // TODO: make sure this doesn't look like shit on Linux or Windows
  const trafficLightsOffset =
    window.electron && window.electron.os.isMac ? 'ml-20' : ''
  return (
    <div className={'!no-underline flex min-w-0 gap-2 ' + trafficLightsOffset}>
      <div className="relative group/home">
        <AppLogoLink project={project} file={file} />
        {isDesktop() && <Tooltip position="bottom-left">Go home</Tooltip>}
      </div>
      {enableMenu ? (
        <ProjectMenuPopover project={project} file={file} />
      ) : (
        <span
          className="hidden self-center px-2 select-none cursor-default text-sm text-chalkboard-110 dark:text-chalkboard-20 whitespace-nowrap lg:block"
          data-testid="project-name"
        >
          {project?.name ? project.name : APP_NAME}
        </span>
      )}
      {children}
    </div>
  )
}

function AppLogoLink({
  project,
  file,
}: {
  project?: IndexLoaderData['project']
  file?: IndexLoaderData['file']
}) {
  const { executingEditor } = useSingletons()
  const { onProjectClose } = useLspContext()
  const wrapperClassName =
    "cursor-pointer relative group-hover/home:before:outline h-full grid flex-none place-content-center group p-1.5 before:block before:content-[''] before:absolute before:inset-0 before:bottom-1 before:z-[-1] before:bg-primary before:rounded-b-sm"
  const logoClassName = 'w-auto h-4 text-chalkboard-10'

  if (!window.electron) {
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
        executingEditor.switchedFiles = true
      }}
      to={PATHS.HOME}
      className={wrapperClassName + ' hover:before:brightness-110'}
    >
      <Logo data-onboarding-id="app-logo" className={logoClassName} />
      <span className="sr-only">{APP_NAME}</span>
    </Link>
  )
}

function ProjectMenuPopover({
  project,
  file,
}: {
  project?: IndexLoaderData['project']
  file?: IndexLoaderData['file']
}) {
  const { machineManager, commands, settings } = useApp()
  const { executingEditor } = useSingletons()
  const machineApiEnabled = settings.useSettings().app.machineApi.current
  const platform = usePlatform()
  const navigate = useNavigate()
  const filePath = useAbsoluteFilePath()
  const commandsSelector = (state: SnapshotFrom<typeof commands.actor>) =>
    state.context.commands
  const commandList = useSelector(commands.actor, commandsSelector)

  const { onProjectClose } = useLspContext()
  const exportCommandInfo = { name: 'Export', groupId: 'modeling' }
  const exportProjectZipCommandInfo = {
    name: 'export-project-zip',
    groupId: 'application',
  }
  const makeCommandInfo = { name: 'Make', groupId: 'modeling' }
  const findCommand = (obj: { name: string; groupId: string }) =>
    Boolean(
      commandList.find((c) => c.name === obj.name && c.groupId === obj.groupId)
    )
  const machineCount = machineManager.machines.length

  // We filter this memoized list so that no orphan "break" elements are rendered.
  const projectMenuItems = useMemo<(ActionButtonProps | 'break')[]>(
    () =>
      [
        {
          id: 'settings',
          Element: 'button',
          children: (
            <>
              <span className="flex-1" data-testid="project-settings">
                Project settings
              </span>
              <kbd className="hotkey">
                {hotkeyDisplay(`mod+${isDesktop() ? '' : 'shift'}+,`, platform)}
              </kbd>
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
        'break',
        {
          id: 'importFile',
          Element: 'button',
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
          Element: 'button',
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
          Element: 'button',
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
          Element: 'button',
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
        'break',
        {
          id: 'go-home',
          Element: 'button',
          children: 'Go to Home',
          className: !isDesktop() ? 'hidden' : '',
          onClick: () => {
            onProjectClose(file || null, project?.path || null, true)
            executingEditor.switchedFiles = true
          },
        },
      ].filter(
        (props) =>
          props === 'break' ||
          (typeof props !== 'string' && !props.className?.includes('hidden'))
      ) as (ActionButtonProps | 'break')[],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    [
      platform,
      findCommand,
      machineApiEnabled,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      commands.send,
      executingEditor.engineCommandManager,
      onProjectClose,
      isDesktop,
    ]
  )

  // Breadcrumb for project and project-relative file path
  const relativeFilePath = getProjectRelativeFilePath(project, file)
  const formattedRelativeFilePath = relativeFilePath.replaceAll('/', ' / ')
  const breadCrumb = {
    projectName: project?.name || '',
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
  }, [breadCrumb.filePath, breadCrumb.projectName])

  return (
    <Popover className="relative min-w-0">
      <Popover.Button
        className="gap-1 rounded-sm mr-auto max-h-min min-w-0 max-w-full border-0 py-1 px-2 flex items-center focus-visible:outline-appForeground dark:hover:bg-chalkboard-90"
        data-testid="project-sidebar-toggle"
      >
        <div className="flex min-w-0 items-baseline py-0.5 text-sm">
          {project?.name && (
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
                if (props === 'break') {
                  return index !== projectMenuItems.length - 1 ? (
                    <li key={`break-${index}`} className="contents">
                      <hr className="border-chalkboard-20 dark:border-chalkboard-80" />
                    </li>
                  ) : null
                }

                const { id, className, children, ...rest } = props
                return (
                  <li key={id} className="contents">
                    <ActionButton
                      {...rest}
                      className={
                        'relative !font-sans flex items-center gap-2 rounded-sm py-1.5 px-2 cursor-pointer hover:bg-chalkboard-20 dark:hover:bg-chalkboard-80 border-none text-left ' +
                        className
                      }
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

export default ProjectSidebarMenu
