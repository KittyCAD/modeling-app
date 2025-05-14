import { Popover } from '@headlessui/react'

import type { ActionButtonProps } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { filterEscHotkey } from '@src/lib/hotkeyWrapper'
import { useHotkeys } from 'react-hotkeys-hook'

type ActionButtonSplitProps = ActionButtonProps & { Element: 'button' } & {
  name?: string
  dropdownTooltipText?: string
  splitMenuItems: {
    id: string
    label: string
    hotkey?: string | string[]
    onClick: () => void
    disabled?: boolean
    status?: 'available' | 'unavailable' | 'kcl-only' | 'experimental'
  }[]
}

export function ActionButtonDropdown({
  splitMenuItems,
  className,
  dropdownTooltipText = 'More tools',
  children,
  ...props
}: ActionButtonSplitProps) {
  const baseClassNames = `action-button p-0 m-0 group mono text-xs leading-none flex items-center gap-2 rounded-sm border-solid border border-chalkboard-30 hover:border-chalkboard-40 enabled:dark:border-chalkboard-70 dark:hover:border-chalkboard-60 dark:bg-chalkboard-90/50 text-chalkboard-100 dark:text-chalkboard-10`
  return (
    <Popover
      className={`${baseClassNames} ${className}`}
      data-onboarding-id={`${props.name}-group`}
    >
      {({ close }) => (
        <>
          {children}
          <Popover.Button
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
                'w-3.5 h-5 text-chalkboard-70 dark:text-chalkboard-40 rounded-none ' +
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
          <Popover.Panel
            as="ul"
            className="!pointer-events-auto absolute z-20 left-1/2 -translate-x-1/2 top-full mt-4 w-fit max-w-[280px] max-h-[80vh] overflow-y-auto py-2 flex flex-col align-stretch text-inherit dark:text-chalkboard-10 bg-chalkboard-10 dark:bg-chalkboard-100 rounded shadow-lg border border-solid border-chalkboard-30 dark:border-chalkboard-80 text-sm m-0 p-0"
            unmount={false}
          >
            {splitMenuItems.map((item, index) => (
              <ActionButtonDropdownListItem
                item={item}
                onClick={() => {
                  item.onClick()
                  // Close the popover
                  close()
                }}
                key={item.label}
              />
            ))}
          </Popover.Panel>
        </>
      )}
    </Popover>
  )
}

function ActionButtonDropdownListItem({
  item,
  onClick,
}: {
  item: ActionButtonSplitProps['splitMenuItems'][number]
  onClick: () => void
}) {
  /**
   * GOTCHA: `useHotkeys` can only register one hotkey listener per component.
   * and since the first item in the dropdown has a top-level button too,
   * it already has a hotkey listener, so we should skip it.
   * TODO: make a global hotkey registration system. make them editable.
   */
  useHotkeys(item.hotkey || '', item.onClick, {
    enabled:
      ['available', 'experimental'].includes(item.status || '') &&
      !!item.hotkey &&
      !item.disabled,
  })

  return (
    <li className="contents">
      <button
        type="button"
        onClick={onClick}
        className="group/button flex items-center gap-6 px-3 py-1 font-sans text-xs hover:bg-primary/10 dark:hover:bg-chalkboard-80 border-0 m-0 w-full rounded-none text-left disabled:!bg-transparent dark:disabled:text-chalkboard-60"
        tabIndex={-1}
        disabled={item.disabled}
        data-testid={'dropdown-' + item.id}
        data-onboarding-id={`${item.id}-dropdown-item`}
      >
        <span className="capitalize flex-grow text-left">{item.label}</span>
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
  )
}
