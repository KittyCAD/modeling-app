import type { Direction, Layout } from '@src/lib/layout/types'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { CustomIcon } from '@src/components/CustomIcon'
import { Tab, Switch } from '@headlessui/react'
import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  getOppositeSide,
  getOppositionDirection,
  logicalSideToTooltipPosition,
  sideToSplitDirection,
  sideToReactCss,
  sideToTailwindLayoutDirection,
  sideToTailwindTabDirection,
  findAndUpdateSplitSizes,
  saveLayout,
  findAndReplaceLayoutChildNode,
  loadLayout,
  areSplitSizesNatural,
} from '@src/lib/layout/utils'
import type {
  IUpdateNodeSizes,
  IReplaceLayoutChildNode,
} from '@src/lib/layout/utils'
import { areaTypeRegistry } from '@src/lib/layout/areaTypeRegistry'
import { basicLayout } from '@src/lib/layout/basicLayout'
import Tooltip from '@src/components/Tooltip'

type WithoutRootLayout<T> = Omit<T, 'rootLayout'>
interface LayoutState {
  areaLibrary: Record<keyof typeof areaTypeRegistry, () => React.ReactElement>
  updateLayoutNodeSizes: (
    props: WithoutRootLayout<IUpdateNodeSizes>
  ) => void
  replaceLayoutNode: (props: WithoutRootLayout<IReplaceLayoutChildNode>) => void
}

const LayoutStateContext = createContext<LayoutState>({
  areaLibrary: areaTypeRegistry,
  updateLayoutNodeSizes: () => { },
  replaceLayoutNode: () => { },
})

export const useLayoutState = () => useContext(LayoutStateContext)

interface LayoutRootProps {
  areaLibrary?: LayoutState['areaLibrary']
  initialLayout?: Layout
}

const maybePersistedLayout = loadLayout('basic')
export function LayoutRoot(props: LayoutRootProps) {
  const [layout, setLayout] = useState<Layout>(
    props.initialLayout || maybePersistedLayout || basicLayout
  )

  useEffect(() => {
    saveLayout(layout)
  }, [layout])

  function updateLayoutNodeSizes(
    props: WithoutRootLayout<IUpdateNodeSizes>
  ) {
    setLayout(rootLayout => findAndUpdateSplitSizes({ rootLayout: structuredClone(rootLayout), ...props }))
  }

  function replaceLayoutNode(
    props: WithoutRootLayout<IReplaceLayoutChildNode>
  ) {
    setLayout(rootLayout => findAndReplaceLayoutChildNode({ rootLayout: structuredClone(rootLayout), ...props }))
  }


  return (
    <LayoutStateContext.Provider
      value={{
        areaLibrary: props.areaLibrary || areaTypeRegistry,
        updateLayoutNodeSizes,
        replaceLayoutNode,
        // More API here
      }}
    >
      <LayoutNode layout={layout} />
    </LayoutStateContext.Provider>
  )
}

/*
 * A layout is a nested set of Areas (Splits, Tabs, or Toolbars),
 * ending in leaf nodes that contain UI components.
 */
function LayoutNode({ layout, }: { layout: Layout, }) {
  const { areaLibrary } = useLayoutState()
  switch (layout.type) {
    case 'splits':
      return <SplitLayout layout={layout} />
    case 'tabs':
      return <TabLayout layout={layout} />
    case 'panes':
      return <PaneLayout layout={layout} />
    default:
      return areaLibrary[layout.areaType]()
  }
}

/**
 * Need to see if we should just roll our own resizable component?
 */
function SplitLayout({ layout, }: { layout: Layout & { type: 'splits' }, }) {
  // Direction is simpler than Orientation, which uses logical properties.
  const orientationAsDirection =
    layout.orientation === 'inline' ? 'horizontal' : 'vertical'


  return (
    <SplitLayoutContents direction={orientationAsDirection} layout={layout} />
  )
}

function SplitLayoutContents({
  layout,
  direction,

}: {
  direction: Direction
  layout: Omit<Layout & { type: 'splits' }, 'orientation' | 'type'>

}) {
  const { updateLayoutNodeSizes } = useLayoutState()

  function onSplitDrag(
    newSizes: number[],
  ) {
    updateLayoutNodeSizes({ targetNode: layout as Layout, newSizes })
  }
  return (
    layout.children.length && (
      <PanelGroup
        id={layout.id}
        direction={direction}
        className="bg-3"
        onLayout={onSplitDrag}
      >
        {layout.children.map((a, i, arr) => {
          const isLastChild = i >= arr.length - 1
          return (
            <Fragment key={a.id}>
              <Panel
                id={a.id}
                order={i}
                defaultSize={layout.sizes[i]}
                className="flex bg-default"
              >
                <LayoutNode layout={a} />
              </Panel>
              {!isLastChild && (
                <ResizeHandle direction={direction} id={`handle-${a.id}`} />
              )}
            </Fragment>
          )
        })}
      </PanelGroup>
    )
  )
}

/**
 * Use headless UI tabs
 */
function TabLayout({ layout, }: { layout: Layout & { type: 'tabs' }, }) {
  return (
    <Tab.Group
      as="div"
      className={`flex-1 flex ${sideToTailwindLayoutDirection(layout.side)}`}
    >
      <Tab.List className={`flex ${sideToTailwindTabDirection(layout.side)}`}>
        {layout.children.map((tab) => {
          return (
            <Tab key={tab.id} className="ui-selected:bg-default">
              {tab.label}
            </Tab>
          )
        })}
      </Tab.List>
      <Tab.Panels className="flex-1">
        {layout.children.map((tab) => {
          return (
            <Tab.Panel key={tab.id}>
              <LayoutNode layout={tab} />
            </Tab.Panel>
          )
        })}
      </Tab.Panels>
    </Tab.Group>
  )
}

/**
 * Use headless UI tabs if they can have multiple active items
 * with resizable panes
 */
function PaneLayout({ layout, }: { layout: Layout & { type: 'panes' }, }) {
  const { replaceLayoutNode } = useLayoutState()
  const sideBorderWidthProp = `border${sideToReactCss(getOppositeSide(layout.side))}Width`
  const activePanes = layout.activeIndices.map((itemIndex) => layout.children[itemIndex]).filter(item => item !== undefined)
  const onToggleItem = (checked: boolean, i: number) => {
    console.log('toggley toggley', checked, i)
    const indexInActiveItems = layout.activeIndices.indexOf(i)
    const isInActiveItems = indexInActiveItems >= 0

    if (checked && !isInActiveItems) {
      layout.activeIndices.push(i)
      layout.activeIndices.sort()

      console.log('sizes?', layout.sizes)

      if (layout.sizes.length > 1) {
        const newActiveIndex = layout.activeIndices.indexOf(i)

        if (areSplitSizesNatural(layout.sizes)) {
          layout.sizes = Array(layout.activeIndices.length).fill(100 / layout.activeIndices.length)
        } else {
          const activeIndexToSplit = newActiveIndex === 0 ? 1 : newActiveIndex - 1
          const halfSize = (layout.sizes[activeIndexToSplit] || 2) / 2
          layout.sizes[activeIndexToSplit] = halfSize
          layout.sizes.splice(newActiveIndex, 0, halfSize)
        }
      } else if (layout.sizes.length === 1) {
        layout.sizes = [50, 50]
      } else {
        layout.sizes = [100]
      }

      console.log('gonna pop in this pane real quick')
      replaceLayoutNode({ targetNodeId: layout.id, newNode: layout })
    } else if (!checked && isInActiveItems) {
      layout.activeIndices.splice(indexInActiveItems, 1)

      if (layout.sizes.length > 1) {
        const removedSize = layout.sizes.splice(indexInActiveItems, 1)
        layout.sizes[indexInActiveItems === 0 ? 0 : indexInActiveItems - 1] += removedSize[0]
      } else {
        layout.sizes = []
      }

      console.log('gonna pop out this pane real quick')
      replaceLayoutNode({ targetNodeId: layout.id, newNode: layout })
    }
  }
  return (
    <div
      className={`flex-1 flex ${sideToTailwindLayoutDirection(layout.side)}`}
    >
      <ul
        className={`flex border-solid b-4 ${sideToTailwindTabDirection(layout.side)}`}
        style={{ [sideBorderWidthProp]: '1px' }}
      >
        {layout.children.map((tab, i) => {
          return (
            <Switch
              key={tab.id}
              checked={layout.activeIndices.includes(i)}
              onChange={(checked) => onToggleItem(checked, i)}
              className="ui-checked:border-primary hover:b-3 border-transparent p-2 m-0 rounded-none border-0 hover:bg-2"
              style={{ [sideBorderWidthProp]: '2px' }}
            >
              <CustomIcon name={tab.icon} className="w-5 h-5" />
              <Tooltip
                position={logicalSideToTooltipPosition(
                  getOppositeSide(layout.side)
                )}
              >
                {tab.label}
              </Tooltip>
            </Switch>
          )
        })}
      </ul>
      {activePanes.length === 0 ? (
        <></>
      ) : activePanes.length === 1 ? (
        <LayoutNode layout={activePanes[0]} />
      ) : (
        <SplitLayoutContents
          direction={getOppositionDirection(sideToSplitDirection(layout.side))}
          layout={{
            ...layout,
            children: layout.children.filter(
              (_, i) => layout.activeIndices.indexOf(i) >= 0
            ),
          }}
        />
      )}
    </div>
  )
}

function ResizeHandle({ direction, id }: { direction: Direction; id: string }) {
  return (
    <PanelResizeHandle
      className={`relative group/handle ${direction === 'vertical' ? 'h-0.5' : 'w-0.5'}`}
      id={id}
    >
      <div
        className={`hidden group-data-[resize-handle-state=hover]/handle:grid place-content-center z-10 py-1 absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 rounded-sm bg-3 border b-5 ${direction === 'horizontal' ? '' : 'rotate-90'}`}
      >
        <CustomIcon className="w-4 h-4 -mx-0.5 rotate-90" name="sixDots" />
      </div>
    </PanelResizeHandle>
  )
}
