import { Popover, Transition } from '@headlessui/react'
import { ActionButton } from './ActionButton'
import { faHome } from '@fortawesome/free-solid-svg-icons'
import { IndexLoaderData, paths } from '../Router'
import { isTauri } from '../lib/isTauri'
import { Link } from 'react-router-dom'
import { ExportButton } from './ExportButton'
import { Fragment } from 'react'
import { FileTree } from './FileTree'

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
      className="h-9 max-h-min min-w-max border-0 p-0.5 pr-2 flex items-center gap-4 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-energy-50"
      data-testid="project-sidebar-link"
    >
      <img
        src="/kitt-8bit-winking.svg"
        alt="KittyCAD App"
        className="h-9 w-auto"
      />
      <span
        className="text-sm text-chalkboard-110 dark:text-chalkboard-20 whitespace-nowrap hidden lg:block"
        data-testid="project-sidebar-link-name"
      >
        {project?.name ? project.name : 'KittyCAD Modeling App'}
      </span>
    </Link>
  ) : (
    <Popover className="relative">
      <Popover.Button
        className="h-9 max-h-min min-w-max border-0 p-0.5 pr-2 flex items-center gap-4 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-energy-50"
        data-testid="project-sidebar-toggle"
      >
        <img
          src="/kitt-8bit-winking.svg"
          alt="KittyCAD App"
          className="h-full w-auto"
        />
        <div className="flex flex-col items-start py-0.5">
          <span className="text-sm text-chalkboard-110 dark:text-chalkboard-20 whitespace-nowrap hidden lg:block">
            {isTauri() && file?.name
              ? file.name.slice(file.name.lastIndexOf('/') + 1)
              : 'KittyCAD Modeling App'}
          </span>
          {isTauri() && project?.name && (
            <span className="text-xs text-chalkboard-70 dark:text-chalkboard-40 whitespace-nowrap hidden lg:block">
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
        <Popover.Overlay className="fixed z-20 inset-0 bg-chalkboard-110/50" />
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
        <Popover.Panel className="fixed inset-0 right-auto z-30 w-64 flex flex-col bg-chalkboard-10 dark:bg-chalkboard-100 border border-energy-100 dark:border-energy-100/50 shadow-md rounded-r-lg">
          {({ close }) => (
            <>
              <div className="flex items-center gap-4 px-4 py-3 bg-energy-10/25 dark:bg-energy-110">
                <img
                  src="/kitt-8bit-winking.svg"
                  alt="KittyCAD App"
                  className="h-9 w-auto"
                />

                <div>
                  <p
                    className="m-0 text-chalkboard-100 dark:text-energy-10 text-mono"
                    data-testid="projectName"
                  >
                    {project?.name ? project.name : 'KittyCAD Modeling App'}
                  </p>
                  {project?.entrypointMetadata && (
                    <p
                      className="m-0 text-chalkboard-100 dark:text-energy-40 text-xs"
                      data-testid="createdAt"
                    >
                      Created{' '}
                      {project.entrypointMetadata.createdAt.toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
              {isTauri() ? (
                <FileTree
                  project={project}
                  file={file}
                  className="overflow-visible flex-1 flex flex-col border-0 border-y border-energy-40 dark:border-energy-70"
                  closePanel={close}
                />
              ) : (
                <div className="flex-1 overflow-hidden" />
              )}
              <div className="p-4 flex flex-col gap-2 bg-energy-10/25 dark:bg-energy-110">
                <ExportButton
                  className={{
                    button:
                      'border-transparent dark:border-transparent hover:border-energy-60',
                    icon: 'text-energy-10 dark:text-energy-120',
                    bg: 'bg-energy-120 dark:bg-energy-10',
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
                      iconClassName: 'text-energy-10 dark:text-energy-120',
                      bgClassName: 'bg-energy-120 dark:bg-energy-10',
                    }}
                    className="border-transparent dark:border-transparent hover:border-energy-60"
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
