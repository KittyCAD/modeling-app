import { LayoutType } from '@src/lib/layout/types'
import type {
  SplitLayout as SplitLayoutType,
  PaneLayout as PaneLayoutType,
  Closeable,
  Direction,
  Layout,
  PaneChild,
  Action,
  Side,
} from '@src/lib/layout/types'
import {
  getResizeHandleElement,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels'
import { CustomIcon } from '@src/components/CustomIcon'
import { Switch } from '@headlessui/react'
import { createContext, Fragment, useContext, useEffect, useRef } from 'react'
import {
  getOppositeSide,
  getOppositionDirection,
  logicalSideToTooltipPosition,
  sideToSplitDirection,
  sideToReactCss,
  sideToTailwindLayoutDirection,
  sideToTailwindTabDirection,
  findAndUpdateSplitSizes,
  findAndReplaceLayoutChildNode,
  shouldEnableResizeHandle,
  orientationToReactCss,
  sideToOrientation,
  orientationToDirection,
  togglePaneLayoutNode,
  shouldDisableFlex,
  defaultLayout,
} from '@src/lib/layout/utils'
import { saveLayout } from '@src/lib/layout/save'
import type {
  IUpdateNodeSizes,
  IReplaceLayoutChildNode,
  ITogglePane,
} from '@src/lib/layout/utils'
import type { AreaTypeDefinition } from '@src/lib/layout/areaTypeRegistry'
import { areaTypeRegistry } from '@src/lib/layout/areaTypeRegistry'
import Tooltip from '@src/components/Tooltip'
import { actionTypeRegistry } from '@src/lib/layout/actionTypeRegistry'
import {
  ContextMenu,
  ContextMenuDivider,
  ContextMenuItem,
  type ContextMenuProps,
} from '@src/components/ContextMenu'
import { isArray, platform } from '@src/lib/utils'
import { useHotkeys } from 'react-hotkeys-hook'
import { hotkeyDisplay } from '../hotkeyWrapper'
import usePlatform from '@src/hooks/usePlatform'

const ENABLE_CONTEXT_MENUS = false

type WithoutRootLayout<T> = Omit<T, 'rootLayout'>
interface LayoutState {
  areaLibrary: Record<keyof typeof areaTypeRegistry, AreaTypeDefinition>
  updateSplitSizes: (props: WithoutRootLayout<IUpdateNodeSizes>) => void
  replaceLayoutNode: (props: WithoutRootLayout<IReplaceLayoutChildNode>) => void
  togglePane: (props: WithoutRootLayout<ITogglePane>) => void
}

const LayoutStateContext = createContext<LayoutState>({
  areaLibrary: areaTypeRegistry,
  updateSplitSizes: () => {},
  replaceLayoutNode: () => {},
  togglePane: () => {},
})

export const useLayoutState = () => useContext(LayoutStateContext)

interface LayoutRootNodeProps {
  areaLibrary?: LayoutState['areaLibrary']
  layout: Layout
  getLayout: () => Layout | undefined
  setLayout: (layout: Layout) => void
  layoutName?: string
}

export function LayoutRootNode({
  areaLibrary,
  layout,
  getLayout,
  setLayout,
  layoutName = 'default',
}: LayoutRootNodeProps) {
  const getLayoutWithFallback = () => getLayout() || defaultLayout
  useEffect(() => {
    saveLayout({ layout, layoutName })
  }, [layout, layoutName])

  function updateSplitSizes(props: WithoutRootLayout<IUpdateNodeSizes>) {
    const rootLayout = getLayoutWithFallback()
    setLayout(
      findAndUpdateSplitSizes({
        rootLayout: structuredClone(rootLayout),
        ...props,
      })
    )
  }

  function replaceLayoutNode(
    props: WithoutRootLayout<IReplaceLayoutChildNode>
  ) {
    const rootLayout = getLayoutWithFallback()
    setLayout(
      findAndReplaceLayoutChildNode({
        rootLayout: structuredClone(rootLayout),
        ...props,
      })
    )
  }

  function togglePane(props: WithoutRootLayout<ITogglePane>) {
    const rootLayout = getLayoutWithFallback()
    setLayout(
      togglePaneLayoutNode({
        rootLayout: structuredClone(rootLayout),
        ...props,
      })
    )
  }

  return (
    <LayoutStateContext.Provider
      value={{
        areaLibrary: areaLibrary || areaTypeRegistry,
        updateSplitSizes,
        replaceLayoutNode,
        togglePane,
        // More API here if needed within nested layout components
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
      return areaLibrary[layout.areaType].Component({ onClose })
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

/**
 * A Split layout is a flexbox container with N areas and
 * drag handles at the interior boundaries between them,
 * which the user can drag to resize.
 */
function SplitLayoutContents({
  layout,
  direction,
  onClose,
}: {
  direction: Direction
  layout: Layout
  onClose?: (index: number) => void
}) {
  const { updateSplitSizes } = useLayoutState()
  const hasValidChildren = 'children' in layout && isArray(layout.children)
  const hasValidSizes =
    'sizes' in layout &&
    isArray(layout.sizes) &&
    layout.sizes.every(Number.isFinite)

  if (!hasValidChildren || !hasValidSizes) {
    return <></>
  }

  function onSplitDrag(newSizes: number[]) {
    updateSplitSizes({ targetNodeId: layout.id, newSizes })
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
          const disableFlex = shouldDisableFlex(a, layout)
          return (
            <Fragment
              key={`${a.id}${a.type === 'panes' ? a.activeIndices : ''}`}
            >
              <Panel
                id={a.id}
                order={i}
                defaultSize={layout.sizes[i]}
                className={`flex bg-default ${disableFlex ? '!flex-none' : ''}`}
              >
                <LayoutNode layout={a} onClose={() => onClose?.(i)} />
              </Panel>
              {i < layout.sizes.length - 1 ? (
                <ResizeHandle
                  direction={direction}
                  id={`handle-${a.id}`}
                  disabled={disableResize}
                  layout={layout}
                  currentIndex={i}
                />
              ) : null}
            </Fragment>
          )
        })}
      </PanelGroup>
    )
  )
}

/**
 * A Pane layout is a wrapper around a Split layout that
 * includes a toolbar that can allow a user to set how many
 * active splits there are in the internal Split layout.
 *
 * The toolbar can be on any side of the layout container,
 * the split direction can be set independently of toolbar side.
 *
 * The toolbar can specify an array of "actions" that appear after
 * the pane UI buttons and invoke fire-and-forget actions.
 */
function PaneLayout({ layout }: { layout: PaneLayoutType }) {
  const { togglePane } = useLayoutState()
  const paneBarRef = useRef<HTMLUListElement>(null)
  const barBorderWidthProp = `border${orientationToReactCss(sideToOrientation(layout.side))}Width`
  const nonHiddenChildren = layout.children.filter(
    (item) =>
      item.type !== LayoutType.Simple ||
      !areaTypeRegistry[item.areaType]?.hide()
  )
  const activePanes = layout.activeIndices
    .map((itemIndex) => nonHiddenChildren[itemIndex])
    .filter((item) => item !== undefined)

  const onToggleItem = (checked: boolean, i: number) => {
    togglePane({
      targetNodeId: layout.id,
      expandOrCollapse: checked,
      paneIndex: i,
    })
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
        {nonHiddenChildren.map((pane, i) => (
          <PaneButton
            key={`pane-${pane.id}`}
            pane={pane}
            childIndex={i}
            parentActiveIndices={layout.activeIndices}
            side={layout.side}
            onChange={(checked) => onToggleItem(checked, i)}
          />
        ))}
        {nonHiddenChildren.length && layout.actions?.length ? (
          <hr
            className={`bg-3 border-none ${sideToSplitDirection(layout.side) === 'vertical' ? 'w-[1px] h-full' : 'h-[1px] w-full'}`}
          />
        ) : null}
        {layout.actions?.map((action) => (
          <ActionButton key={action.id} action={action} side={layout.side} />
        ))}
        {ENABLE_CONTEXT_MENUS ? (
          <PaneLayoutContextMenu
            layout={layout}
            menuTargetElement={paneBarRef}
          />
        ) : null}
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

/**
 * Our custom styling atop of the react-resizable-panels headless component
 */
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

function PaneButton({
  pane,
  parentActiveIndices,
  side,
  childIndex,
  onChange,
}: {
  pane: PaneChild
  parentActiveIndices: number[]
  side: Side
  childIndex: number
  onChange: (checked: boolean) => void
}) {
  const platform = usePlatform()
  const { areaLibrary } = useLayoutState()
  const buttonBorderWidthProp = `border${sideToReactCss(getOppositeSide(side))}Width`
  const isActiveIndex = parentActiveIndices.indexOf(childIndex) >= 0
  const resolvedAreaType =
    pane.type === LayoutType.Simple ? areaLibrary[pane.areaType] : undefined
  useHotkeys(
    resolvedAreaType?.shortcut || '',
    () => {
      console.log('FIRE!', { pane, isActiveIndex })
      onChange(!isActiveIndex)
    },
    {
      scopes: ['modeling'],
      enabled: !!resolvedAreaType?.shortcut,
    }
  )
  return (
    <Switch
      key={pane.id}
      checked={parentActiveIndices.includes(childIndex)}
      onChange={(checked) => onChange(checked)}
      className={`ui-checked:border-primary dark:ui-checked:border-primary hover:b-3 border-transparent dark:border-transparent p-2 m-0 rounded-none border-0 hover:bg-2 ${resolvedAreaType?.cssClassOverrides?.button || ''}`}
      style={{ [buttonBorderWidthProp]: '2px' }}
    >
      <CustomIcon name={pane.icon} className="w-5 h-5" />
      <Tooltip
        position={logicalSideToTooltipPosition(getOppositeSide(side))}
        contentClassName="max-w-none flex items-center gap-4"
      >
        <span className="flex-1">{pane.label}</span>
        {resolvedAreaType?.shortcut ? (
          <kbd className="hotkey text-xs capitalize">
            {hotkeyDisplay(resolvedAreaType.shortcut, platform)}
          </kbd>
        ) : null}
      </Tooltip>
      <NotificationBadge pane={pane} />
    </Switch>
  )
}

function NotificationBadge({ pane }: { pane: PaneChild }) {
  const paneIsSimpleArea = pane.type === LayoutType.Simple
  const resolvedAreaType = paneIsSimpleArea
    ? areaTypeRegistry[pane.areaType]
    : undefined
  const notifications = resolvedAreaType?.useNotifications()
  const { value, onClick, title } = notifications || {
    value: undefined,
    onClick: () => {},
    title: undefined,
  }

  return value ? (
    <p
      id={`${pane.id}-badge`}
      className={
        'absolute m-0 p-0 top-0 right-0 min-w-3 h-3 flex items-center justify-center text-[10px] font-semibold text-white bg-primary hue-rotate-90 rounded-bl border border-chalkboard-10 dark:border-chalkboard-80 z-50 hover:cursor-pointer hover:scale-[2] transition-transform duration-200'
      }
      onClick={onClick}
      title={
        title
          ? title
          : `Click to view ${value} notification${Number(value) > 1 ? 's' : ''}`
      }
    >
      <span className="sr-only">&nbsp;has&nbsp;</span>
      {typeof value === 'number' || typeof value === 'string' ? (
        <span>{value}</span>
      ) : (
        <span className="sr-only">a</span>
      )}
      {typeof value === 'number' && (
        <span className="sr-only">
          &nbsp;notification{Number(value) > 1 ? 's' : ''}
        </span>
      )}
    </p>
  ) : null
}

function ActionButton({ action, side }: { action: Action; side: Side }) {
  const platform = usePlatform()
  const resolvedAction = actionTypeRegistry[action.actionType]
  const disabledReason = resolvedAction.useDisabled()
  const hidden = resolvedAction.useHidden()
  useHotkeys(resolvedAction.shortcut || '', () => resolvedAction.execute(), {
    scopes: ['modeling'],
    enabled: !!resolvedAction.shortcut?.length,
  })

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
          position={logicalSideToTooltipPosition(getOppositeSide(side))}
          contentClassName={`max-w-none flex flex-col gap-2 ${
            side === 'inline-start'
              ? 'text-left'
              : side === 'inline-end'
                ? 'text-right'
                : ''
          }`}
        >
          <div className="flex items-center gap-4">
            <span className="flex-1">{action.label}</span>
            {resolvedAction?.shortcut ? (
              <kbd className="hotkey text-xs capitalize">
                {hotkeyDisplay(resolvedAction.shortcut, platform)}
              </kbd>
            ) : null}
          </div>
          {disabledReason !== undefined && (
            <span className="text-3">{disabledReason}</span>
          )}
        </Tooltip>
      </button>
    )
  )
}

/**
 * A context menu that lets the user set the toolbar side and
 * split direction of a Pane type layout.
 */
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
        <ContextMenuDivider key="pane-menu-divider" />,
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
