import { Disclosure } from '@headlessui/react'
import { CustomIcon } from '@src/components/CustomIcon'
import type { PropsWithChildren, ReactNode } from 'react'

export function CollapsiblePaneSection({
  actions,
  children,
  openClassName = 'flex-1',
  panelClassName = 'min-h-0 flex-1 overflow-auto',
  title,
}: PropsWithChildren<{
  actions?: ReactNode
  openClassName?: string
  panelClassName?: string
  title: string
}>) {
  return (
    <Disclosure defaultOpen>
      {({ open }) => (
        <section
          className={`min-h-0 flex-col ${open ? `flex ${openClassName}` : 'flex flex-none'}`}
          data-pane-section={title}
        >
          <div className="flex h-11 flex-none items-center gap-1 px-3">
            <Disclosure.Button
              aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`}
              className="reset !m-0 flex min-w-0 flex-1 items-center gap-2 !rounded !border-transparent !bg-transparent !p-1 text-left hover:!bg-chalkboard-20 dark:hover:!bg-chalkboard-90"
            >
              <CustomIcon
                aria-hidden
                className="h-3.5 w-3.5 flex-none -rotate-90 transition-transform ui-open:rotate-0"
                name="caretDown"
              />
              <h2 className="m-0 min-w-0 flex-1 truncate text-base font-semibold leading-5">
                {title}
              </h2>
            </Disclosure.Button>
            {actions ? (
              <div className="flex flex-none items-center gap-1">{actions}</div>
            ) : null}
          </div>
          <Disclosure.Panel className={panelClassName}>
            {children}
          </Disclosure.Panel>
        </section>
      )}
    </Disclosure>
  )
}
