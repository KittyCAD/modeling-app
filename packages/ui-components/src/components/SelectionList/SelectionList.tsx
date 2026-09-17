import type { ReactNode } from 'react'

export type SelectionListItem = {
  id: string
  label: ReactNode
  canMoveUp?: boolean
  canMoveDown?: boolean
}

export type SelectionListProps<Item extends SelectionListItem> = {
  items: Item[]
  onRemove?: (item: Item) => void
  heading?: ReactNode
  emptyLabel?: ReactNode
  hint?: ReactNode
  isActive?: boolean
  onClear?: () => void
  compact?: boolean
  ordered?: boolean
  onMove?: (item: Item, direction: 'up' | 'down') => void
}

function ChevronIcon({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="h-3 w-3"
    >
      <path
        d={
          direction === 'up' ? 'M4.5 9.5 8 6l3.5 3.5' : 'M4.5 6.5 8 10l3.5-3.5'
        }
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function RemoveIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="h-4 w-4"
    >
      <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" />
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
  compact = false,
  ordered = false,
  onMove,
}: SelectionListProps<Item>) {
  const canReorder =
    ordered &&
    items.length > 1 &&
    items.some((item) => item.canMoveUp || item.canMoveDown)

  return (
    <div className="flex flex-col gap-1">
      {!compact && (
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-xs leading-tight text-chalkboard-70 dark:text-chalkboard-30">
            <span className="truncate">{heading}</span>
            <span
              className={[
                'rounded-sm px-1 py-0.5 text-[10px] tabular-nums leading-none',
                isActive
                  ? 'bg-primary/15 text-primary dark:bg-primary/20 dark:text-primary'
                  : 'bg-chalkboard-20 text-chalkboard-70 dark:bg-chalkboard-80 dark:text-chalkboard-30',
              ].join(' ')}
            >
              {items.length}
            </span>
          </span>
          <span className="flex shrink-0 items-center">
            {items.length > 0 && onClear && (
              <button
                type="button"
                className="pointer-events-auto m-0 min-h-6 rounded-sm border-none bg-transparent px-1.5 py-1 text-xs leading-tight text-chalkboard-70 hover:bg-chalkboard-20 hover:text-destroy-80 focus-visible:outline focus-visible:outline-1 focus-visible:outline-appForeground dark:text-chalkboard-30 dark:hover:bg-chalkboard-80 dark:hover:text-destroy-40"
                onClick={(event) => {
                  event.stopPropagation()
                  onClear()
                }}
                onFocus={(event) => event.stopPropagation()}
              >
                Clear
              </button>
            )}
          </span>
        </div>
      )}
      {hint && (!compact || items.length === 0) && (
        <p className="my-0 text-[11px] leading-snug text-chalkboard-70 dark:text-chalkboard-40">
          {hint}
        </p>
      )}
      {items.length > 0 ? (
        <ol className="my-0 flex list-none flex-col divide-y divide-chalkboard-20 p-0 dark:divide-chalkboard-70">
          {items.map((item, index) => (
            <li
              key={item.id}
              className={[
                'flex min-w-0 items-center justify-between gap-2',
                compact ? 'min-h-6 px-0 py-0.5' : 'min-h-7 px-1 py-1',
              ].join(' ')}
            >
              <span className="flex min-w-0 items-center gap-1 truncate text-xs leading-tight text-chalkboard-80 dark:text-chalkboard-20">
                {(!compact || items.length > 1) && (
                  <span className="text-[10px] text-chalkboard-60 dark:text-chalkboard-40">
                    #{index + 1}
                  </span>
                )}
                <span className="min-w-0 truncate">{item.label}</span>
                {ordered &&
                  items.length > 1 &&
                  (index === 0 || index === items.length - 1) && (
                    <span className="shrink-0 rounded-sm bg-chalkboard-20 px-1 py-0.5 text-[10px] leading-none text-chalkboard-70 dark:bg-chalkboard-80 dark:text-chalkboard-30">
                      {index === 0 ? 'Start' : 'End'}
                    </span>
                  )}
              </span>
              <span className="flex shrink-0 items-center">
                {canReorder && onMove && (
                  <>
                    <button
                      type="button"
                      className="pointer-events-auto m-0 flex h-6 w-5 items-center justify-center rounded-sm border-none bg-transparent p-0 text-chalkboard-60 hover:bg-chalkboard-20 hover:text-chalkboard-90 focus-visible:outline focus-visible:outline-1 focus-visible:outline-appForeground disabled:cursor-default disabled:opacity-25 dark:text-chalkboard-40 dark:hover:bg-chalkboard-80 dark:hover:text-chalkboard-10"
                      disabled={!item.canMoveUp}
                      onClick={(event) => {
                        event.stopPropagation()
                        onMove(item, 'up')
                      }}
                      onFocus={(event) => event.stopPropagation()}
                      aria-label={`Move selection ${index + 1} up`}
                      title="Move up"
                    >
                      <ChevronIcon direction="up" />
                    </button>
                    <button
                      type="button"
                      className="pointer-events-auto m-0 flex h-6 w-5 items-center justify-center rounded-sm border-none bg-transparent p-0 text-chalkboard-60 hover:bg-chalkboard-20 hover:text-chalkboard-90 focus-visible:outline focus-visible:outline-1 focus-visible:outline-appForeground disabled:cursor-default disabled:opacity-25 dark:text-chalkboard-40 dark:hover:bg-chalkboard-80 dark:hover:text-chalkboard-10"
                      disabled={!item.canMoveDown}
                      onClick={(event) => {
                        event.stopPropagation()
                        onMove(item, 'down')
                      }}
                      onFocus={(event) => event.stopPropagation()}
                      aria-label={`Move selection ${index + 1} down`}
                      title="Move down"
                    >
                      <ChevronIcon direction="down" />
                    </button>
                  </>
                )}
                {onRemove && (
                  <button
                    type="button"
                    className="pointer-events-auto group m-0 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border-none bg-transparent p-0 text-chalkboard-60 hover:bg-chalkboard-20 hover:text-destroy-80 focus-visible:outline focus-visible:outline-1 focus-visible:outline-appForeground dark:text-chalkboard-40 dark:hover:bg-chalkboard-80 dark:hover:text-destroy-40"
                    onClick={(event) => {
                      event.stopPropagation()
                      onRemove(item)
                    }}
                    onFocus={(event) => event.stopPropagation()}
                    aria-label={`Remove selection ${index + 1}`}
                    title="Remove selection"
                  >
                    <RemoveIcon />
                  </button>
                )}
              </span>
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
