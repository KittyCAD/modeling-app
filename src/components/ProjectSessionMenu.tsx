import { Popover } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import {
  HeaderMenuItems,
  headerMenuItemClassName,
  headerMenuPanelClassName,
  projectMenuCaretClassName,
  projectMenuLabelClassName,
  projectMenuTriggerClassName,
} from '@src/components/HeaderMenu'
import type { App } from '@src/lib/app'
import type { OpenProjectSession } from '@src/lib/projectSession/next/contract'
import { projectMenuItemsFacet } from '@src/lib/projectSession/next/projectMenu'

/** Project actions stay bound to the captured opening, independent of legacy modeling. */
export function ProjectSessionMenu({
  app,
  session,
}: {
  app: App
  session: OpenProjectSession
}) {
  useSignals()
  const items = app.registry.observe(projectMenuItemsFacet).value
  const project = session.project.value
  return (
    <div className="flex min-w-0 items-stretch gap-2">
      <Popover className="relative min-w-0 self-center [-webkit-app-region:no-drag]">
        <h1 className="min-w-0 text-sm font-normal text-default">
          <Popover.Button
            data-testid="project-sidebar-toggle"
            className={projectMenuTriggerClassName}
            title={project.contents.path}
          >
            <div className={projectMenuLabelClassName}>
              <span
                data-testid="app-header-project-name"
                className="min-w-0 truncate text-default whitespace-nowrap"
              >
                {project.metadata.title}
              </span>
            </div>
            <CustomIcon
              name="caretDown"
              aria-hidden
              className={projectMenuCaretClassName}
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
                items.map(({ id, Component }) => ({
                  id,
                  kind: 'custom',
                  render: (close) => (
                    <Component
                      app={app}
                      session={session}
                      className={headerMenuItemClassName}
                      close={close}
                    />
                  ),
                })),
              ]}
            />
          )}
        </Popover.Panel>
      </Popover>
    </div>
  )
}
