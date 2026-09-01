import { Switch } from '@headlessui/react'
import {
  ContextMenu,
  ContextMenuDivider,
  ContextMenuItem,
  type ContextMenuProps,
} from '@src/components/ContextMenu'
import { CustomIcon } from '@src/components/CustomIcon'
import { PaneContentSelectorProvider } from '@src/components/layout/Panel/PaneContentSelector'
import { SplitResizeHandle } from '@src/components/layout/Panel/SplitResizeHandle'
import Tooltip from '@src/components/Tooltip'
import usePlatform from '@src/hooks/usePlatform'
import type { ArtifactGraph } from '@src/lang/wasm'
import { hotkeyDisplay } from '@src/lib/hotkeys'
import type {
  Action,
  ActionLibrary,
  ActionTypeDefinition,
  AreaLibrary,
  AreaTypeDefinition,
  Closeable,
  Direction,
  Layout,
  PaneChild,
  PaneLayout as PaneLayoutType,
  Side,
  SplitLayout as SplitLayoutType,
} from '@src/lib/layout/types'
import { LayoutType } from '@src/lib/layout/types'
import type {
  IReplaceLayoutChildNode,
  ITogglePane,
  IUpdateNodeSizes,
} from '@src/lib/layout/utils'
import {
  defaultLayout,
  findAndReplaceLayoutChildNode,
  findAndUpdateSplitSizes,
  getOppositeSide,
  getOppositionDirection,
  isCollapsedPaneLayout,
  logicalSideToTooltipPosition,
  orientationToDirection,
  orientationToReactCss,
  shouldDisableFlex,
  shouldEnableResizeHandle,
  sideToOrientation,
  sideToReactCss,
  sideToSplitDirection,
  sideToTailwindLayoutDirection,
  sideToTailwindTabDirection,
  togglePaneLayoutNode,
} from '@src/lib/layout/utils'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import { isArray } from '@src/lib/utils'
import {
  createContext,
  Fragment,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import isEqual from 'react-fast-compare'
import { useHotkeys } from 'react-hotkeys-hook'
import type {
  ImperativePanelGroupHandle,
  ImperativePanelHandle,
} from 'react-resizable-panels'
import { Panel, PanelGroup } from 'react-resizable-panels'

type WithoutRootLayout<T> = Omit<T, 'rootLayout'>
interface LayoutState {
  areaLibrary: AreaLibrary
  actionLibrary: ActionLibrary
  updateSplitSizes: (props: WithoutRootLayout<IUpdateNodeSizes>) => void
  replaceLayoutNode: (props: WithoutRootLayout<IReplaceLayoutChildNode>) => void
  togglePane: (props: WithoutRootLayout<ITogglePane>) => void
  /** Kind of a feature flag, remove in future */
  enableContextMenus: boolean
  collapsedPanelIds: readonly string[]
  collapsiblePanelIds: readonly string[]
  hideResizeHandleGrabbers: boolean
  hideResizeHandleLines: boolean
  onPanelCollapsedChange: (panelId: string, collapsed: boolean) => void
  areaSelectorOptions: readonly LayoutAreaSelectorOption[]
}

export type LayoutAreaSelectorOption = {
  id: string
  label: string
  areaType: string
}

const missingAreaDefinition = {
  hide: () => false,
  Component: () => <></>,
} satisfies AreaTypeDefinition

const missingActionDefinition = {
  execute: () => {},
  useHidden: () => true,
} satisfies ActionTypeDefinition

const nullAreaLibrary: AreaLibrary = {}
const nullActionLibrary: ActionLibrary = {}

const LayoutStateContext = createContext<LayoutState>({
  areaLibrary: nullAreaLibrary,
  actionLibrary: nullActionLibrary,
  updateSplitSizes: () => {},
  replaceLayoutNode: () => {},
  togglePane: () => {},
  /** Kind of a feature flag, remove in future */
  enableContextMenus: false,
  collapsedPanelIds: [],
  collapsiblePanelIds: [],
  hideResizeHandleGrabbers: false,
  hideResizeHandleLines: false,
  onPanelCollapsedChange: () => {},
  areaSelectorOptions: [],
})

export const useLayoutState = () => useContext(LayoutStateContext)

interface LayoutRootNodeProps {
  areaLibrary?: LayoutState['areaLibrary']
  actionLibrary?: LayoutState['actionLibrary']
  layout: Layout
  getLayout: () => Layout | undefined
  setLayout: (layout: Layout) => void
  // Values that affect the layout (pane buttons, menus, etc).
  showDebugPanel: SettingsType['debug']['showPanel']['current']
  notifications: boolean[]
  artifactGraph: ArtifactGraph
  layoutName?: string
  /** Kind of a feature flag, remove in future */
  enableContextMenus?: boolean
  collapsedPanelIds?: readonly string[]
  collapsiblePanelIds?: readonly string[]
  hideResizeHandleGrabbers?: boolean
  hideResizeHandleLines?: boolean
  onPanelCollapsedChange?: (panelId: string, collapsed: boolean) => void
  areaSelectorOptions?: readonly LayoutAreaSelectorOption[]
}

export const LayoutRootNode = memo(
  function LayoutRootNode({
    areaLibrary,
    actionLibrary,
    layout,
    getLayout,
    setLayout,
    enableContextMenus = false,
    collapsedPanelIds = [],
    collapsiblePanelIds = [],
    hideResizeHandleGrabbers = false,
    hideResizeHandleLines = false,
    onPanelCollapsedChange = () => {},
    areaSelectorOptions = [],
  }: LayoutRootNodeProps) {
    const getLayoutWithFallback = useCallback(
      () => getLayout() || defaultLayout,
      [getLayout]
    )

    const updateSplitSizes = useCallback(
      (props: WithoutRootLayout<IUpdateNodeSizes>) => {
        const rootLayout = getLayoutWithFallback()
        setLayout(
          findAndUpdateSplitSizes({
            rootLayout: structuredClone(rootLayout),
            ...props,
          })
        )
      },
      [getLayoutWithFallback, setLayout]
    )

    const replaceLayoutNode = useCallback(
      (props: WithoutRootLayout<IReplaceLayoutChildNode>) => {
        const rootLayout = getLayoutWithFallback()
        setLayout(
          findAndReplaceLayoutChildNode({
            rootLayout: structuredClone(rootLayout),
            ...props,
          })
        )
      },
      [getLayoutWithFallback, setLayout]
    )

    const togglePane = useCallback(
      (props: WithoutRootLayout<ITogglePane>) => {
        const rootLayout = getLayoutWithFallback()
        setLayout(
          togglePaneLayoutNode({
            rootLayout: structuredClone(rootLayout),
            ...props,
          })
        )
      },
      [getLayoutWithFallback, setLayout]
    )

    const providerValue = useMemo(
      () => ({
        areaLibrary: areaLibrary || nullAreaLibrary,
        actionLibrary: actionLibrary || nullActionLibrary,
        updateSplitSizes,
        replaceLayoutNode,
        togglePane,
        enableContextMenus,
        collapsedPanelIds,
        collapsiblePanelIds,
        hideResizeHandleGrabbers,
        hideResizeHandleLines,
        onPanelCollapsedChange,
        areaSelectorOptions,
        // More API here if needed within nested layout components
        // The other properties are all callbacks which are set once.
      }),
      [
        enableContextMenus,
        collapsedPanelIds,
        collapsiblePanelIds,
        hideResizeHandleGrabbers,
        hideResizeHandleLines,
        onPanelCollapsedChange,
        areaSelectorOptions,
        areaLibrary,
        actionLibrary,
        replaceLayoutNode,
        togglePane,
        updateSplitSizes,
      ]
    )

    return (
      <LayoutStateContext.Provider value={providerValue}>
        <LayoutNode layout={layout} />
      </LayoutStateContext.Provider>
    )
  },
  (oldProps, newProps) =>
    isEqual(oldProps.layout, newProps.layout) &&
    oldProps.areaLibrary === newProps.areaLibrary &&
    oldProps.actionLibrary === newProps.actionLibrary &&
    oldProps.enableContextMenus === newProps.enableContextMenus &&
    isEqual(oldProps.collapsedPanelIds, newProps.collapsedPanelIds) &&
    isEqual(oldProps.collapsiblePanelIds, newProps.collapsiblePanelIds) &&
    oldProps.hideResizeHandleGrabbers === newProps.hideResizeHandleGrabbers &&
    oldProps.hideResizeHandleLines === newProps.hideResizeHandleLines &&
    oldProps.onPanelCollapsedChange === newProps.onPanelCollapsedChange &&
    isEqual(oldProps.areaSelectorOptions, newProps.areaSelectorOptions) &&
    oldProps.showDebugPanel === newProps.showDebugPanel &&
    isEqual(oldProps.notifications, newProps.notifications) &&
    isEqual(oldProps.artifactGraph, newProps.artifactGraph)
)

/*
 * A layout is a nested set of Areas (Splits or Panes),
 * ending in leaf nodes that contain UI components.
 */
function LayoutNode({
  layout,
  onClose,
}: { layout: Layout } & Partial<Closeable>) {
  const { areaLibrary, areaSelectorOptions, replaceLayoutNode } =
    useLayoutState()
  switch (layout.type) {
    case LayoutType.Splits:
      return (
        <SplitLayout
          layout={layout}
          key={`node-${layout.id}`}
          onClose={onClose}
        />
      )
    case LayoutType.Panes:
      return <PaneLayout layout={layout} key={`node-${layout.id}`} />
    default: {
      const { Component, ...props } =
        areaLibrary[layout.areaType] ?? missingAreaDefinition
      const currentOption =
        areaSelectorOptions.find(
          (option) =>
            option.areaType === layout.areaType && option.label === layout.label
        ) ??
        areaSelectorOptions.find(
          (option) => option.areaType === layout.areaType
        )
      const component = (
        <Component areaConfig={props} layout={layout} onClose={onClose} />
      )

      if (!currentOption) {
        return component
      }

      return (
        <PaneContentSelectorProvider
          currentId={currentOption.id}
          onSelect={(nextId) => {
            const nextOption = areaSelectorOptions.find(
              (option) => option.id === nextId
            )
            if (!nextOption) {
              return
            }
            replaceLayoutNode({
              targetNodeId: layout.id,
              newNode: {
                ...layout,
                areaType: nextOption.areaType,
                label: nextOption.label,
              },
            })
          }}
          options={areaSelectorOptions}
        >
          {component}
        </PaneContentSelectorProvider>
      )
    }
  }
}

/**
 * Need to see if we should just roll our own resizable component?
 */
function SplitLayout({
  layout,
  onClose,
}: {
  layout: SplitLayoutType
  onClose?: (id: string) => void
}) {
  return (
    <SplitLayoutContents
      direction={orientationToDirection(layout.orientation)}
      layout={layout}
      onClose={onClose}
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
  const ref = useRef<ImperativePanelGroupHandle>(null)
  const panelRefs = useRef(new Map<string, ImperativePanelHandle>())
  const desiredCollapsedPanels = useRef(new Map<string, boolean>())
  const isDraggingRef = useRef(false)
  const [newSizes, setNewSizes] = useState<number[]>([])
  const {
    collapsedPanelIds,
    collapsiblePanelIds,
    onPanelCollapsedChange,
    updateSplitSizes,
  } = useLayoutState()
  const hasValidChildren = 'children' in layout && isArray(layout.children)
  const hasValidSizes =
    'sizes' in layout &&
    isArray(layout.sizes) &&
    layout.sizes.every(Number.isFinite)
  const sizes = hasValidSizes ? layout.sizes : undefined

  // We don't want to fully rerender the layout and all its children on resize of split panes,
  // so we only rerender when IDs shift (look at the `key` on the Fragment below)
  // and instead we watch for changes here and imperatively resize this Split layout
  // via react-resizable-panels' imperative ref API.
  useEffect(() => {
    const currentLayout = ref.current?.getLayout()
    if (!currentLayout || !hasValidSizes || !sizes) {
      return
    }

    if (sizes.length === currentLayout.length) {
      ref.current?.setLayout(sizes)
    } else {
      console.error(
        `Attempted to set Split layout sizes imperatively to a mismatched array of sizes. ID: ${layout.id}, real sizes: ${currentLayout}, attempted: ${sizes}`
      )
    }
  }, [sizes, hasValidSizes, layout.id])

  useEffect(() => {
    const animationFrames: number[] = []

    for (const panelId of collapsiblePanelIds) {
      const panel = panelRefs.current.get(panelId)
      if (!panel) {
        continue
      }

      const shouldCollapse = collapsedPanelIds.includes(panelId)
      const previousShouldCollapse = desiredCollapsedPanels.current.get(panelId)
      desiredCollapsedPanels.current.set(panelId, shouldCollapse)
      if (
        previousShouldCollapse === shouldCollapse ||
        (previousShouldCollapse === undefined && !shouldCollapse) ||
        isDraggingRef.current
      ) {
        continue
      }

      const panelIndex =
        hasValidChildren && 'children' in layout
          ? layout.children.findIndex((child) => child.id === panelId)
          : -1
      const configuredSize =
        panelIndex >= 0 && sizes ? sizes[panelIndex] : undefined
      const targetSize = shouldCollapse
        ? 0
        : configuredSize && configuredSize > 2
          ? configuredSize
          : 20
      const startingSize = panel.getSize()
      const startedAt = performance.now()
      const duration = 240

      const animate = (now: number) => {
        if (isDraggingRef.current) {
          return
        }

        const progress = Math.min((now - startedAt) / duration, 1)
        const easedProgress =
          progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - (-2 * progress + 2) ** 3 / 2
        const nextSize =
          startingSize + (targetSize - startingSize) * easedProgress

        if (progress < 1) {
          panel.resize(nextSize)
          animationFrames.push(window.requestAnimationFrame(animate))
        } else if (shouldCollapse) {
          panel.collapse()
        } else {
          panel.resize(targetSize)
        }
      }

      animationFrames.push(window.requestAnimationFrame(animate))
    }

    return () => {
      for (const animationFrame of animationFrames) {
        window.cancelAnimationFrame(animationFrame)
      }
    }
  }, [collapsedPanelIds, collapsiblePanelIds, hasValidChildren, layout, sizes])

  if (!hasValidChildren || !hasValidSizes) {
    return <></>
  }

  function onHandleDrag(isDragging: boolean) {
    isDraggingRef.current = isDragging
    if (!isDragging) {
      updateSplitSizes({ targetNodeId: layout.id, newSizes })
    }
  }

  return (
    layout.children.length && (
      <PanelGroup
        id={layout.id}
        direction={direction}
        className="bg-3"
        onLayout={setNewSizes}
        ref={ref}
      >
        {layout.children.map((a, i, arr) => {
          const disableResize = !shouldEnableResizeHandle(a, i, arr)
          const disableFlex = shouldDisableFlex(a, layout)
          const isCollapsed = isCollapsedPaneLayout(a)
          const isCollapsible = collapsiblePanelIds.includes(a.id)
          const size = isCollapsed ? undefined : layout.sizes[i]
          return (
            <Fragment key={a.id}>
              <Panel
                id={a.id}
                key={a.id}
                order={i}
                defaultSize={size}
                className={`flex bg-default ${disableFlex ? '!flex-none !overflow-visible' : ''}`}
                collapsedSize={isCollapsible ? 0 : undefined}
                collapsible={isCollapsible}
                minSize={2}
                onCollapse={
                  isCollapsible
                    ? () => onPanelCollapsedChange(a.id, true)
                    : undefined
                }
                onExpand={
                  isCollapsible
                    ? () => onPanelCollapsedChange(a.id, false)
                    : undefined
                }
                ref={(panel) => {
                  if (panel) {
                    panelRefs.current.set(a.id, panel)
                  } else {
                    panelRefs.current.delete(a.id)
                  }
                }}
              >
                <LayoutNode
                  layout={a}
                  onClose={
                    onClose
                      ? (idOverride?: unknown) => {
                          onClose(
                            typeof idOverride === 'string' ? idOverride : a.id
                          )
                        }
                      : undefined
                  }
                />
              </Panel>
              <ResizeHandle
                direction={direction}
                id={`handle-${a.id}`}
                disabled={disableResize}
                onDragging={onHandleDrag}
              />
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
  const shouldHide = (l: PaneChild) => {
    if (l.type !== LayoutType.Simple) {
      return false
    }
    const areaType = areaLibrary[l.areaType]
    return areaType === undefined || areaType.hide()
  }
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
  onDragging,
}: {
  direction: Direction
  id: string
  disabled: boolean
  onDragging: (isDragging: boolean) => void
}) {
  const { hideResizeHandleGrabbers, hideResizeHandleLines } = useLayoutState()

  return (
    <SplitResizeHandle
      direction={direction}
      disabled={disabled}
      id={id}
      onDragging={onDragging}
      showGrabber={!hideResizeHandleGrabbers}
      transparent={hideResizeHandleLines}
    />
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
        checked={parentActiveIndices.includes(childIndex)}
        aria-pressed={parentActiveIndices.includes(childIndex)}
        aria-details={`tooltip-${pane.id}`}
        onChange={(checked) => onChange(checked)}
        className={`ui-checked:border-primary dark:ui-checked:border-primary hover:b-3 border-transparent dark:border-transparent p-2 m-0 rounded-none border-0 hover:bg-2 ${resolvedAreaType?.cssClassOverrides?.button || ''}`}
        style={{ [buttonBorderWidthProp]: '2px' }}
        data-testid={`${pane.id}-pane-button`}
      >
        <CustomIcon name={pane.icon} className="w-5 h-5" aria-hidden />
        <span className="sr-only">{pane.label}</span>
      </Switch>
      <Tooltip
        id={`tooltip-${pane.id}`}
        position={logicalSideToTooltipPosition(getOppositeSide(side))}
        contentClassName="text-xs max-w-none flex items-center gap-4"
        hoverOnly
      >
        <span className="flex-1">{pane.label}</span>
        {resolvedAreaType?.shortcut ? (
          <kbd className="hotkey text-xs capitalize">
            {hotkeyDisplay(resolvedAreaType.shortcut, platform)}
          </kbd>
        ) : null}
      </Tooltip>
      <NotificationBadge pane={pane} />
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
  const resolvedAction =
    actionLibrary[action.actionType] ?? missingActionDefinition
  const resolvedActionState =
    resolvedAction === missingActionDefinition ? 'missing' : 'active'

  return (
    <ResolvedActionButton
      key={`${action.actionType}-${resolvedActionState}`}
      action={action}
      side={side}
      resolvedAction={resolvedAction}
    />
  )
}

function ResolvedActionButton({
  action,
  side,
  resolvedAction,
}: {
  action: Action
  side: Side
  resolvedAction: ActionTypeDefinition
}) {
  const platform = usePlatform()
  const disabledReason = resolvedAction.useDisabled?.()
  const hidden = resolvedAction.useHidden?.()
  useHotkeys(resolvedAction.shortcut || '', () => resolvedAction.execute(), {
    scopes: ['modeling'],
    enabled: !!resolvedAction.shortcut?.length,
  })

  return (
    !hidden && (
      <div
        id={`${action.id}-button-holder`}
        className="relative"
        data-onboarding-id={`${action.id}-pane-button`}
        key={`${action.id}-button-holder`}
      >
        <button
          key={action.id}
          type="button"
          aria-details={`tooltip-${action.id}`}
          className="hover:b-3 border-transparent p-2 m-0 rounded-none border-0 hover:bg-2 focus-visible:outline"
          disabled={disabledReason !== undefined}
          onClick={() => resolvedAction.execute()}
          data-testid={`${action.id}-pane-button`}
        >
          <CustomIcon name={action.icon} className="w-5 h-5" aria-hidden />
          <span className="sr-only">{action.label}</span>
        </button>
        <Tooltip
          id={`tooltip-${action.id}`}
          position={logicalSideToTooltipPosition(getOppositeSide(side))}
          contentClassName={`text-xs max-w-none flex flex-col gap-2 ${
            side === 'inline-start'
              ? 'text-left'
              : side === 'inline-end'
                ? 'text-right'
                : ''
          }`}
          hoverOnly
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
      </div>
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
