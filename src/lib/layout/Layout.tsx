import type { Layout, Orientation } from '@src/lib/layout/types'
import styles from './Layout.module.css'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { CustomIcon } from '@src/components/CustomIcon'

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

function ResizeHandle({
  orientation,
  id,
}: { orientation: Orientation; id: string }) {
  return (
    <PanelResizeHandle className="relative group/handle w-0.5" id={id}>
      <div className={styles.resizeHandle}>
        <CustomIcon
          className={`w-4 h-4 -mx-0.5 ${orientation === 'inline' ? 'rotate-90' : ''}`}
          name="sixDots"
        />
      </div>
    </PanelResizeHandle>
  )
}

/**
 * Need to see if we should just roll our own resizable component?
 */
function SplitLayout(layout: Layout & { type: 'splits' }) {
  const className = [
    styles.layout,
    styles.split,
    styles[`orientation-${layout.orientation}`],
  ].join(' ')

  return (
    <PanelGroup
      direction={layout.orientation === 'inline' ? 'horizontal' : 'vertical'}
      className={className}
    >
      {layout.children.map((a, i, arr) => {
        const isLastChild = i >= arr.length - 1
        return (
          <>
            <Panel
              key={a.id}
              id={a.id}
              defaultSize={layout.sizes[i]}
              style={{
                backgroundColor: `oklch(60% .2 ${((i + 80) * 45) % 360}deg`,
              }}
            >
              <LayoutNode {...a} />
            </Panel>
            {!isLastChild && (
              <ResizeHandle
                orientation={layout.orientation}
                id={`handle-${a.id}`}
              />
            )}
          </>
        )
      })}
    </PanelGroup>
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
    </div>
  )
}
