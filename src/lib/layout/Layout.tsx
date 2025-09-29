import { Resizable } from 're-resizable'
import type { Layout } from '@src/lib/layout/types'
import styles from './Layout.module.css'

/*
 * A layout is a nested set of Areas (Splits, Tabs, or Toolbars),
 * ending in leaf nodes that contain UI components.
 */
export function LayoutNode(layout: Layout) {
  switch (layout.type) {
    case 'splits':
      return <SplitLayout {...layout} />
    case 'tabs':
      return <TabLayout {...layout} />
    case 'toolbar':
      return <ToolbarLayout {...layout} />
    default:
      return layout.component
  }
}

/**
 * Need to see if we should just roll our own resizable component?
 */
function SplitLayout(layout: Layout & { type: 'splits' }) {
  const className = [styles.layout, styles.splitLayout].join(' ')
  return (
    <div className={className}>
      {layout.children.map((a, i) => (
        <Resizable>
          <LayoutNode {...a} />
        </Resizable>
      ))}
    </div>
  )
}

/**
 * Use headless UI tabs
 */
function TabLayout(layout: Layout & { type: 'tabs' }) {
  const className = [styles.layout, styles.tabLayout].join(' ')
  return (
    <div className={className}>
      <p>TABS</p>
      <pre>{JSON.stringify(layout, null, 2)}</pre>
    </div>
  )
}

/**
 * Use headless UI tabs if they can have multiple active items
 * with resizable panes
 */
function ToolbarLayout(layout: Layout & { type: 'toolbar' }) {
  const className = [styles.layout, styles.toolbarLayout].join(' ')
  return (
    <div className={className}>
      <p>TOOLBAR</p>
      <pre>{JSON.stringify(layout, null, 2)}</pre>
    </div>
  )
}
