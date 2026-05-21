import type { ReactNode } from 'react'

export type SelectionListItem = {
  id: string
  label: ReactNode
}

export type SelectionListProps<Item extends SelectionListItem> = {
  items: Item[]
  onRemove?: (item: Item) => void
  heading?: ReactNode
  emptyLabel?: ReactNode
  hint?: ReactNode
  isActive?: boolean
  onClear?: () => void
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="h-4 w-4"
    >
      <path
        d="M8.5 6H5V8H6M8.5 6V4H11.5V6M8.5 6H11.5M11.5 6H15V8H14M6 8V15.5H8M6 8H14M14 8V15.5H12M8 15.5V10M8 15.5H10M12 15.5V10M12 15.5H10M10 15.5V12"
        stroke="currentColor"
      />
    </svg>
  )
}

export function SelectionList<Item extends SelectionListItem>({
  items,
  onRemove,
  heading = 'Captured',
  emptyLabel = 'No selection captured',
  hint,
  isActive = false,
  onClear,
}: SelectionListProps<Item>) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[10px] uppercase leading-tight text-chalkboard-60 dark:text-chalkboard-40">
          <span className="truncate">{heading}</span>
          <span
            className={[
              'rounded-sm px-1 py-px text-[9px] leading-none',
              isActive
                ? 'bg-primary/15 text-primary ring-1 ring-primary/30 dark:bg-primary/20 dark:text-primary'
                : 'bg-chalkboard-20 text-chalkboard-70 dark:bg-chalkboard-80 dark:text-chalkboard-30',
            ].join(' ')}
          >
            {items.length}
          </span>
        </span>
        {items.length > 0 && onClear && (
          <button
            type="button"
            className="pointer-events-auto m-0 rounded-sm border-none bg-transparent px-1 py-0 text-[10px] leading-tight text-chalkboard-60 hover:bg-chalkboard-20 hover:text-destroy-80 dark:text-chalkboard-40 dark:hover:bg-chalkboard-80 dark:hover:text-destroy-40"
            onClick={(event) => {
              event.stopPropagation()
              onClear()
            }}
            onFocus={(event) => event.stopPropagation()}
          >
            Clear
          </button>
        )}
      </div>
      {hint && (
        <p className="my-0 text-[10px] leading-tight text-chalkboard-60 dark:text-chalkboard-40">
          {hint}
        </p>
      )}
      {items.length > 0 ? (
        <ol className="my-0 flex list-none flex-col gap-1 p-0">
          {items.map((item, index) => (
            <li
              key={item.id}
              className="flex min-w-0 items-center justify-between gap-2 rounded-sm border border-chalkboard-20 bg-chalkboard-10/50 px-2 py-1 dark:border-chalkboard-70 dark:bg-chalkboard-90/50"
            >
              <span className="min-w-0 truncate text-xs leading-tight text-chalkboard-80 dark:text-chalkboard-20">
                <span className="mr-1 text-[10px] text-chalkboard-60 dark:text-chalkboard-40">
                  #{index + 1}
                </span>
                {item.label}
              </span>
              {onRemove && (
                <button
                  type="button"
                  className="pointer-events-auto group m-0 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border-none bg-transparent p-0 text-chalkboard-60 hover:bg-chalkboard-20 hover:text-destroy-80 dark:text-chalkboard-40 dark:hover:bg-chalkboard-80 dark:hover:text-destroy-40"
                  onClick={(event) => {
                    event.stopPropagation()
                    onRemove(item)
                  }}
                  onFocus={(event) => event.stopPropagation()}
                  aria-label={`Remove selection ${index + 1}`}
                  title="Remove selection"
                >
                  <TrashIcon />
                </button>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="my-0 text-xs leading-tight text-chalkboard-70 dark:text-chalkboard-40">
          {emptyLabel}
        </p>
      )}
    </div>
  )
}
