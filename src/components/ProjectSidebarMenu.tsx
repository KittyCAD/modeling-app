import { Popover, Transition } from '@headlessui/react'
import { ActionButton, ActionButtonProps } from './ActionButton'
import { type IndexLoaderData } from 'lib/types'
import { paths } from 'lib/paths'
import { isTauri } from '../lib/isTauri'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Fragment, useMemo } from 'react'
import { sep } from '@tauri-apps/api/path'
import { Logo } from './Logo'
import { APP_NAME } from 'lib/constants'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { CustomIcon } from './CustomIcon'
import { useLspContext } from './LspProvider'
import { engineCommandManager } from 'lib/singletons'
import usePlatform from 'hooks/usePlatform'
import { useAbsoluteFilePath } from 'hooks/useAbsoluteFilePath'
import Tooltip from './Tooltip'

const ProjectSidebarMenu = ({
  project,
  file,
  enableMenu = false,
}: {
  enableMenu?: boolean
  project?: IndexLoaderData['project']
  file?: IndexLoaderData['file']
}) => {
  return (
    <div className="!no-underline h-full mr-auto max-h-min min-h-12 min-w-max flex items-center gap-2">
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

  return isTauri() ? (
    <Link
      data-testid="app-logo"
      onClick={() => {
        onProjectClose(file || null, project?.path || null, false)
        // Clear the scene and end the session.
        engineCommandManager.endSession()
      }}
      to={paths.HOME}
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
  const { commandBarState, commandBarSend } = useCommandsContext()
  const { onProjectClose } = useLspContext()
  const exportCommandInfo = { name: 'Export', groupId: 'modeling' }
  const findCommand = (obj: { name: string; groupId: string }) =>
    Boolean(
      commandBarState.context.commands.find(
        (c) => c.name === obj.name && c.groupId === obj.groupId
      )
    )

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
                isTauri() ? '' : '⬆'
              },`}</kbd>
            </>
          ),
          onClick: () => {
            const targetPath = location.pathname.includes(paths.FILE)
              ? filePath + paths.SETTINGS
              : paths.HOME + paths.SETTINGS
            navigate(targetPath + '?tab=project')
          },
        },
        'break',
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
            commandBarSend({
              type: 'Find and select command',
              data: exportCommandInfo,
            }),
        },
        'break',
        {
          id: 'go-home',
          Element: 'button',
          children: 'Go to Home',
          className: !isTauri() ? 'hidden' : '',
          onClick: () => {
            onProjectClose(file || null, project?.path || null, true)
            // Clear the scene and end the session.
            engineCommandManager.endSession()
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
      commandBarSend,
      engineCommandManager,
      onProjectClose,
      isTauri,
    ]
  )

  return (
    <Popover className="relative">
      <Popover.Button
        className="gap-1 rounded-sm h-9 mr-auto max-h-min min-w-max border-0 py-1 px-2 flex items-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary dark:hover:bg-chalkboard-90"
        data-testid="project-sidebar-toggle"
      >
        <div className="flex flex-col items-start py-0.5">
          <span className="hidden text-sm text-chalkboard-110 dark:text-chalkboard-20 whitespace-nowrap lg:block">
            {isTauri() && file?.name
              ? file.name.slice(file.name.lastIndexOf(sep()) + 1)
              : APP_NAME}
          </span>
          {isTauri() && project?.name && (
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
          className={`z-10 absolute top-full left-0 mt-1 pb-1 w-48 bg-chalkboard-10 dark:bg-chalkboard-90
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
