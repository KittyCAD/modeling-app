import { Popover, Transition } from '@headlessui/react'
import { ActionButton } from './ActionButton'
import { type IndexLoaderData } from 'lib/types'
import { paths } from 'lib/paths'
import { isTauri } from '../lib/isTauri'
import { Link } from 'react-router-dom'
import { Fragment } from 'react'
import { FileTree } from './FileTree'
import { sep } from '@tauri-apps/api/path'
import { Logo } from './Logo'
import { APP_NAME } from 'lib/constants'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { CustomIcon } from './CustomIcon'
import { useLspContext } from './LspProvider'
import { engineCommandManager } from 'lib/singletons'

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
          className="hidden select-none text-sm text-chalkboard-110 dark:text-chalkboard-20 whitespace-nowrap lg:block"
          data-testid="project-sidebar-link-name"
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
  const { commandBarState, commandBarSend } = useCommandsContext()
  const { onProjectClose } = useLspContext()
  const exportCommandInfo = { name: 'Export', ownerMachine: 'modeling' }
  const findCommand = (obj: { name: string; ownerMachine: string }) =>
    Boolean(
      commandBarState.context.commands.find(
        (c) => c.name === obj.name && c.ownerMachine === obj.ownerMachine
      )
    )

  return (
    <Popover className="relative">
      <Popover.Button
        className="rounded-sm h-9 mr-auto max-h-min min-w-max border-0 py-1 pl-0 pr-2 flex items-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary dark:hover:bg-chalkboard-90"
        data-testid="project-sidebar-toggle"
      >
        <CustomIcon name="three-dots" className="w-5 h-5 rotate-90" />
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
      </Popover.Button>
      <Transition
        enter="duration-200 ease-out"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="duration-100 ease-in"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
        as={Fragment}
      >
        <Popover.Overlay className="fixed inset-0 z-20 bg-chalkboard-110/50" />
      </Transition>

      <Transition
        enter="duration-100 ease-out"
        enterFrom="opacity-0 -translate-x-1/4"
        enterTo="opacity-100 translate-x-0"
        leave="duration-75 ease-in"
        leaveFrom="opacity-100 translate-x-0"
        leaveTo="opacity-0 -translate-x-4"
        as={Fragment}
      >
        <Popover.Panel
          className="fixed inset-0 right-auto z-30 grid w-64 h-screen max-h-screen grid-cols-1 border rounded-r-md shadow-md bg-chalkboard-10 dark:bg-chalkboard-100 border-chalkboard-40 dark:border-chalkboard-80"
          style={{ gridTemplateRows: 'auto 1fr auto' }}
        >
          {({ close }) => (
            <>
              <div className="flex items-center gap-4 px-4 py-3">
                <div>
                  <p className="m-0 text-mono" data-testid="projectName">
                    {project?.name ? project.name : APP_NAME}
                  </p>
                  {project?.metadata && project.metadata.created && (
                    <p
                      className="m-0 text-xs text-chalkboard-80 dark:text-chalkboard-40"
                      data-testid="createdAt"
                    >
                      Created{' '}
                      {new Date(project.metadata.created).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
              {isTauri() ? (
                <FileTree
                  file={file}
                  className="overflow-hidden border-0 border-y border-chalkboard-30 dark:border-chalkboard-80"
                  closePanel={close}
                />
              ) : (
                <div className="flex-1 p-4 text-sm overflow-hidden">
                  <p>
                    In the browser version of Modeling App you can only have one
                    part, and the code is stored in your browser's storage.
                  </p>
                  <p className="my-6">
                    Please save any code you want to keep more permanently, as
                    your browser's storage is not guaranteed to be permanent.
                  </p>
                </div>
              )}
              <div className="flex flex-col gap-2 p-4 dark:bg-chalkboard-90">
                <ActionButton
                  Element="button"
                  iconStart={{ icon: 'exportFile', className: 'p-1' }}
                  className="border-transparent dark:border-transparent"
                  disabled={!findCommand(exportCommandInfo)}
                  onClick={() =>
                    commandBarSend({
                      type: 'Find and select command',
                      data: exportCommandInfo,
                    })
                  }
                >
                  Export Part
                </ActionButton>
                {isTauri() && (
                  <ActionButton
                    Element="button"
                    onClick={() => {
                      onProjectClose(file || null, project?.path || null, true)
                      // Clear the scene and end the session.
                      engineCommandManager.endSession()
                    }}
                    iconStart={{
                      icon: 'arrowLeft',
                      className: 'p-1',
                    }}
                    className="border-transparent dark:border-transparent"
                  >
                    Go to Home
                  </ActionButton>
                )}
              </div>
            </>
          )}
        </Popover.Panel>
      </Transition>
    </Popover>
  )
}

export default ProjectSidebarMenu
