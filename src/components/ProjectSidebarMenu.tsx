import { Popover, Transition } from '@headlessui/react'
import { ActionButton } from './ActionButton'
import { faHome } from '@fortawesome/free-solid-svg-icons'
import { ProjectWithEntryPointMetadata, paths } from '../Router'
import { isTauri } from '../lib/isTauri'
import { Link } from 'react-router-dom'
import { ExportButton } from './ExportButton'
import { Fragment } from 'react'

const ProjectSidebarMenu = ({
  project,
  renderAsLink = false,
}: {
  renderAsLink?: boolean
  project?: Partial<ProjectWithEntryPointMetadata>
}) => {
  return renderAsLink ? (
    <Link
      to={'../'}
      className="flex items-center gap-4 my-2"
      data-testid="project-sidebar-link"
    >
      <img
        src="/kitt-8bit-winking.svg"
        alt="KittyCAD App"
        className="h-9 w-auto"
      />
      <span
        className="text-sm text-chalkboard-110 dark:text-chalkboard-20 min-w-max"
        data-testid="project-sidebar-link-name"
      >
        {project?.name ? project.name : 'KittyCAD Modeling App'}
      </span>
    </Link>
  ) : (
    <Popover className="relative">
      <Popover.Button
        className="border-0 p-0.5 pr-2 flex items-center gap-4 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-energy-50"
        data-testid="project-sidebar-toggle"
      >
        <img
          src="/kitt-8bit-winking.svg"
          alt="KittyCAD App"
          className="h-9 w-auto"
        />
        <span className="text-sm text-chalkboard-110 dark:text-chalkboard-20 min-w-max">
          {isTauri() && project?.name ? project.name : 'KittyCAD Modeling App'}
        </span>
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
        <Popover.Panel className="fixed inset-0 right-auto z-30 w-64 bg-chalkboard-10 dark:bg-chalkboard-100 border border-energy-100 dark:border-energy-100/50 shadow-md rounded-r-lg overflow-hidden">
          <div className="flex items-center gap-4 px-4 py-3 bg-energy-100">
            <img
              src="/kitt-8bit-winking.svg"
              alt="KittyCAD App"
              className="h-9 w-auto"
            />

            <div>
              <p
                className="m-0 text-energy-10 text-mono"
                data-testid="projectName"
              >
                {project?.name ? project.name : 'KittyCAD Modeling App'}
              </p>
              {project?.entrypoint_metadata && (
                <p
                  className="m-0 text-energy-40 text-xs"
                  data-testid="createdAt"
                >
                  Created{' '}
                  {project?.entrypoint_metadata.createdAt.toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
          <div className="p-4 flex flex-col gap-2">
            <ExportButton
              className={{
                button:
                  'border-transparent dark:border-transparent dark:hover:border-energy-60',
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
                }}
                className="border-transparent dark:border-transparent dark:hover:border-energy-60"
              >
                Go to Home
              </ActionButton>
            )}
          </div>
        </Popover.Panel>
      </Transition>
    </Popover>
  )
}

export default ProjectSidebarMenu
