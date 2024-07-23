import { Popover } from '@headlessui/react'
import { ActionButton, ActionButtonProps } from './ActionButton'

type ActionButtonSplitProps = ActionButtonProps & { Element: 'button' } & {
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
          className: '!w-3.5 ui-open:rotate-180',
          bgClassName:
            '!bg-transparent ui-open:!bg-primary ui-open:!text-chalkboard-10',
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
              className="block px-3 py-1 hover:bg-primary/10 dark:hover:bg-chalkboard-80 border-0 m-0 text-sm w-full rounded-none text-left disabled:!bg-transparent dark:disabled:text-chalkboard-60"
              disabled={item.disabled}
              data-testid={item.label}
            >
              <span className="capitalize">{item.label}</span>
              {item.shortcut && <kbd className="hotkey">{item.shortcut}</kbd>}
            </button>
          </li>
        ))}
      </Popover.Panel>
    </Popover>
  )
}
