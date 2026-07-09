import { Popover } from '@headlessui/react'
import type { MouseEvent, ReactNode } from 'react'
import { useRef } from 'react'

import { CustomIcon, type CustomIconName } from '@src/components/CustomIcon'
import { ToolbarDropdownPanel } from '@src/components/ToolbarDropdownPanel'
import Tooltip from '@src/components/Tooltip'
import { type HotkeySequence, hotkeyDisplay } from '@src/lib/hotkeys'
import type { Platform } from '@src/lib/utils'

type RecentDropdownMenuItem = {
  id: string
  label: string
  icon?: CustomIconName
  iconColor?: string
  hotkey?: HotkeySequence
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
  platform: Platform
}

export function ActionButtonRecentDropdown({
  children,
  className = '',
  dropdownTooltipText = 'More tools',
  menuItems,
  name,
  platform,
}: ActionButtonRecentDropdownProps) {
  const baseClassNames =
    'action-button p-0 m-0 group mono text-xs leading-none flex items-stretch rounded-sm border-solid border border-chalkboard-30 hover:border-chalkboard-40 enabled:dark:border-chalkboard-70 dark:hover:border-chalkboard-60 dark:bg-chalkboard-90/50 text-chalkboard-100 dark:text-chalkboard-10 relative'
  const buttonRef = useRef<HTMLButtonElement>(null)

  return (
    <Popover
      className={`${baseClassNames} ${className}`}
      data-onboarding-id={`${name}-group`}
    >
      {(popover) => (
        <>
          <div className="flex items-stretch gap-[1px]">{children}</div>
          <Popover.Button
            ref={buttonRef}
            className="!border-transparent dark:!border-transparent bg-transparent dark:bg-transparent enabled:hover:bg-chalkboard-10/85 dark:enabled:hover:bg-chalkboard-100/85 pressed:!bg-primary/85 pressed:enabled:hover:!text-chalkboard-10 self-stretch min-w-4 px-0 py-0 m-0 rounded-none !rounded-r-sm !outline-none ui-open:border-primary ui-open:bg-primary/85 flex items-center justify-center"
            data-onboarding-id={`${name}-dropdown-button`}
            data-testid={`${name}-dropdown`}
          >
            <CustomIcon
              name="caretDown"
              className="w-3.5 h-5 text-inherit dark:text-current ui-open:rotate-180 ui-open:!text-chalkboard-10"
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
          <ToolbarDropdownPanel buttonRef={buttonRef} open={popover.open}>
            {menuItems.map((item) => {
              const hotkeyLabel = hotkeyDisplay(item.hotkey, platform)

              return (
                <li className="contents" key={item.id}>
                  <button
                    type="button"
                    onClick={(event) => {
                      item.onClick(event)
                      if (!event.metaKey && !event.ctrlKey) {
                        popover.close()
                      }
                    }}
                    className="group/button flex items-center justify-between gap-4 px-3 py-1 font-sans text-xs hover:bg-primary/10 dark:hover:bg-chalkboard-80 border-0 m-0 w-full rounded-none text-left disabled:!bg-transparent dark:disabled:text-chalkboard-60"
                    tabIndex={-1}
                    disabled={item.disabled}
                    data-testid={`dropdown-${item.id}`}
                    data-onboarding-id={`${item.id}-dropdown-item`}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      {item.icon ? (
                        <CustomIcon
                          name={item.icon}
                          className="h-4 w-4 shrink-0 text-chalkboard-100 dark:text-chalkboard-10"
                          style={
                            item.iconColor
                              ? { color: item.iconColor }
                              : undefined
                          }
                        />
                      ) : item.status === 'unavailable' ? (
                        <CustomIcon
                          name="horizontalDash"
                          className="h-4 w-4 shrink-0 text-chalkboard-50 dark:text-chalkboard-50"
                          aria-hidden
                        />
                      ) : null}
                      <span className="capitalize text-left">{item.label}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {item.status === 'unavailable' ? (
                        <div className="flex flex-none items-center gap-1">
                          <span className="text-chalkboard-70 dark:text-chalkboard-40">
                            In development
                          </span>
                          <CustomIcon
                            name="lockClosed"
                            className="h-4 w-4 text-chalkboard-70 dark:text-chalkboard-40"
                          />
                        </div>
                      ) : item.status === 'kcl-only' ? (
                        <div className="flex flex-none items-center gap-1">
                          <span className="text-chalkboard-70 dark:text-chalkboard-40">
                            KCL code only
                          </span>
                          <CustomIcon
                            name="code"
                            className="h-4 w-4 text-chalkboard-70 dark:text-chalkboard-40"
                          />
                        </div>
                      ) : hotkeyLabel ? (
                        <kbd className="hotkey flex-none group-disabled/button:text-chalkboard-50 dark:group-disabled/button:text-chalkboard-70 group-disabled/button:border-chalkboard-20 dark:group-disabled/button:border-chalkboard-80">
                          {hotkeyLabel}
                        </kbd>
                      ) : null}
                      {item.status === 'experimental' ? (
                        <CustomIcon name="beaker" className="h-4 w-4" />
                      ) : null}
                    </span>
                  </button>
                </li>
              )
            })}
          </ToolbarDropdownPanel>
        </>
      )}
    </Popover>
  )
}
