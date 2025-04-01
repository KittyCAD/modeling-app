import { Popover } from '@headlessui/react'
import { ActionButtonProps } from './ActionButton'
import { CustomIcon } from './CustomIcon'
import Tooltip from './Tooltip'

type ActionButtonSplitProps = ActionButtonProps & { Element: 'button' } & {
  name?: string
  dropdownTooltipText?: string
  splitMenuItems: {
    id: string
    label: string
    shortcut?: string
    onClick: () => void
    disabled?: boolean
    status?: 'available' | 'unavailable' | 'kcl-only'
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
    <Popover className={`${baseClassNames} ${className}`}>
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
          >
            {splitMenuItems.map((item) => (
              <li className="contents" key={item.label}>
                <button
                  onClick={() => {
                    item.onClick()
                    // Close the popover
                    close()
                  }}
                  className="group/button flex items-center gap-6 px-3 py-1 font-sans text-xs hover:bg-primary/10 dark:hover:bg-chalkboard-80 border-0 m-0 w-full rounded-none text-left disabled:!bg-transparent dark:disabled:text-chalkboard-60"
                  disabled={item.disabled}
                  data-testid={'dropdown-' + item.id}
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
                  ) : item.shortcut ? (
                    <kbd className="hotkey flex-none group-disabled/button:text-chalkboard-50 dark:group-disabled/button:text-chalkboard-70 group-disabled/button:border-chalkboard-20 dark:group-disabled/button:border-chalkboard-80">
                      {item.shortcut}
                    </kbd>
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
