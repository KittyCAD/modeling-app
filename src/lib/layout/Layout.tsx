import type { Direction, Layout, Orientation } from '@src/lib/layout/types'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { CustomIcon } from '@src/components/CustomIcon'
import { Tab, Switch } from '@headlessui/react'
import {
  createContext,
  type Dispatch,
  type SetStateAction,
  useContext,
  useMemo,
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
} from '@src/lib/layout/utils'
import { areaTypeRegistry } from '@src/lib/layout/areaTypeRegistry'
import { basicLayout } from '@src/lib/layout/basicLayout'
import Tooltip from '@src/components/Tooltip'

interface LayoutState {
  layout: SetStateAction<Layout>
  setLayout: Dispatch<SetStateAction<Layout>>
}

const LayoutStateContext = createContext<LayoutState>({
  layout: basicLayout,
  setLayout: () => {},
})

export const useLayoutState = () => useContext(LayoutStateContext)

export function LayoutRoot() {
  const [layout, setLayout] = useState<Layout>(basicLayout)

  return (
    <LayoutStateContext.Provider value={{ layout, setLayout }}>
      <LayoutNode {...layout} />
    </LayoutStateContext.Provider>
  )
}

/*
 * A layout is a nested set of Areas (Splits, Tabs, or Toolbars),
 * ending in leaf nodes that contain UI components.
 */
function LayoutNode(layout: Layout) {
  switch (layout.type) {
    case 'splits':
      return <SplitLayout {...layout} />
    case 'tabs':
      return <TabLayout {...layout} />
    case 'panes':
      return <PaneLayout {...layout} />
    default:
      return areaTypeRegistry[layout.areaType]
  }
}

/**
 * Need to see if we should just roll our own resizable component?
 */
function SplitLayout(layout: Layout & { type: 'splits' }) {
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
  layout: Omit<Layout & { type: 'splits' }, 'orientation' | 'type'>
  direction: Direction
}) {
  return (
    layout.children.length && (
      <PanelGroup id={layout.id} direction={direction} className="bg-3">
        {layout.children.map((a, i, arr) => {
          const isLastChild = i >= arr.length - 1
          return (
            <>
              <Panel
                key={a.id}
                id={a.id}
                defaultSize={layout.sizes[i]}
                className="flex bg-default"
              >
                <LayoutNode {...a} />
              </Panel>
              {!isLastChild && (
                <ResizeHandle direction={direction} id={`handle-${a.id}`} />
              )}
            </>
          )
        })}
      </PanelGroup>
    )
  )
}

/**
 * Use headless UI tabs
 */
function TabLayout(layout: Layout & { type: 'tabs' }) {
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
              <LayoutNode {...tab} />
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
function PaneLayout(layout: Layout & { type: 'panes' }) {
  const [activeIndices, setActiveItems] = useState(layout.activeIndices)
  const activePanes = useMemo(
    () => activeIndices.map((index) => layout.children[index]),
    [layout.children, activeIndices]
  )
  const sideBorderWidthProp = `border${sideToReactCss(getOppositeSide(layout.side))}Width`
  const onChange = (checked: boolean, i: number) => {
    setActiveItems((items) => {
      const isInActiveItems = items.indexOf(i) >= 0
      if (checked) {
        if (isInActiveItems) {
          return items
        }
        return [...items, i].sort()
      }
      return [...items.filter((a) => a !== i)]
    })
  }
  return (
    <div
      className={`flex-1 flex ${sideToTailwindLayoutDirection(layout.side)}`}
    >
      <ul
        className={`flex border-solid b-3 ${sideToTailwindTabDirection(layout.side)}`}
        style={{ [sideBorderWidthProp]: '1px' }}
      >
        {layout.children.map((tab, i) => {
          return (
            <Switch
              key={tab.id}
              checked={activeIndices.includes(i)}
              onChange={(checked) => onChange(checked, i)}
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
        <LayoutNode {...activePanes[0]} />
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
