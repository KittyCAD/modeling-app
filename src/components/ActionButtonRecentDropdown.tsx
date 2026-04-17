import type { MouseEvent, ReactNode } from 'react'
import { Popover } from '@headlessui/react'

import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { filterEscHotkey } from '@src/lib/hotkeyWrapper'

type RecentDropdownMenuItem = {
  id: string
  label: string
  hotkey?: string | string[]
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  status?: 'available' | 'unavailable' | 'kcl-only' | 'experimental'
}

type ActionButtonRecentDropdownProps = {
  children: ReactNode
  className?: string
  dropdownTooltipText?: string
  menuItems: RecentDropdownMenuItem[]
  name?: string
}

export function ActionButtonRecentDropdown({
  children,
  className = '',
  dropdownTooltipText = 'More tools',
  menuItems,
  name,
}: ActionButtonRecentDropdownProps) {
  const baseClassNames =
    'action-button p-0 m-0 group mono text-xs leading-none flex items-stretch rounded-sm border-solid border border-chalkboard-30 hover:border-chalkboard-40 enabled:dark:border-chalkboard-70 dark:hover:border-chalkboard-60 dark:bg-chalkboard-90/50 text-chalkboard-100 dark:text-chalkboard-10 relative'

  return (
    <Popover
      className={`${baseClassNames} ${className}`}
      data-onboarding-id={`${name}-group`}
    >
      {(popover) => (
        <>
          <div className="flex items-stretch gap-[1px]">{children}</div>
          <Popover.Button
            className="!border-transparent dark:!border-transparent bg-transparent dark:bg-transparent enabled:hover:bg-chalkboard-10/85 dark:enabled:hover:bg-chalkboard-100/85 pressed:!bg-primary/85 pressed:enabled:hover:!text-chalkboard-10 absolute -bottom-3 left-1 right-1 z-10 min-h-3 px-0 py-0 rounded-sm !outline-none ui-open:border-primary ui-open:bg-primary/85 flex items-center justify-center"
            data-onboarding-id={`${name}-dropdown-button`}
            data-testid={`${name}-dropdown`}
          >
            <CustomIcon
              name="caretDown"
              className="w-3.5 h-3 text-chalkboard-70 dark:text-chalkboard-40 ui-open:rotate-180 ui-open:!text-chalkboard-10"
            />
            <span className="sr-only">
              {name ? `${name}: open menu` : 'open menu'}
            </span>
            <Tooltip
              position="bottom"
              hoverOnly
              wrapperClassName="ui-open:!hidden"
            >
              {dropdownTooltipText}
            </Tooltip>
          </Popover.Button>
          <Popover.Panel
            as="ul"
            className="!pointer-events-auto absolute z-20 left-1/2 -translate-x-1/2 top-full mt-4 w-fit max-w-[280px] max-h-[80vh] overflow-y-auto py-2 flex flex-col align-stretch text-inherit dark:text-chalkboard-10 bg-chalkboard-10 dark:bg-chalkboard-100 rounded shadow-lg border border-solid border-chalkboard-30 dark:border-chalkboard-80 text-sm m-0 p-0"
            unmount={false}
          >
            {menuItems.map((item) => (
              <li className="contents" key={item.id}>
                <button
                  type="button"
                  onClick={(event) => {
                    item.onClick(event)
                    if (!event.metaKey && !event.ctrlKey) {
                      popover.close()
                    }
                  }}
                  className="group/button flex items-center gap-6 px-3 py-1 font-sans text-xs hover:bg-primary/10 dark:hover:bg-chalkboard-80 border-0 m-0 w-full rounded-none text-left disabled:!bg-transparent dark:disabled:text-chalkboard-60"
                  tabIndex={-1}
                  disabled={item.disabled}
                  data-testid={`dropdown-${item.id}`}
                  data-onboarding-id={`${item.id}-dropdown-item`}
                >
                  <span className="capitalize flex-grow text-left">
                    {item.label}
                  </span>
                  {item.status === 'unavailable' ? (
                    <div className="flex flex-none items-center gap-1">
                      <span className="text-chalkboard-70 dark:text-chalkboard-40">
                        In development
                      </span>
                      <CustomIcon
                        name="lockClosed"
                        className="w-4 h-4 text-chalkboard-70 dark:text-chalkboard-40"
                      />
                    </div>
                  ) : item.status === 'kcl-only' ? (
                    <div className="flex flex-none items-center gap-1">
                      <span className="text-chalkboard-70 dark:text-chalkboard-40">
                        KCL code only
                      </span>
                      <CustomIcon
                        name="code"
                        className="w-4 h-4 text-chalkboard-70 dark:text-chalkboard-40"
                      />
                    </div>
                  ) : item.hotkey ? (
                    <kbd className="hotkey flex-none group-disabled/button:text-chalkboard-50 dark:group-disabled/button:text-chalkboard-70 group-disabled/button:border-chalkboard-20 dark:group-disabled/button:border-chalkboard-80">
                      {filterEscHotkey(item.hotkey)}
                    </kbd>
                  ) : null}
                  {item.status === 'experimental' ? (
                    <CustomIcon name="beaker" className="w-4 h-4" />
                  ) : null}
                </button>
              </li>
            ))}
          </Popover.Panel>
        </>
      )}
    </Popover>
  )
}
