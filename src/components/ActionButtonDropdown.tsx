import { Popover } from '@headlessui/react'
import { ActionButton, ActionButtonProps } from './ActionButton'

type ActionButtonSplitProps = Omit<ActionButtonProps, 'iconEnd'> & {
  splitMenuItems: {
    label: string
    shortcut?: string
    onClick: () => void
    disabled?: boolean
  }[]
}

export function ActionButtonDropdown({
  splitMenuItems,
  className,
  ...props
}: ActionButtonSplitProps) {
  return (
    <Popover className="relative">
      <Popover.Button
        as={ActionButton}
        className={className}
        {...props}
        Element="button"
        iconEnd={{
          icon: 'caretDown',
          className: 'ui-open:rotate-180',
          bgClassName:
            'bg-chalkboard-20 dark:bg-chalkboard-80 ui-open:bg-primary ui-open:text-chalkboard-10',
        }}
      />
      <Popover.Panel
        as="ul"
        className="absolute z-20 left-1/2 -translate-x-1/2 top-full mt-1 w-fit max-h-[80vh] overflow-y-auto py-2 flex flex-col gap-1 align-stretch text-inherit dark:text-chalkboard-10 bg-chalkboard-10 dark:bg-chalkboard-100 rounded shadow-lg border border-solid border-chalkboard-30 dark:border-chalkboard-80 text-sm m-0 p-0"
      >
        {splitMenuItems.map((item) => (
          <li className="contents" key={item.label}>
            <button
              onClick={item.onClick}
              className="block px-3 py-1 hover:bg-primary/10 dark:hover:bg-chalkboard-80 border-0 m-0 text-sm w-full rounded-none text-left disabled:!bg-transparent"
              disabled={item.disabled}
            >
              <span className="capitalize">{item.label}</span>
              {item.shortcut && (
                <kbd className="bg-primary/10 dark:bg-chalkboard-80 dark:group-hover:bg-primary font-mono rounded-sm dark:text-inherit inline-block px-1 border-primary dark:border-chalkboard-90">
                  {item.shortcut}
                </kbd>
              )}
            </button>
          </li>
        ))}
      </Popover.Panel>
    </Popover>
  )
}
