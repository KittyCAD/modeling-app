import { Popover, Portal } from '@headlessui/react'
import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
} from '@floating-ui/dom'
import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import styles from './TabPicker.module.css'

/** Presentation-only choices: callers retain the selected ID and its domain meaning. */
export interface TabPickerOption {
  id: string
  label: string
}

/** A portaled panel keeps choices outside the tab strip's horizontal scroll clipping. */
function PickerPanel({
  buttonRef,
  children,
}: {
  buttonRef: RefObject<HTMLButtonElement | null>
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const button = buttonRef.current
    const panel = panelRef.current
    if (!button || !panel) return
    let disposed = false
    const update = () => {
      void computePosition(button, panel, {
        strategy: 'fixed',
        placement: 'bottom-start',
        middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        if (!disposed)
          Object.assign(panel.style, {
            left: `${x}px`,
            top: `${y}px`,
            visibility: 'visible',
          })
      })
    }
    const stop = autoUpdate(button, panel, update)
    return () => {
      disposed = true
      stop()
    }
  }, [buttonRef])
  return (
    <Popover.Panel
      ref={panelRef}
      className={styles.panel}
      style={{ visibility: 'hidden' }}
    >
      <ul className={styles.options}>{children}</ul>
    </Popover.Panel>
  )
}

/** Compact choice control beside a tab label; a single choice renders as a passive label. */
export function TabPicker({
  label,
  title = 'Choose option',
  value,
  options,
  onFocus,
  onChange,
  placeholder = 'Unavailable',
  expandIcon,
  selectedIcon,
}: {
  label: string
  title?: string
  value: string | undefined
  options: readonly TabPickerOption[]
  onFocus?: () => void
  onChange: (id: string) => void
  placeholder?: string
  expandIcon?: ReactNode
  selectedIcon?: ReactNode
}) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const selected = options.find((option) => option.id === value)
  const canChoose = options.length > 1 || (!selected && options.length > 0)
  if (!canChoose)
    return (
      <span className={styles.label} title={selected?.label}>
        {selected?.label ?? placeholder}
      </span>
    )
  return (
    <Popover
      className={styles.root}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {({ open }) => (
        <>
          <Popover.Button
            ref={buttonRef}
            aria-label={label}
            title={title}
            onFocus={onFocus}
            className={styles.button}
          >
            <span className={styles.text}>
              {selected?.label ?? placeholder}
            </span>
            {expandIcon ?? (
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                aria-hidden="true"
              >
                <path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" />
              </svg>
            )}
          </Popover.Button>
          {open && (
            <Portal>
              <PickerPanel buttonRef={buttonRef}>
                {options.map((option) => (
                  <li key={option.id}>
                    <Popover.Button
                      as="button"
                      type="button"
                      className={styles.option}
                      aria-pressed={option.id === value}
                      onClick={() => onChange(option.id)}
                    >
                      <span className={styles.check}>
                        {option.id === value &&
                          (selectedIcon ?? (
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 12 12"
                              aria-hidden="true"
                            >
                              <path
                                d="m2 6 2.5 2.5L10 3"
                                fill="none"
                                stroke="currentColor"
                              />
                            </svg>
                          ))}
                      </span>
                      {option.label}
                    </Popover.Button>
                  </li>
                ))}
              </PickerPanel>
            </Portal>
          )}
        </>
      )}
    </Popover>
  )
}
