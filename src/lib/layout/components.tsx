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
  AreaTypeDefinition,
  ActionTypeDefinition,
  ActionType,
} from '@src/lib/layout/types'
import { AreaType } from '@src/lib/layout/types'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
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
  saveLayout,
  shouldDisableFlex,
  defaultLayout,
} from '@src/lib/layout/utils'
import type {
  IUpdateNodeSizes,
  IReplaceLayoutChildNode,
  ITogglePane,
} from '@src/lib/layout/utils'
import Tooltip from '@src/components/Tooltip'
import {
  ContextMenu,
  ContextMenuDivider,
  ContextMenuItem,
  type ContextMenuProps,
} from '@src/components/ContextMenu'
import { isArray } from '@src/lib/utils'
import { useHotkeys } from 'react-hotkeys-hook'
import { hotkeyDisplay } from '@src/lib/hotkeys'
import usePlatform from '@src/hooks/usePlatform'

type WithoutRootLayout<T> = Omit<T, 'rootLayout'>
interface LayoutState {
  areaLibrary: Record<AreaType, AreaTypeDefinition>
  actionLibrary: Record<ActionType, ActionTypeDefinition>
  updateSplitSizes: (props: WithoutRootLayout<IUpdateNodeSizes>) => void
  replaceLayoutNode: (props: WithoutRootLayout<IReplaceLayoutChildNode>) => void
  togglePane: (props: WithoutRootLayout<ITogglePane>) => void
  /** Kind of a feature flag, remove in future */
  enableContextMenus: boolean
}

const nullAreaLibrary = Object.fromEntries(
  Object.values(AreaType).map((type) => [
    type,
    {
      hide: () => false,
      Component: () => <></>,
    } satisfies AreaTypeDefinition,
  ])
  // TS is so annoying, I've held its hand the entire way to this type inference but Object.fromEntries widens the key to string
) as unknown as Record<AreaType, AreaTypeDefinition>

const nullActionLibrary = Object.fromEntries(
  Object.values(AreaType).map((type) => [
    type,
    {
      execute: () => {},
    } satisfies ActionTypeDefinition,
  ])
  // TS is so annoying, I've held its hand the entire way to this type inference but Object.fromEntries widens the key to string
) as unknown as Record<ActionType, ActionTypeDefinition>

const LayoutStateContext = createContext<LayoutState>({
  areaLibrary: nullAreaLibrary,
  actionLibrary: nullActionLibrary,
  updateSplitSizes: () => {},
  replaceLayoutNode: () => {},
  togglePane: () => {},
  /** Kind of a feature flag, remove in future */
  enableContextMenus: false,
})

export const useLayoutState = () => useContext(LayoutStateContext)

interface LayoutRootNodeProps {
  areaLibrary?: LayoutState['areaLibrary']
  actionLibrary?: LayoutState['actionLibrary']
  layout: Layout
  getLayout: () => Layout | undefined
  setLayout: (layout: Layout) => void
  layoutName?: string
  /** Kind of a feature flag, remove in future */
  enableContextMenus?: boolean
}

export function LayoutRootNode({
  areaLibrary,
  actionLibrary,
  layout,
  getLayout,
  setLayout,
  layoutName = 'default',
  enableContextMenus = false,
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
        areaLibrary: areaLibrary || nullAreaLibrary,
        actionLibrary: actionLibrary || nullActionLibrary,
        updateSplitSizes,
        replaceLayoutNode,
        togglePane,
        enableContextMenus,
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
      return <SplitLayout layout={layout} key={`node-${layout.id}`} />
    case LayoutType.Panes:
      return <PaneLayout layout={layout} key={`node-${layout.id}`} />
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
  onClose?: (id: string) => void
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
            <Fragment key={`${layout.id}${a.id}`}>
              <Panel
                key={`panel-${a.id}`}
                id={a.id}
                order={i}
                defaultSize={layout.sizes[i]}
                className={`flex bg-default ${disableFlex ? '!flex-none' : ''}`}
              >
                <LayoutNode layout={a} onClose={() => onClose?.(a.id)} />
              </Panel>
              {i < layout.sizes.length - 1 ? (
                <ResizeHandle
                  direction={direction}
                  key={`handle-${a.id}`}
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
  const { togglePane, areaLibrary, enableContextMenus, replaceLayoutNode } =
    useLayoutState()
  const paneBarRef = useRef<HTMLUListElement>(null)
  const barBorderWidthProp = `border${orientationToReactCss(sideToOrientation(layout.side))}Width`
  const shouldHide = (l: PaneChild) =>
    l.type === LayoutType.Simple && areaLibrary[l.areaType]?.hide()
  const activePanes = layout.activeIndices
    .map((itemIndex) => ({
      activeIndex: itemIndex,
      item: layout.children[itemIndex],
    }))
    .filter(({ item }) => item !== undefined && !shouldHide(item))

  const onToggleItem = (checked: boolean, targetNodeId: string) => {
    togglePane({
      targetNodeId,
      shouldExpand: checked,
    })
  }

  // Remove any hidden-but-active panes from the layout on mount.
  // The File explorer is hidden in the browser but is a part of the default layout.
  // We clear it here (as opposed to earlier in the life cycle at layout parsing)
  // so that we can better ensure we have any dependencies required by `hide()`.
  useEffect(() => {
    if (activePanes.length !== layout.activeIndices.length) {
      const newNode = structuredClone(layout)
      newNode.activeIndices = activePanes.map(({ activeIndex }) => activeIndex)
      replaceLayoutNode({ targetNodeId: layout.id, newNode })
    }
  }, [activePanes, layout, replaceLayoutNode])

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
        {layout.children.map((pane, i) =>
          shouldHide(pane) ? null : (
            <PaneButton
              key={`pane-${pane.id}`}
              pane={pane}
              childIndex={i}
              parentActiveIndices={layout.activeIndices}
              side={layout.side}
              onChange={(checked) => onToggleItem(checked, pane.id)}
            />
          )
        )}
        {layout.children.length && layout.actions?.length ? (
          <hr
            className={`bg-3 border-none ${sideToSplitDirection(layout.side) === 'vertical' ? 'w-[1px] h-full' : 'h-[1px] w-full'}`}
          />
        ) : null}
        {layout.actions?.map((action) => (
          <ActionButton key={action.id} action={action} side={layout.side} />
        ))}
        {enableContextMenus ? (
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
          layout={activePanes[0].item}
          onClose={() => onToggleItem(false, activePanes[0].item.id)}
        />
      ) : (
        <SplitLayoutContents
          direction={
            orientationToDirection(layout.splitOrientation) ||
            getOppositionDirection(sideToSplitDirection(layout.side))
          }
          layout={{
            ...layout,
            children: activePanes.map(({ item }) => item),
          }}
          onClose={(id) => onToggleItem(false, id)}
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
      onChange(!isActiveIndex)
    },
    {
      scopes: ['modeling'],
      enabled: !!resolvedAreaType?.shortcut,
    }
  )
  return (
    <div
      id={`${pane.id}-button-holder`}
      className="relative"
      data-onboarding-id={`${pane.id}-pane-button`}
      key={`${pane.id}-button-holder`}
    >
      <Switch
        id={pane.id}
        name={pane.id}
        checked={parentActiveIndices.includes(childIndex)}
        aria-pressed={parentActiveIndices.includes(childIndex)}
        onChange={(checked) => onChange(checked)}
        className={`ui-checked:border-primary dark:ui-checked:border-primary hover:b-3 border-transparent dark:border-transparent p-2 m-0 rounded-none border-0 hover:bg-2 ${resolvedAreaType?.cssClassOverrides?.button || ''}`}
        style={{ [buttonBorderWidthProp]: '2px' }}
        data-testid={`${pane.id}-pane-button`}
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
    </div>
  )
}

function NotificationBadge({ pane }: { pane: PaneChild }) {
  const { areaLibrary } = useLayoutState()
  const paneIsSimpleArea = pane.type === LayoutType.Simple
  const resolvedAreaType = paneIsSimpleArea
    ? areaLibrary[pane.areaType]
    : undefined
  const notifications = resolvedAreaType?.useNotifications?.()
  const { value, onClick, title } = notifications || {
    value: undefined,
    onClick: () => {},
    title: undefined,
  }

  useEffect(() => {
    console.log('ARE WE RERENDERING?', pane.id, value)
  }, [value, pane.id])

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
  const { actionLibrary } = useLayoutState()
  const platform = usePlatform()
  const resolvedAction = actionLibrary[action.actionType]
  const disabledReason = resolvedAction.useDisabled?.()
  const hidden = resolvedAction.useHidden?.()
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
        data-testid={`${action.id}-pane-button`}
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
