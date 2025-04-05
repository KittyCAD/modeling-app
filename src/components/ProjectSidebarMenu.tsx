import { Popover, Transition } from '@headlessui/react'
import { useSelector } from '@xstate/react'
import { Fragment, useContext, useMemo } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { SnapshotFrom } from 'xstate'

import type { ActionButtonProps } from '@src/components/ActionButton'
import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import { Logo } from '@src/components/Logo'
import { useLspContext } from '@src/components/LspProvider'
import { MachineManagerContext } from '@src/components/MachineManagerProvider'
import Tooltip from '@src/components/Tooltip'
import { useAbsoluteFilePath } from '@src/hooks/useAbsoluteFilePath'
import usePlatform from '@src/hooks/usePlatform'
import { APP_NAME } from '@src/lib/constants'
import { isDesktop } from '@src/lib/isDesktop'
import { copyFileShareLink } from '@src/lib/links'
import { PATHS } from '@src/lib/paths'
import {
  codeManager,
  engineCommandManager,
  kclManager,
} from '@src/lib/singletons'
import { type IndexLoaderData } from '@src/lib/types'
import { useToken } from '@src/machines/appMachine'
import { commandBarActor } from '@src/machines/commandBarMachine'

const ProjectSidebarMenu = ({
  project,
  file,
  enableMenu = false,
}: {
  enableMenu?: boolean
  project?: IndexLoaderData['project']
  file?: IndexLoaderData['file']
}) => {
  // Make room for traffic lights on desktop left side.
  // TODO: make sure this doesn't look like shit on Linux or Windows
  const trafficLightsOffset =
    isDesktop() && window.electron.os.isMac ? 'ml-20' : ''
  return (
    <div
      className={
        '!no-underline h-full mr-auto max-h-min min-h-12 min-w-max flex items-center gap-2 ' +
        trafficLightsOffset
      }
    >
      <AppLogoLink project={project} file={file} />
      {enableMenu ? (
        <ProjectMenuPopover project={project} file={file} />
      ) : (
        <span
          className="hidden select-none cursor-default text-sm text-chalkboard-110 dark:text-chalkboard-20 whitespace-nowrap lg:block"
          data-testid="project-name"
        >
          {project?.name ? project.name : APP_NAME}
        </span>
      )}
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
  const { onProjectClose } = useLspContext()
  const wrapperClassName =
    "relative h-full grid place-content-center group p-1.5 before:block before:content-[''] before:absolute before:inset-0 before:bottom-2.5 before:z-[-1] before:bg-primary before:rounded-b-sm"
  const logoClassName = 'w-auto h-4 text-chalkboard-10'

  return isDesktop() ? (
    <Link
      data-testid="app-logo"
      onClick={() => {
        onProjectClose(file || null, project?.path || null, false)
        kclManager.switchedFiles = true
      }}
      to={PATHS.HOME}
      className={wrapperClassName + ' hover:before:brightness-110'}
    >
      <Logo className={logoClassName} />
      <span className="sr-only">{APP_NAME}</span>
    </Link>
  ) : (
    <div className={wrapperClassName} data-testid="app-logo">
      <Logo className={logoClassName} />
      <span className="sr-only">{APP_NAME}</span>
    </div>
  )
}

const commandsSelector = (state: SnapshotFrom<typeof commandBarActor>) =>
  state.context.commands

function ProjectMenuPopover({
  project,
  file,
}: {
  project?: IndexLoaderData['project']
  file?: IndexLoaderData['file']
}) {
  const platform = usePlatform()
  const location = useLocation()
  const navigate = useNavigate()
  const filePath = useAbsoluteFilePath()
  const token = useToken()
  const machineManager = useContext(MachineManagerContext)
  const commands = useSelector(commandBarActor, commandsSelector)

  const { onProjectClose } = useLspContext()
  const insertCommandInfo = { name: 'Insert', groupId: 'code' }
  const exportCommandInfo = { name: 'Export', groupId: 'modeling' }
  const makeCommandInfo = { name: 'Make', groupId: 'modeling' }
  const shareCommandInfo = { name: 'share-file-link', groupId: 'code' }
  const findCommand = (obj: { name: string; groupId: string }) =>
    Boolean(
      commands.find((c) => c.name === obj.name && c.groupId === obj.groupId)
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
              <span className="flex-1">Project settings</span>
              <kbd className="hotkey">{`${platform === 'macos' ? '⌘' : 'Ctrl'}${
                isDesktop() ? '' : '⬆'
              },`}</kbd>
            </>
          ),
          onClick: () => {
            const targetPath = location.pathname.includes(PATHS.FILE)
              ? filePath + PATHS.SETTINGS_PROJECT
              : PATHS.HOME + PATHS.SETTINGS_PROJECT
            navigate(targetPath)
          },
        },
        'break',
        {
          id: 'insert',
          Element: 'button',
          children: (
            <>
              <span>Insert from project file</span>
              {!findCommand(insertCommandInfo) && (
                <Tooltip
                  position="right"
                  wrapperClassName="!max-w-none min-w-fit"
                >
                  Awaiting engine connection
                </Tooltip>
              )}
            </>
          ),
          disabled: !findCommand(insertCommandInfo),
          onClick: () =>
            commandBarActor.send({
              type: 'Find and select command',
              data: insertCommandInfo,
            }),
        },
        {
          id: 'export',
          Element: 'button',
          children: (
            <>
              <span>Export current part</span>
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
            commandBarActor.send({
              type: 'Find and select command',
              data: exportCommandInfo,
            }),
        },
        {
          id: 'make',
          Element: 'button',
          className: !isDesktop() ? 'hidden' : '',
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
            commandBarActor.send({
              type: 'Find and select command',
              data: makeCommandInfo,
            })
          },
        },
        {
          id: 'share-link',
          Element: 'button',
          children: 'Share current part (via Zoo link)',
          disabled: !findCommand(shareCommandInfo),
          onClick: async () => {
            await copyFileShareLink({
              token: token ?? '',
              code: codeManager.code,
              name: project?.name || '',
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
            kclManager.switchedFiles = true
          },
        },
      ].filter(
        (props) =>
          props === 'break' ||
          (typeof props !== 'string' && !props.className?.includes('hidden'))
      ) as (ActionButtonProps | 'break')[],
    [
      platform,
      findCommand,
      commandBarActor.send,
      engineCommandManager,
      onProjectClose,
      isDesktop,
    ]
  )

  return (
    <Popover className="relative">
      <Popover.Button
        className="gap-1 rounded-sm h-9 mr-auto max-h-min min-w-max border-0 py-1 px-2 flex items-center  focus-visible:outline-appForeground dark:hover:bg-chalkboard-90"
        data-testid="project-sidebar-toggle"
      >
        <div className="flex flex-col items-start py-0.5">
          <span className="hidden text-sm text-chalkboard-110 dark:text-chalkboard-20 whitespace-nowrap lg:block">
            {isDesktop() && file?.name
              ? file.name.slice(
                  file.name.lastIndexOf(window.electron.path.sep) + 1
                )
              : APP_NAME}
          </span>
          {isDesktop() && project?.name && (
            <span className="hidden text-xs text-chalkboard-70 dark:text-chalkboard-40 whitespace-nowrap lg:block">
              {project.name}
            </span>
          )}
        </div>
        <CustomIcon
          name="caretDown"
          className="w-4 h-4 text-chalkboard-70 dark:text-chalkboard-40 ui-open:rotate-180"
        />
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
