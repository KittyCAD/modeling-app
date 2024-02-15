import { Popover, Transition } from '@headlessui/react'
import { ActionButton } from './ActionButton'
import { faHome } from '@fortawesome/free-solid-svg-icons'
import { type IndexLoaderData } from 'lib/types'
import { paths } from 'lib/paths'
import { isTauri } from '../lib/isTauri'
import { Link } from 'react-router-dom'
import { ExportButton } from './ExportButton'
import { Fragment } from 'react'
import { FileTree } from './FileTree'
import { sep } from '@tauri-apps/api/path'
import { Logo } from './Logo'
import { APP_NAME } from 'lib/constants'

const ProjectSidebarMenu = ({
  project,
  file,
  renderAsLink = false,
}: {
  renderAsLink?: boolean
  project?: IndexLoaderData['project']
  file?: IndexLoaderData['file']
}) => {
  return renderAsLink ? (
    <Link
      to={paths.HOME}
      className="rounded-sm h-9 mr-auto max-h-min min-w-max border-0 py-1 px-2 flex items-center gap-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-energy-50 dark:hover:bg-chalkboard-90"
      data-testid="project-sidebar-link"
    >
      <Logo />
      <span
        className="hidden text-sm text-chalkboard-110 dark:text-chalkboard-20 whitespace-nowrap lg:block"
        data-testid="project-sidebar-link-name"
      >
        {project?.name ? project.name : APP_NAME}
      </span>
    </Link>
  ) : (
    <Popover className="relative">
      <Popover.Button
        className="rounded-sm h-9 mr-auto max-h-min min-w-max border-0 py-1 px-2 flex items-center gap-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-energy-50 dark:hover:bg-chalkboard-90"
        data-testid="project-sidebar-toggle"
      >
        <Logo />
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
                <Logo />
                <div>
                  <p
                    className="m-0 text-chalkboard-100 dark:text-energy-10 text-mono"
                    data-testid="projectName"
                  >
                    {project?.name ? project.name : APP_NAME}
                  </p>
                  {project?.entrypointMetadata && (
                    <p
                      className="m-0 text-xs text-chalkboard-100 dark:text-energy-40"
                      data-testid="createdAt"
                    >
                      Created{' '}
                      {project.entrypointMetadata.atime?.toLocaleDateString()}
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
                <div className="flex-1 overflow-hidden" />
              )}
              <div className="flex flex-col gap-2 p-4 dark:bg-chalkboard-90">
                <ExportButton
                  className={{
                    button: 'border-transparent dark:border-transparent',
                  }}
                >
                  Export Model
                </ExportButton>
                {isTauri() && (
                  <ActionButton
                    Element="link"
                    to={paths.HOME}
                    icon={{
                      icon: faHome,
                      className: 'p-1',
                      size: 'sm',
                    }}
                    className="border-transparent dark:border-transparent hover:bg-energy-10/20 dark:hover:bg-chalkboard-90"
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
