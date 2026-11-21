import { Popover } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import {
  HeaderMenuItems,
  headerMenuPanelClassName,
} from '@src/components/HeaderMenu'
import { ProjectNavigation } from '@src/components/ProjectNavigation'
import type { App } from '@src/lib/app'
import { OPEN_EDITOR_COMMAND } from '@src/lib/editors/commands'
import { PATHS } from '@src/lib/paths'
import type { OpenProjectSession } from '@src/lib/projectSession/next/contract'

/** Project actions stay bound to the captured opening, independent of legacy modeling. */
export function ProjectSessionMenu({
  app,
  session,
}: {
  app: App
  session: OpenProjectSession
}) {
  useSignals()
  const project = session.project.value
  return (
    <div className="flex min-w-0 items-stretch gap-2">
      <ProjectNavigation />
      <Popover className="relative min-w-0 self-center [-webkit-app-region:no-drag]">
        <h1 className="min-w-0 text-sm font-semibold">
          <Popover.Button
            data-testid="project-sidebar-toggle"
            className="flex max-w-full min-w-0 items-center gap-1 border-0 bg-transparent px-2 py-1 text-default hover:bg-3"
            title={project.contents.path}
          >
            <span data-testid="app-header-project-name" className="truncate">
              {project.metadata.title}
            </span>
            <CustomIcon
              name="caretDown"
              aria-hidden
              className="h-4 w-4 shrink-0 ui-open:rotate-180"
            />
          </Popover.Button>
        </h1>
        <Popover.Panel
          data-testid="project-sidebar-menu"
          className={`${headerMenuPanelClassName} left-0`}
        >
          {({ close }) => (
            <HeaderMenuItems
              close={close}
              groups={[
                [
                  {
                    id: 'open-editor',
                    Element: 'button',
                    children: 'Open editor',
                    onClick: () =>
                      app.commands.send({
                        type: 'Find and select command',
                        data: {
                          name: OPEN_EDITOR_COMMAND.name,
                          groupId: OPEN_EDITOR_COMMAND.groupId,
                        },
                      }),
                  },
                ],
                [
                  {
                    id: 'go-home',
                    Element: 'link',
                    to: PATHS.HOME,
                    children: 'Go to Home',
                  },
                ],
              ]}
            />
          )}
        </Popover.Panel>
      </Popover>
    </div>
  )
}
