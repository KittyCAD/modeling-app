import { Popover } from '@headlessui/react'
import { useRef } from 'react'
import { CustomIcon } from '@src/components/CustomIcon'
import { ToolbarDropdownPanel } from '@src/components/ToolbarDropdownPanel'
import styles from './TabViewPicker.module.css'

/** The tab control only needs presentation metadata, independent of editor or executor ownership. */
interface TabViewOption {
  id: string
  label: string
}

/** Keep the view control inside its tab while the popover escapes the scrolling strip. */
export function TabViewPicker({
  name,
  view,
  views,
  onFocus,
  onChange,
}: {
  name: string
  view: TabViewOption | undefined
  views: readonly TabViewOption[]
  onFocus: () => void
  onChange: (viewId: string) => void
}) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const canChoose = views.length > 1 || (!view && views.length > 0)
  if (!canChoose)
    return (
      <span className={styles.viewLabel} title={view?.label}>
        {view?.label ?? 'Unavailable view'}
      </span>
    )
  return (
    <Popover
      className="flex items-center"
      onKeyDown={(event) => event.stopPropagation()}
    >
      {(popover) => (
        <>
          <Popover.Button
            ref={buttonRef}
            aria-label={`View for ${name}`}
            title="Choose view"
            onFocus={onFocus}
            className={styles.viewButton}
          >
            <span className="truncate">
              {view?.label ?? 'Unavailable view'}
            </span>
            <CustomIcon
              name="caretDown"
              className="h-3 w-3 shrink-0"
              aria-hidden
            />
          </Popover.Button>
          <ToolbarDropdownPanel buttonRef={buttonRef} open={popover.open}>
            {views.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  className={styles.viewOption}
                  aria-pressed={option.id === view?.id}
                  onClick={() => {
                    onChange(option.id)
                    popover.close()
                  }}
                >
                  <span className="grid h-4 w-4 shrink-0 place-items-center">
                    {option.id === view?.id && (
                      <CustomIcon
                        name="checkmark"
                        className="h-3 w-3"
                        aria-hidden
                      />
                    )}
                  </span>
                  {option.label}
                </button>
              </li>
            ))}
          </ToolbarDropdownPanel>
        </>
      )}
    </Popover>
  )
}
