import { Popover } from '@headlessui/react'
import type { MouseEvent } from 'react'
import { useRef } from 'react'

import type { ActionButtonProps } from '@src/components/ActionButton'
import { CustomIcon, type CustomIconName } from '@src/components/CustomIcon'
import { ToolbarDropdownPanel } from '@src/components/ToolbarDropdownPanel'
import Tooltip from '@src/components/Tooltip'
import { type HotkeySequence, hotkeyDisplay } from '@src/lib/hotkeys'
import type { Platform } from '@src/lib/utils'

type ActionButtonSplitProps = ActionButtonProps & { Element: 'button' } & {
  name?: string
  dropdownTooltipText?: string
  splitMenuItems: {
    id: string
    label: string
    icon?: CustomIconName
    iconColor?: string
    hotkey?: HotkeySequence
    onClick: (event: MouseEvent<HTMLButtonElement>) => void
    disabled?: boolean
    status?: 'available' | 'unavailable' | 'kcl-only' | 'experimental'
  }[]
  platform: Platform
}

export function ActionButtonDropdown({
  splitMenuItems,
  className,
  dropdownTooltipText = 'More tools',
  children,
  platform,
  ...props
}: ActionButtonSplitProps) {
  const baseClassNames = `action-button p-0 m-0 group mono text-xs leading-none flex items-center gap-2 rounded-sm border-solid border border-chalkboard-30 hover:border-chalkboard-40 enabled:dark:border-chalkboard-70 dark:hover:border-chalkboard-60 dark:bg-chalkboard-90/50 text-chalkboard-100 dark:text-chalkboard-10`
  const buttonRef = useRef<HTMLButtonElement>(null)

  return (
    <Popover
      className={`${baseClassNames} ${className}`}
      data-onboarding-id={`${props.name}-group`}
    >
      {(popover) => (
        <>
          {children}
          <Popover.Button
            ref={buttonRef}
            className={
              '!border-transparent dark:!border-transparent ' +
              'bg-chalkboard-transparent dark:bg-transparent disabled:bg-transparent dark:disabled:bg-transparent ' +
              'enabled:hover:bg-chalkboard-10 dark:enabled:hover:bg-chalkboard-100 ' +
              'pressed:!bg-primary pressed:enabled:hover:!text-chalkboard-10 p-0 m-0 rounded-none !outline-none ui-open:border-primary ui-open:bg-primary'
            }
            data-onboarding-id={`${props.name}-dropdown-button`}
          >
            <CustomIcon
              name="caretDown"
              className={
                'w-3.5 h-5 text-inherit dark:text-current rounded-none ' +
                'ui-open:rotate-180 ui-open:!text-chalkboard-10'
              }
            />
            <span className="sr-only">
              {props.name ? props.name + ': ' : ''}open menu
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
            {splitMenuItems.map((item) => (
              <ActionButtonDropdownListItem
                item={item}
                onClick={(event) => {
                  item.onClick(event)
                  // Close the popover
                  popover.close()
                }}
                key={item.label}
                platform={platform}
              />
            ))}
          </ToolbarDropdownPanel>
        </>
      )}
    </Popover>
  )
}

function ActionButtonDropdownListItem({
  item,
  onClick,
  platform,
}: {
  item: ActionButtonSplitProps['splitMenuItems'][number]
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  platform: Platform
}) {
  const hotkeyLabel = hotkeyDisplay(item.hotkey, platform)

  return (
    <li className="contents">
      <button
        type="button"
        onClick={onClick}
        className="group/button flex items-center justify-between gap-4 px-3 py-1 font-sans text-xs hover:bg-primary/10 dark:hover:bg-chalkboard-80 border-0 m-0 w-full rounded-none text-left disabled:!bg-transparent dark:disabled:text-chalkboard-60"
        tabIndex={-1}
        disabled={item.disabled}
        data-testid={'dropdown-' + item.id}
        data-onboarding-id={`${item.id}-dropdown-item`}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {item.icon ? (
            <CustomIcon
              name={item.icon}
              className="h-4 w-4 shrink-0 text-chalkboard-100 dark:text-chalkboard-10"
              style={item.iconColor ? { color: item.iconColor } : undefined}
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
}
