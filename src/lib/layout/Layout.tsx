import { LayoutType } from '@src/lib/layout/types'
import type {
  SplitLayout as SplitLayoutType,
  PaneLayout as PaneLayoutType,
  Closeable,
  Direction,
  Layout,
} from '@src/lib/layout/types'
import {
  getResizeHandleElement,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels'
import { CustomIcon } from '@src/components/CustomIcon'
import { Switch } from '@headlessui/react'
import {
  createContext,
  type Dispatch,
  Fragment,
  type SetStateAction,
  useContext,
  useEffect,
  useRef,
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
  areSplitSizesNatural,
  collapseSplitChildPaneNode,
  expandSplitChildPaneNode,
  shouldEnableResizeHandle,
  orientationToReactCss,
  sideToOrientation,
  orientationToDirection,
} from '@src/lib/layout/utils'
import type {
  IUpdateNodeSizes,
  IReplaceLayoutChildNode,
  IRootAndTargetLayouts,
} from '@src/lib/layout/utils'
import { areaTypeRegistry } from '@src/lib/layout/areaTypeRegistry'
import Tooltip from '@src/components/Tooltip'
import { actionTypeRegistry } from '@src/lib/layout/actionTypeRegistry'
import {
  ContextMenu,
  ContextMenuItem,
  type ContextMenuProps,
} from '@src/components/ContextMenu'
import { isArray } from '@src/lib/utils'

const ENABLE_CONTEXT_MENUS = false

type WithoutRootLayout<T> = Omit<T, 'rootLayout'>
interface LayoutState {
  areaLibrary: Record<
    keyof typeof areaTypeRegistry,
    (props: Partial<Closeable>) => React.ReactElement
  >
  updateLayoutNodeSizes: (props: WithoutRootLayout<IUpdateNodeSizes>) => void
  replaceLayoutNode: (props: WithoutRootLayout<IReplaceLayoutChildNode>) => void
  collapsePaneInParentSplit: (
    props: WithoutRootLayout<IRootAndTargetLayouts>
  ) => void
  expandPaneInParentSplit: (
    props: WithoutRootLayout<IRootAndTargetLayouts>
  ) => void
}

const LayoutStateContext = createContext<LayoutState>({
  areaLibrary: areaTypeRegistry,
  updateLayoutNodeSizes: () => {},
  replaceLayoutNode: () => {},
  collapsePaneInParentSplit: () => {},
  expandPaneInParentSplit: () => {},
})

export const useLayoutState = () => useContext(LayoutStateContext)

interface LayoutRootNodeProps {
  areaLibrary?: LayoutState['areaLibrary']
  layout: Layout
  setLayout: Dispatch<SetStateAction<Layout>>
  layoutName?: string
}

export function LayoutRootNode({
  areaLibrary,
  layout,
  setLayout,
  layoutName = 'default',
}: LayoutRootNodeProps) {
  useEffect(() => {
    saveLayout({ layout, layoutName })
  }, [layout, layoutName])

  function updateLayoutNodeSizes(props: WithoutRootLayout<IUpdateNodeSizes>) {
    setLayout((rootLayout) =>
      findAndUpdateSplitSizes({
        rootLayout: structuredClone(rootLayout),
        ...props,
      })
    )
  }

  function replaceLayoutNode(
    props: WithoutRootLayout<IReplaceLayoutChildNode>
  ) {
    setLayout((rootLayout) =>
      findAndReplaceLayoutChildNode({
        rootLayout: structuredClone(rootLayout),
        ...props,
      })
    )
  }

  function collapsePaneInParentSplit(
    props: WithoutRootLayout<IRootAndTargetLayouts>
  ) {
    setLayout((rootLayout) => {
      console.log('oldLayout is', rootLayout)
      const newLayout = collapseSplitChildPaneNode({
        rootLayout: structuredClone(rootLayout),
        ...props,
      })
      console.log('newLayout is', newLayout)
      return newLayout
    })
  }

  function expandPaneInParentSplit(
    props: WithoutRootLayout<IRootAndTargetLayouts>
  ) {
    setLayout((rootLayout) =>
      expandSplitChildPaneNode({
        rootLayout: structuredClone(rootLayout),
        ...props,
      })
    )
  }

  return (
    <LayoutStateContext.Provider
      value={{
        areaLibrary: areaLibrary || areaTypeRegistry,
        updateLayoutNodeSizes,
        replaceLayoutNode,
        collapsePaneInParentSplit,
        expandPaneInParentSplit,
        // More API here
      }}
    >
      <LayoutNode layout={layout} />
    </LayoutStateContext.Provider>
  )
}

/*
 * A layout is a nested set of Areas (Splits or Panes),
 * ending in leaf nodes that contain UI components.
 */
function LayoutNode({
  layout,
  onClose,
}: { layout: Layout } & Partial<Closeable>) {
  const { areaLibrary } = useLayoutState()
  switch (layout.type) {
    case LayoutType.Splits:
      return <SplitLayout layout={layout} />
    case LayoutType.Panes:
      return <PaneLayout layout={layout} />
    default:
      return areaLibrary[layout.areaType]({ onClose })
  }
}

/**
 * Need to see if we should just roll our own resizable component?
 */
function SplitLayout({ layout }: { layout: SplitLayoutType }) {
  return (
    <SplitLayoutContents
      direction={orientationToDirection(layout.orientation)}
      layout={layout}
    />
  )
}

function SplitLayoutContents({
  layout,
  direction,
  onClose,
}: {
  direction: Direction
  layout: Layout
  onClose?: (index: number) => void
}) {
  const { updateLayoutNodeSizes } = useLayoutState()
  const hasValidChildren = 'children' in layout && isArray(layout.children)
  const hasValidSizes =
    'sizes' in layout &&
    isArray(layout.sizes) &&
    layout.sizes.every(Number.isFinite)

  if (!hasValidChildren || !hasValidSizes) {
    return <></>
  }

  function onSplitDrag(newSizes: number[]) {
    updateLayoutNodeSizes({ targetNode: layout, newSizes })
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
          const disableResize = !shouldEnableResizeHandle(a, i, arr)
          return (
            <Fragment
              key={`${a.id}${a.type === 'panes' ? a.activeIndices : ''}`}
            >
              <Panel
                id={a.id}
                order={i}
                defaultSize={layout.sizes[i]}
                className="flex bg-default"
              >
                <LayoutNode layout={a} onClose={() => onClose?.(i)} />
              </Panel>
              <ResizeHandle
                direction={direction}
                id={`handle-${a.id}`}
                disabled={disableResize}
                layout={layout}
                currentIndex={i}
              />
            </Fragment>
          )
        })}
      </PanelGroup>
    )
  )
}

/**
 * Use headless UI tabs if they can have multiple active items
 * with resizable panes
 */
function PaneLayout({ layout }: { layout: PaneLayoutType }) {
  const {
    replaceLayoutNode,
    collapsePaneInParentSplit,
    expandPaneInParentSplit,
  } = useLayoutState()
  const paneBarRef = useRef<HTMLUListElement>(null)
  const barBorderWidthProp = `border${orientationToReactCss(sideToOrientation(layout.side))}Width`
  const buttonBorderWidthProp = `border${sideToReactCss(getOppositeSide(layout.side))}Width`
  const activePanes = layout.activeIndices
    .map((itemIndex) => layout.children[itemIndex])
    .filter((item) => item !== undefined)

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
          layout.sizes = Array(layout.activeIndices.length).fill(
            100 / layout.activeIndices.length
          )
        } else {
          const activeIndexToSplit =
            newActiveIndex === 0 ? 1 : newActiveIndex - 1
          const halfSize = (layout.sizes[activeIndexToSplit] || 2) / 2
          layout.sizes[activeIndexToSplit] = halfSize
          layout.sizes.splice(newActiveIndex, 0, halfSize)
        }
      } else if (layout.sizes.length === 1) {
        layout.sizes = [50, 50]
      } else {
        layout.sizes = [100]
        expandPaneInParentSplit({ targetNode: layout })
        return
      }

      console.log('gonna pop in this pane real quick')
      replaceLayoutNode({ targetNodeId: layout.id, newNode: layout })
    } else if (!checked && isInActiveItems) {
      layout.activeIndices.splice(indexInActiveItems, 1)

      if (layout.sizes.length > 1) {
        const removedSize = layout.sizes.splice(indexInActiveItems, 1)
        layout.sizes[indexInActiveItems === 0 ? 0 : indexInActiveItems - 1] +=
          removedSize[0]
      } else {
        console.log(
          'this was our only opened pane that we are closing, collapse!'
        )
        layout.activeIndices = []
        layout.sizes = []
        collapsePaneInParentSplit({ targetNode: layout })
        return
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
        ref={paneBarRef}
        className={`flex border-solid b-4 ${sideToTailwindTabDirection(layout.side)}`}
        style={{ [barBorderWidthProp]: '1px' }}
        data-pane-toolbar
      >
        {layout.children.map((tab, i) => {
          return (
            <Switch
              key={tab.id}
              checked={layout.activeIndices.includes(i)}
              onChange={(checked) => onToggleItem(checked, i)}
              className="ui-checked:border-primary dark:ui-checked:border-primary hover:b-3 border-transparent dark:border-transparent p-2 m-0 rounded-none border-0 hover:bg-2"
              style={{ [buttonBorderWidthProp]: '2px' }}
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
        {layout.children.length && layout.actions?.length && (
          <hr
            className={`bg-3 border-none ${sideToSplitDirection(layout.side) === 'vertical' ? 'w-[1px] h-full' : 'h-[1px] w-full'}`}
          />
        )}
        {layout.actions?.map((action) => {
          const resolvedAction = actionTypeRegistry[action.actionType]
          const disabledReason = resolvedAction.useDisabled()
          const hidden = resolvedAction.useHidden()

          return (
            !hidden && (
              <button
                key={action.id}
                type="button"
                className="hover:b-3 border-transparent p-2 m-0 rounded-none border-0 hover:bg-2"
                disabled={disabledReason !== undefined}
                onClick={() => resolvedAction.execute()}
              >
                <CustomIcon name={action.icon} className="w-5 h-5" />
                <Tooltip
                  position={logicalSideToTooltipPosition(
                    getOppositeSide(layout.side)
                  )}
                  contentClassName={
                    layout.side === 'inline-start'
                      ? 'text-left'
                      : layout.side === 'inline-end'
                        ? 'text-right'
                        : ''
                  }
                >
                  {action.label}
                  {disabledReason !== undefined && (
                    <>
                      <br />
                      <span className="text-3">{disabledReason}</span>
                    </>
                  )}
                </Tooltip>
              </button>
            )
          )
        })}
        {ENABLE_CONTEXT_MENUS && (
          <PaneLayoutContextMenu
            layout={layout}
            menuTargetElement={paneBarRef}
          />
        )}
      </ul>
      {activePanes.length === 0 ? (
        <></>
      ) : activePanes.length === 1 ? (
        <LayoutNode
          layout={activePanes[0]}
          onClose={() => onToggleItem(false, layout.activeIndices[0])}
        />
      ) : (
        <SplitLayoutContents
          direction={
            orientationToDirection(layout.splitOrientation) ||
            getOppositionDirection(sideToSplitDirection(layout.side))
          }
          layout={{
            ...layout,
            children: layout.children.filter(
              (_, i) => layout.activeIndices.indexOf(i) >= 0
            ),
          }}
          onClose={(index: number) =>
            onToggleItem(false, layout.activeIndices[index])
          }
        />
      )}
    </div>
  )
}

function ResizeHandle({
  direction,
  id,
  disabled,
}: {
  direction: Direction
  id: string
  disabled: boolean
  layout: Layout
  currentIndex: number
}) {
  const handleRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    handleRef.current = getResizeHandleElement(id)
  }, [id])
  return (
    <PanelResizeHandle
      disabled={disabled}
      className={`relative group/handle ${direction === 'vertical' ? 'h-0.5' : 'w-0.5'} ${disabled ? 'bg-default' : ''}`}
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

function PaneLayoutContextMenu({
  layout,
  ...props
}: Omit<ContextMenuProps, 'items'> & { layout: Layout }) {
  const { replaceLayoutNode } = useLayoutState()
  if (layout.type !== LayoutType.Panes) {
    return <></>
  }
  return (
    <ContextMenu
      {...props}
      items={[
        <ContextMenuItem
          key="set-left"
          icon={layout.side === 'inline-start' ? 'checkmark' : 'arrowLeft'}
          onClick={() =>
            replaceLayoutNode({
              targetNodeId: layout.id,
              newNode: { ...layout, side: 'inline-start' },
            })
          }
        >
          Set to left side
        </ContextMenuItem>,
        <ContextMenuItem
          key="set-right"
          icon={layout.side === 'inline-end' ? 'checkmark' : 'arrowRight'}
          onClick={() =>
            replaceLayoutNode({
              targetNodeId: layout.id,
              newNode: { ...layout, side: 'inline-end' },
            })
          }
        >
          Set to right side
        </ContextMenuItem>,
        <ContextMenuItem
          key="set-top"
          icon={layout.side === 'block-start' ? 'checkmark' : 'arrowUp'}
          onClick={() =>
            replaceLayoutNode({
              targetNodeId: layout.id,
              newNode: { ...layout, side: 'block-start' },
            })
          }
        >
          Set to top side
        </ContextMenuItem>,
        <ContextMenuItem
          key="set-bottom"
          icon={layout.side === 'block-end' ? 'checkmark' : 'arrowDown'}
          onClick={() =>
            replaceLayoutNode({
              targetNodeId: layout.id,
              newNode: { ...layout, side: 'block-end' },
            })
          }
        >
          Set to bottom side
        </ContextMenuItem>,
        <ContextMenuItem
          key="close-all"
          icon="collapse"
          onClick={() =>
            replaceLayoutNode({
              targetNodeId: layout.id,
              newNode: { ...layout, activeIndices: [], sizes: [] },
            })
          }
        >
          Close all panes
        </ContextMenuItem>,
        <ContextMenuItem
          key="orient-inline"
          icon={
            layout.splitOrientation === 'inline' ? 'checkmark' : 'horizontal'
          }
          onClick={() =>
            replaceLayoutNode({
              targetNodeId: layout.id,
              newNode: { ...layout, splitOrientation: 'inline' },
            })
          }
        >
          Horizontal splits
        </ContextMenuItem>,
        <ContextMenuItem
          key="orient-block"
          icon={layout.splitOrientation === 'block' ? 'checkmark' : 'vertical'}
          onClick={() =>
            replaceLayoutNode({
              targetNodeId: layout.id,
              newNode: { ...layout, splitOrientation: 'block' },
            })
          }
        >
          Vertical splits
        </ContextMenuItem>,
      ]}
    />
  )
}
