import { Tab } from '@headlessui/react'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
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
 * TODO: Consider consolidating with LayoutType.Panes using side: 'block-start'
 * once shared panes support labeled tabs and closing content separately from hiding a pane.
 * or TODO: consider just using shadcn or whatever tab component we have off the shelf.
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
}: {
  label: string
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
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      data-position={position}
      selectedIndex={selectedIndex}
      onChange={(index) => onChange(items[index].id)}
    >
      <div
        className={`flex min-h-7 min-w-0 shrink-0 items-stretch border-chalkboard-30 bg-chalkboard-20 dark:border-chalkboard-80 dark:bg-chalkboard-90 ${position === 'bottom' ? 'order-last border-t' : 'border-b'}`}
      >
        {prefix && <div className="flex shrink-0 items-center">{prefix}</div>}
        {items.length > 0 && (
          <Tab.List
            aria-label={label}
            className="flex min-w-0 gap-0 overflow-x-auto"
          >
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
                    onClick={item.close.onClose}
                    className={styles.closeButton}
                  >
                    <CustomIcon name="close" className="h-3 w-3" aria-hidden />
                    {item.close.tooltip && (
                      <Tooltip position="bottom-right">
                        {item.close.tooltip}
                      </Tooltip>
                    )}
                  </button>
                )}
              </div>
            ))}
          </Tab.List>
        )}
        {postfix && (
          <div
            className={`flex shrink-0 items-center ${postfixAlign === 'end' ? 'ms-auto' : ''}`}
          >
            {postfix}
          </div>
        )}
      </div>
      {items.length === 0 ? (
        emptyState
      ) : (
        <Tab.Panels className="min-h-0 flex-1">
          {tabs.map(({ item, key }, index) => (
            <Tab.Panel key={key} unmount={false} className="h-full min-h-0">
              {item.renderPanel(index === selectedIndex)}
            </Tab.Panel>
          ))}
        </Tab.Panels>
      )}
    </Tab.Group>
  )
}
