import { Popover } from '@headlessui/react'
import type { MouseEvent, ButtonHTMLAttributes } from 'react'
import { useRef, useEffect, useState, useId } from 'react'

import type { ActionButtonProps } from '@src/components/ActionButton'
import { CustomIcon, type CustomIconName } from '@src/components/CustomIcon'
import {
  ToolbarDropdownPanel,
  positionPanelFromButton,
  toolbarDropdownPanelClassName,
} from '@src/components/ToolbarDropdownPanel'
import Tooltip from '@src/components/Tooltip'
import { type HotkeySequence, hotkeyDisplay } from '@src/lib/hotkeys'
import type { Platform } from '@src/lib/utils'

/** Menu groups retain their semantic children at every collapsed toolbar depth. */
export type ToolbarMenuItem = {
  id: string
  label: string
  icon?: CustomIconName
  iconColor?: string
  hotkey?: HotkeySequence
  disabled?: boolean
  status?: 'available' | 'unavailable' | 'kcl-only' | 'experimental'
} & (
  | { children: ToolbarMenuItem[] }
  | { onClick: (event: MouseEvent<HTMLButtonElement>) => void }
)

type ActionButtonSplitProps = ActionButtonProps & { Element: 'button' } & {
  name?: string
  dropdownTooltipText?: string
  splitMenuItems: ToolbarMenuItem[]
  onOpenChange?: (open: boolean) => void
  platform: Platform
}

export function ActionButtonDropdown({
  splitMenuItems,
  onOpenChange,
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
          <MenuOpenObserver open={popover.open} onChange={onOpenChange} />
          {children}
          <Popover.Button
            ref={buttonRef}
            onKeyDown={(event) => {
              if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
                event.preventDefault()
                if (!popover.open) event.currentTarget.click()
              }
            }}
            className={
              '!border-transparent dark:!border-transparent ui-open:!pointer-events-auto ' +
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
            {popover.open && (
              <li className="contents" role="none">
                <ToolbarMenu
                  items={splitMenuItems}
                  platform={platform}
                  close={() => popover.close()}
                />
              </li>
            )}
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
  buttonProps,
}: {
  buttonProps?: ButtonHTMLAttributes<HTMLButtonElement>
  item: ActionButtonSplitProps['splitMenuItems'][number]
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  platform: Platform
}) {
  const hotkeyLabel = hotkeyDisplay(item.hotkey, platform)

  return (
    <button
      type="button"
      {...buttonProps}
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
        {'children' in item && (
          <CustomIcon
            name="caretLeft"
            aria-hidden
            className="h-4 w-4 rotate-180"
          />
        )}
        {item.status === 'experimental' ? (
          <CustomIcon name="beaker" className="h-4 w-4" />
        ) : null}
      </span>
    </button>
  )
}

function MenuOpenObserver({
  open,
  onChange,
}: {
  open: boolean
  onChange?: (open: boolean) => void
}) {
  useEffect(() => {
    onChange?.(open)
    return () => {
      if (open) onChange?.(false)
    }
  }, [open, onChange])
  return null
}

function ToolbarMenu({
  items,
  platform,
  close,
  back,
}: {
  items: ToolbarMenuItem[]
  platform: Platform
  close: () => void
  back?: () => void
}) {
  const ref = useRef<HTMLUListElement>(null)
  const [expanded, setExpanded] = useState<string>()
  const isRoot = back === undefined
  useEffect(() => {
    if (isRoot)
      ref.current
        ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
        ?.focus()
  }, [isRoot])
  return (
    <ul
      ref={ref}
      role="menu"
      className="m-0 p-0 flex flex-col"
      onKeyDown={(event) => {
        const buttons = Array.from(
          ref.current?.querySelectorAll<HTMLButtonElement>(
            ':scope > li > button:not(:disabled)'
          ) ?? []
        )
        const index = buttons.findIndex(
          (button) => button === document.activeElement
        )
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          event.stopPropagation()
          buttons[
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (index +
                    (event.key === 'ArrowDown' ? 1 : -1) +
                    buttons.length) %
                  buttons.length
          ]?.focus()
        } else if (
          event.key === 'Escape' ||
          (back && event.key === 'ArrowLeft')
        ) {
          event.preventDefault()
          event.stopPropagation()
          ;(back ?? close)()
        }
      }}
    >
      {items.map((item) => (
        <ToolbarMenuEntry
          key={item.id}
          item={item}
          platform={platform}
          close={close}
          expanded={expanded === item.id}
          expand={() => setExpanded(item.id)}
          collapse={() => setExpanded(undefined)}
        />
      ))}
    </ul>
  )
}

function ToolbarMenuEntry({
  item,
  platform,
  close,
  expanded,
  expand,
  collapse,
}: {
  item: ToolbarMenuItem
  platform: Platform
  close: () => void
  expanded: boolean
  expand: () => void
  collapse: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLLIElement>(null)
  const focusOnOpen = useRef(false)
  const id = useId()
  const back = () => {
    collapse()
    trigger.current?.querySelector('button')?.focus()
  }
  useEffect(() => {
    const element = panel.current,
      button = trigger.current?.querySelector('button')
    if (!element || !button || !expanded) return
    element.showPopover()
    const position = () => positionPanelFromButton(element, button, 'beside')
    position()
    if (focusOnOpen.current)
      element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      element.hidePopover()
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
    }
  }, [expanded])
  const open = (keyboard: boolean) => {
    focusOnOpen.current = keyboard
    if (keyboard && expanded)
      panel.current
        ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
        ?.focus()
    expand()
  }
  return (
    <li
      ref={trigger}
      role="none"
      className="contents"
      onMouseEnter={() => {
        if ('children' in item) open(false)
        else collapse()
      }}
    >
      <ActionButtonDropdownListItem
        item={item}
        platform={platform}
        onClick={(event) => {
          if ('children' in item) open(true)
          else {
            item.onClick(event)
            close()
          }
        }}
        buttonProps={{
          role: 'menuitem',
          'aria-haspopup': 'children' in item ? 'menu' : undefined,
          'aria-expanded': 'children' in item ? expanded : undefined,
          'aria-controls': 'children' in item ? id : undefined,
          onKeyDown: (event) => {
            if ('children' in item && event.key === 'ArrowRight') {
              event.preventDefault()
              event.stopPropagation()
              open(true)
            }
          },
        }}
      />
      {'children' in item && (
        <div
          id={id}
          ref={panel}
          popover="manual"
          className={toolbarDropdownPanelClassName}
          style={{ inset: 'auto', margin: 0 }}
        >
          {expanded && (
            <ToolbarMenu
              items={item.children}
              platform={platform}
              close={close}
              back={back}
            />
          )}
        </div>
      )}
    </li>
  )
}
