import { Tab } from '@headlessui/react'
import { useEffect, useRef, type ReactNode } from 'react'
import styles from './Tabs.module.css'

/** A tab's identity, presentation, optional close action, and persistent panel. */
export interface TabItem<Id> {
  id: Id
  label: ReactNode
  title?: string
  /** A control beside the tab button, within the same tab outline. */
  accessory?: ReactNode
  close?: {
    label: string
    tooltip?: string
    onClose: () => void
  }
  renderPanel: (selected: boolean) => ReactNode
}

/**
 * Controlled, compact tabs with panels that remain mounted when inactive.
 */
export function Tabs<Id extends string | number | symbol>({
  label,
  items,
  selectedId,
  onChange,
  prefix,
  postfix,
  postfixAlign = 'start',
  emptyState,
  position = 'top',
  closeIcon,
}: {
  label: string
  closeIcon?: ReactNode
  position?: 'top' | 'bottom'
  items: readonly TabItem<Id>[]
  selectedId: Id | null
  onChange: (id: Id) => void
  /** Controls before and after the tab list, outside its keyboard navigation. */
  prefix?: ReactNode
  postfix?: ReactNode
  /** Keep controls beside the tabs, or pin them to the trailing edge of the strip. */
  postfixAlign?: 'start' | 'end'
  /** Keeps the strip's controls available when there are no tabs. */
  emptyState?: ReactNode
}) {
  // Symbols are useful identities but cannot be React keys. Labels need not be unique.
  const keys = useRef(new Map<Id, number>())
  const nextKey = useRef(0)
  const tabs = items.map((item) => {
    if (!keys.current.has(item.id)) keys.current.set(item.id, nextKey.current++)
    return { item, key: keys.current.get(item.id)! }
  })
  useEffect(() => {
    const ids = new Set(items.map(({ id }) => id))
    for (const id of keys.current.keys()) {
      if (!ids.has(id)) keys.current.delete(id)
    }
  }, [items])
  if (items.length === 0 && !prefix && !postfix && !emptyState) return null
  const selectedIndex = Math.max(
    0,
    items.findIndex(({ id }) => id === selectedId)
  )

  return (
    <Tab.Group
      as="div"
      className={styles.root}
      data-position={position}
      selectedIndex={selectedIndex}
      onChange={(index) => onChange(items[index].id)}
    >
      <div className={styles.strip} data-position={position}>
        {prefix && <div className={styles.controls}>{prefix}</div>}
        {items.length > 0 && (
          <Tab.List aria-label={label} className={styles.list}>
            {tabs.map(({ item, key }, index) => (
              <div
                key={key}
                className={styles.tabItem}
                data-position={position}
                data-selected={index === selectedIndex}
                data-closable={!!item.close}
                data-accessory={!!item.accessory}
              >
                <Tab
                  title={item.title}
                  className={styles.tab}
                  onKeyDown={(event) => {
                    if (event.key === 'Delete' && item.close) {
                      event.preventDefault()
                      item.close.onClose()
                    }
                  }}
                >
                  {item.label}
                </Tab>
                {item.accessory && (
                  <div className={styles.accessory}>{item.accessory}</div>
                )}
                {item.close && (
                  <button
                    type="button"
                    aria-label={item.close.label}
                    title={item.close.tooltip}
                    onClick={item.close.onClose}
                    className={styles.closeButton}
                  >
                    {closeIcon ?? (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        aria-hidden="true"
                      >
                        <path
                          d="m3 3 6 6m0-6-6 6"
                          fill="none"
                          stroke="currentColor"
                        />
                      </svg>
                    )}
                  </button>
                )}
              </div>
            ))}
          </Tab.List>
        )}
        {postfix && (
          <div className={styles.controls} data-align={postfixAlign}>
            {postfix}
          </div>
        )}
      </div>
      {items.length === 0 ? (
        emptyState
      ) : (
        <Tab.Panels className={styles.panels}>
          {tabs.map(({ item, key }, index) => (
            <Tab.Panel key={key} unmount={false} className={styles.panel}>
              {item.renderPanel(index === selectedIndex)}
            </Tab.Panel>
          ))}
        </Tab.Panels>
      )}
    </Tab.Group>
  )
}
