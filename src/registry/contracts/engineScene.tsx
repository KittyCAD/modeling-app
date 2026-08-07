import {
  defineContract,
  defineService,
  defineValueSpec,
  Slot,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import type { CustomIconName } from '@src/components/CustomIcon'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import usePlatform from '@src/hooks/usePlatform'
import type { modelingMachine } from '@src/machines/modelingMachine'
import {
  keymapKeystrokesDisplay,
  type KeymapItem,
  type KeymapService,
} from '@src/registry/contracts/keymap'
import type {
  ComponentType,
  Dispatch,
  FocusEventHandler,
  MouseEventHandler,
  SetStateAction,
} from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { twMerge } from 'tailwind-merge'
import type { EventFrom, StateFrom } from 'xstate'

export const engineSceneViewExtensionZones = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
] as const

export type EngineSceneViewExtensionZone =
  (typeof engineSceneViewExtensionZones)[number]

export const engineSceneRuntimeExtensionsSlot = new Slot()

export type EngineSceneExtensionContext = {
  modelingState: StateFrom<typeof modelingMachine>
  modelingSend: (event: EventFrom<typeof modelingMachine>) => void
  sketchSolveStreamDimming: number
  setSketchSolveStreamDimming: Dispatch<SetStateAction<number>>
}

export type EngineSceneViewExtensionProps = EngineSceneExtensionContext
export type EngineSceneStreamLayerProps = EngineSceneExtensionContext
export type EngineSceneHudAreaProps = EngineSceneExtensionContext

export const ENGINE_SCENE_MODEL_TREE_HUD_KEYMAP_SCOPE =
  'engine-scene.model-tree-hud.focused'
export const ENGINE_SCENE_HUD_AREA_TOGGLE_COMMAND_ID =
  'zds.engineScene.toggleHudArea'
export const ENGINE_SCENE_MODEL_TREE_HUD_TOGGLE_KEYSTROKES = [
  'shift+t',
] as const

export type EngineSceneViewExtension = {
  id: string
  zone: EngineSceneViewExtensionZone
  order?: number
  Component: ComponentType<EngineSceneViewExtensionProps>
  wrapperClassName?: string
  shouldRegister?: (context: EngineSceneExtensionContext) => boolean
}

export type EngineSceneStreamClassName = {
  id: string
  order?: number
  className: string
}

export type EngineSceneStreamLayer = {
  id: string
  order?: number
  Component: ComponentType<EngineSceneStreamLayerProps>
  wrapperClassName?: string
}

/**
 * Keyboard affordance for toggling one model-tree HUD disclosure while the HUD
 * owns focus.
 */
export type EngineSceneHudAreaToggleKeymap = {
  id: string
  title: string
  keystrokes: readonly string[]
}

/**
 * A collapsible left-side HUD area rendered over the engine scene.
 *
 * Contributions should describe stable UI surfaces. The area component should
 * read live app/modeling data from React hooks or services at render time.
 */
export type EngineSceneHudArea = {
  id: string
  title: string
  toggleKeymap: EngineSceneHudAreaToggleKeymap
  icon?: CustomIconName
  order?: number
  Component: ComponentType<EngineSceneHudAreaProps>
  HeaderActions?: ComponentType<EngineSceneHudAreaProps>
  defaultCollapsed?: boolean
  wrapperClassName?: string
  shouldRegister?: (context: EngineSceneExtensionContext) => boolean
}

export type EngineSceneHudAreaToggleRequest = {
  areaId: string
  requestId: number
}

export type EngineSceneModelTreeHudService = {
  readonly expanded: ReadonlySignal<boolean>
  readonly focused: ReadonlySignal<boolean>
  readonly focusRequest: ReadonlySignal<number>
  readonly areaToggleRequest: ReadonlySignal<EngineSceneHudAreaToggleRequest | null>
  expand(): void
  collapse(): void
  toggle(): void
  focus(): void
  setFocused(focused: boolean): void
  toggleArea(areaId: string): void
}

const zoneOrder = Object.fromEntries(
  engineSceneViewExtensionZones.map((zone, index) => [zone, index])
) as Record<EngineSceneViewExtensionZone, number>

const sortByZoneAndOrder = (
  inputs: readonly EngineSceneViewExtension[]
): readonly EngineSceneViewExtension[] =>
  inputs.toSorted(
    (a, b) =>
      zoneOrder[a.zone] - zoneOrder[b.zone] || (a.order ?? 0) - (b.order ?? 0)
  )

const sortByOrder = <T extends { order?: number }>(
  inputs: readonly T[]
): readonly T[] => inputs.toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0))

const sortAndDedupeHudAreas = (
  inputs: readonly EngineSceneHudArea[]
): readonly EngineSceneHudArea[] => {
  const seen = new Set<string>()
  const deduped: EngineSceneHudArea[] = []

  for (const area of inputs) {
    if (seen.has(area.id)) {
      continue
    }
    seen.add(area.id)
    deduped.push(area)
  }

  return sortByOrder(deduped)
}

export const defineEngineSceneViewExtension = <
  T extends EngineSceneViewExtension,
>(
  extension: T
): T => extension

export const defineEngineSceneStreamClassName = <
  T extends EngineSceneStreamClassName,
>(
  className: T
): T => className

export const defineEngineSceneStreamLayer = <T extends EngineSceneStreamLayer>(
  layer: T
): T => layer

export const defineEngineSceneHudArea = <T extends EngineSceneHudArea>(
  area: T
): T => area

export function defineEngineSceneHudAreaToggleKeymapItem(
  area: Pick<EngineSceneHudArea, 'id' | 'toggleKeymap'>,
  source: string
): KeymapItem {
  return {
    id: area.toggleKeymap.id,
    title: area.toggleKeymap.title,
    source,
    scopes: [ENGINE_SCENE_MODEL_TREE_HUD_KEYMAP_SCOPE],
    keystrokes: area.toggleKeymap.keystrokes,
    command: ENGINE_SCENE_HUD_AREA_TOGGLE_COMMAND_ID,
    arguments: {
      areaId: area.id,
    },
  }
}

export const engineSceneContract = defineContract({
  engineSceneModelTreeHudService: defineService<EngineSceneModelTreeHudService>(
    'engine-scene.model-tree-hud'
  ),
  engineSceneViewExtensionsValueSpec: defineValueSpec<
    EngineSceneViewExtension,
    readonly EngineSceneViewExtension[]
  >({
    name: 'engine-scene.view-extensions',
    defaultValue: [],
    combine: sortByZoneAndOrder,
  }),
  engineSceneStreamClassNamesValueSpec: defineValueSpec<
    EngineSceneStreamClassName,
    readonly EngineSceneStreamClassName[]
  >({
    name: 'engine-scene.stream-class-names',
    defaultValue: [],
    combine: sortByOrder,
  }),
  engineSceneStreamLayersValueSpec: defineValueSpec<
    EngineSceneStreamLayer,
    readonly EngineSceneStreamLayer[]
  >({
    name: 'engine-scene.stream-layers',
    defaultValue: [],
    combine: sortByOrder,
  }),
  engineSceneHudAreasValueSpec: defineValueSpec<
    EngineSceneHudArea,
    readonly EngineSceneHudArea[]
  >({
    name: 'engine-scene.hud-areas',
    defaultValue: [],
    combine: sortAndDedupeHudAreas,
  }),
})

export const {
  engineSceneModelTreeHudService,
  engineSceneViewExtensionsValueSpec,
  engineSceneStreamClassNamesValueSpec,
  engineSceneStreamLayersValueSpec,
  engineSceneHudAreasValueSpec,
} = engineSceneContract

export function resolveEngineSceneViewExtensions(
  extensions: readonly EngineSceneViewExtension[],
  context: EngineSceneExtensionContext
) {
  return extensions.filter(
    (extension) => extension.shouldRegister?.(context) ?? true
  )
}

export function resolveEngineSceneHudAreas(
  areas: readonly EngineSceneHudArea[],
  context: EngineSceneExtensionContext
) {
  return sortAndDedupeHudAreas(
    areas.filter((area) => area.shouldRegister?.(context) ?? true)
  )
}

const zoneClassNames: Record<EngineSceneViewExtensionZone, string> = {
  'top-left': 'absolute top-2 left-2 flex items-start justify-start gap-2',
  top: 'absolute top-0 left-2 right-2 flex items-start justify-center gap-2',
  'top-right': 'absolute top-2 right-2 flex items-start justify-end gap-2',
  left: 'absolute left-2 top-1/2 -translate-y-1/2 flex flex-col items-start justify-center gap-2',
  center: 'absolute inset-2 flex flex-col items-center justify-center gap-2',
  right:
    'absolute right-2 top-1/2 -translate-y-1/2 flex flex-col items-end justify-center gap-2',
  'bottom-left': 'absolute bottom-2 left-2 flex items-end justify-start gap-2',
  bottom:
    'absolute bottom-2 left-2 right-2 flex items-end justify-center gap-2',
  'bottom-right': 'absolute bottom-2 right-2 flex items-end justify-end gap-3',
}

type EngineSceneHudProps = EngineSceneExtensionContext & {
  areas: readonly EngineSceneHudArea[]
  service?: EngineSceneModelTreeHudService
  keymap?: KeymapService
}

type AreaCollapsedState = Record<string, boolean>

const stopHudEvent: MouseEventHandler<HTMLElement> = (event) => {
  event.stopPropagation()
}

const hudKeybindingClassName =
  'ml-auto shrink-0 rounded-sm border border-chalkboard-30 bg-chalkboard-20 px-1 py-0.5 text-[10px] font-medium leading-none text-chalkboard-80 dark:border-chalkboard-70 dark:bg-chalkboard-80 dark:text-chalkboard-20'

function getAreaCollapsedState(
  areas: readonly EngineSceneHudArea[],
  previous: AreaCollapsedState
): AreaCollapsedState {
  const next: AreaCollapsedState = {}

  for (const area of areas) {
    next[area.id] = previous[area.id] ?? area.defaultCollapsed ?? false
  }

  return next
}

function areAreaCollapsedStatesEqual(
  a: AreaCollapsedState,
  b: AreaCollapsedState
) {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  return (
    aKeys.length === bKeys.length && aKeys.every((key) => a[key] === b[key])
  )
}

function isFocusVisibleTarget(target: EventTarget | null) {
  return (
    typeof HTMLElement !== 'undefined' &&
    target instanceof HTMLElement &&
    target.matches(':focus-visible')
  )
}

export function EngineSceneHud({
  areas,
  service,
  keymap,
  ...context
}: EngineSceneHudProps) {
  useSignals()
  const platform = usePlatform()
  const containerRef = useRef<HTMLDivElement>(null)
  const handledFocusRequest = useRef<number | null>(null)
  const handledAreaToggleRequestId = useRef<number | null>(null)
  const [isHudFocusVisible, setIsHudFocusVisible] = useState(false)
  const registeredAreas = useMemo(
    () => resolveEngineSceneHudAreas(areas, context),
    [
      areas,
      context.modelingState,
      context.modelingSend,
      context.sketchSolveStreamDimming,
      context.setSketchSolveStreamDimming,
    ]
  )
  const [areaCollapsedById, setAreaCollapsedById] =
    useState<AreaCollapsedState>(() =>
      getAreaCollapsedState(registeredAreas, {})
    )

  useEffect(() => {
    setAreaCollapsedById((previous) => {
      const next = getAreaCollapsedState(registeredAreas, previous)
      return areAreaCollapsedStatesEqual(previous, next) ? previous : next
    })
  }, [registeredAreas])

  const isExpanded = service?.expanded.value ?? true
  const isHudFocused = service?.focused.value ?? false
  const focusRequest = service?.focusRequest.value
  const areaToggleRequest = service?.areaToggleRequest.value
  const modelTreeToggleKeybinding = keymapKeystrokesDisplay(
    ENGINE_SCENE_MODEL_TREE_HUD_TOGGLE_KEYSTROKES,
    platform
  )
  const areaKeybindingsById = useMemo(
    () =>
      new Map(
        registeredAreas.map((area) => [
          area.id,
          keymapKeystrokesDisplay(area.toggleKeymap.keystrokes, platform),
        ])
      ),
    [registeredAreas, platform]
  )

  useEffect(() => {
    if (!service || (isExpanded && registeredAreas.length > 0)) {
      return
    }

    service.setFocused(false)
    setIsHudFocusVisible(false)
  }, [isExpanded, registeredAreas.length, service])

  useEffect(() => {
    const shouldApplyScope =
      isExpanded && isHudFocused && registeredAreas.length > 0

    if (!keymap) {
      return
    }

    if (!shouldApplyScope) {
      keymap.removeScope(ENGINE_SCENE_MODEL_TREE_HUD_KEYMAP_SCOPE)
      return
    }

    keymap.applyScope(ENGINE_SCENE_MODEL_TREE_HUD_KEYMAP_SCOPE)

    return () => {
      keymap.removeScope(ENGINE_SCENE_MODEL_TREE_HUD_KEYMAP_SCOPE)
    }
  }, [isExpanded, isHudFocused, keymap, registeredAreas.length])

  useEffect(() => {
    if (
      focusRequest === undefined ||
      focusRequest === 0 ||
      handledFocusRequest.current === focusRequest
    ) {
      return
    }

    handledFocusRequest.current = focusRequest
    containerRef.current?.focus()
  }, [focusRequest])

  useEffect(() => {
    if (
      !areaToggleRequest ||
      handledAreaToggleRequestId.current === areaToggleRequest.requestId
    ) {
      return
    }

    handledAreaToggleRequestId.current = areaToggleRequest.requestId
    const area = registeredAreas.find(
      (candidate) => candidate.id === areaToggleRequest.areaId
    )
    if (!area) {
      return
    }

    setAreaCollapsedById((previous) => ({
      ...previous,
      [area.id]: !(previous[area.id] ?? area.defaultCollapsed ?? false),
    }))
  }, [areaToggleRequest, registeredAreas])

  const handleHudFocus: FocusEventHandler<HTMLElement> = (event) => {
    service?.setFocused(true)
    setIsHudFocusVisible(isFocusVisibleTarget(event.target))
  }

  const handleHudBlur: FocusEventHandler<HTMLElement> = (event) => {
    const nextFocusedElement = event.relatedTarget
    const focusStayedInHud =
      typeof Node !== 'undefined' &&
      nextFocusedElement instanceof Node &&
      event.currentTarget.contains(nextFocusedElement)

    if (focusStayedInHud) {
      return
    }

    service?.setFocused(false)
    setIsHudFocusVisible(false)
  }

  const handleHudMouseDown: MouseEventHandler<HTMLElement> = (event) => {
    stopHudEvent(event)
    setIsHudFocusVisible(false)
  }

  if (registeredAreas.length === 0) {
    return null
  }

  if (!isExpanded) {
    return (
      <div
        className="absolute left-0 top-14 z-20 pointer-events-auto"
        data-onboarding-id="engine-scene-model-tree-hud"
        data-testid="engine-scene-model-tree-hud-collapsed"
        onClick={stopHudEvent}
        onContextMenu={stopHudEvent}
        onDoubleClick={stopHudEvent}
        onBlurCapture={handleHudBlur}
        onMouseDown={handleHudMouseDown}
      >
        <button
          type="button"
          aria-label="Expand model tree"
          data-testid="engine-scene-model-tree-hud-expand"
          className="flex min-h-44 !ml-0 flex-col items-center gap-2 !rounded-l-none border border-l-0 border-chalkboard-30 bg-chalkboard-10 px-1.5 py-2 text-chalkboard-90 shadow-sm hover:border-primary hover:bg-chalkboard-10 focus:outline-none focus:ring-2 focus:ring-primary dark:border-chalkboard-80 dark:bg-chalkboard-90 dark:text-chalkboard-20 dark:hover:bg-chalkboard-90"
          onClick={() => service?.expand()}
        >
          <span
            data-testid="engine-scene-model-tree-hud-collapsed-label"
            className="flex-1 text-xs font-medium tracking-normal"
            style={{ writingMode: 'vertical-rl' }}
          >
            Model tree
          </span>
          <CustomIcon name="arrowShortRight" className="h-4 w-4 shrink-0" />
          <Tooltip
            position="right"
            contentClassName="min-w-44"
            wrapperClassName="ui-open:hidden"
          >
            <div className="flex flex-col gap-2 text-left text-xs">
              <div className="flex items-center justify-between gap-4">
                <span className="text-chalkboard-70 dark:text-chalkboard-40">
                  Toggle open
                </span>
                {modelTreeToggleKeybinding && (
                  <kbd
                    className={hudKeybindingClassName}
                    data-testid="engine-scene-model-tree-hud-toggle-keybinding-tooltip"
                  >
                    {modelTreeToggleKeybinding}
                  </kbd>
                )}
              </div>
              <div>
                <div className="mb-1 font-medium">Contains</div>
                <div className="block w-full my-2 h-[1px] bg-4" />
                <ol className="m-0 text-default flex list-none flex-col gap-1 p-0">
                  {registeredAreas.map((area) => {
                    const areaKeybinding = areaKeybindingsById.get(area.id)

                    return (
                      <li
                        key={area.id}
                        data-engine-scene-hud-tooltip-area-id={area.id}
                        className="flex items-center justify-between gap-4"
                      >
                        <span>{area.title}</span>
                        {areaKeybinding && (
                          <kbd
                            className={hudKeybindingClassName}
                            data-testid={`engine-scene-model-tree-hud-tooltip-area-${area.id}-keybinding`}
                          >
                            {areaKeybinding}
                          </kbd>
                        )}
                      </li>
                    )
                  })}
                </ol>
              </div>
            </div>
          </Tooltip>
        </button>
      </div>
    )
  }

  return (
    <section
      ref={containerRef}
      tabIndex={-1}
      aria-label="Model tree"
      className="absolute left-0 top-14 z-20 flex max-h-[calc(100%-4.25rem)] w-[min(22rem,calc(100%-0.5rem))] max-w-[calc(100%-0.5rem)] flex-col overflow-hidden rounded-r border border-l-0 border-chalkboard-30 bg-chalkboard-10/90 text-chalkboard-100 shadow-lg backdrop-blur-sm outline-none focus:ring-2 focus:ring-primary dark:border-chalkboard-80 dark:bg-chalkboard-100/90 dark:text-chalkboard-10 sm:w-80"
      data-onboarding-id="engine-scene-model-tree-hud"
      data-testid="engine-scene-model-tree-hud"
      onClick={stopHudEvent}
      onContextMenu={stopHudEvent}
      onDoubleClick={stopHudEvent}
      onFocusCapture={handleHudFocus}
      onBlurCapture={handleHudBlur}
      onMouseDown={handleHudMouseDown}
    >
      <div className="flex min-h-8 items-center justify-between gap-2 border-b border-chalkboard-30 bg-chalkboard-10 px-2 py-1 dark:border-chalkboard-80 dark:bg-chalkboard-90">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-medium">Model tree</span>
          {isHudFocusVisible && modelTreeToggleKeybinding && (
            <kbd
              className={hudKeybindingClassName}
              data-testid="engine-scene-model-tree-hud-toggle-keybinding"
            >
              {modelTreeToggleKeybinding}
            </kbd>
          )}
        </div>
        <button
          type="button"
          aria-label="Collapse model tree"
          data-testid="engine-scene-model-tree-hud-collapse"
          className="m-0 flex h-6 w-6 items-center justify-center rounded-sm border-0 bg-transparent p-0 text-chalkboard-80 hover:bg-chalkboard-20 focus:bg-chalkboard-20 focus:outline-none dark:text-chalkboard-30 dark:hover:bg-chalkboard-90 dark:focus:bg-chalkboard-90"
          onClick={() => service?.collapse()}
        >
          <CustomIcon name="arrowShortLeft" className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {registeredAreas.map((area) => {
          const Component = area.Component
          const HeaderActions = area.HeaderActions
          const isAreaCollapsed = areaCollapsedById[area.id] ?? false
          const panelId = `engine-scene-hud-panel-${area.id}`
          const areaKeybinding = areaKeybindingsById.get(area.id)

          return (
            <section
              key={area.id}
              data-engine-scene-hud-area-id={area.id}
              data-testid={`engine-scene-hud-area-${area.id}`}
              className="border-b border-chalkboard-30 last:border-b-0 dark:border-chalkboard-80"
            >
              <div className="flex min-h-8 items-center gap-1 px-1 py-1">
                <button
                  type="button"
                  data-testid={`engine-scene-hud-area-${area.id}-toggle`}
                  className="reset flex min-w-0 flex-1 items-center gap-1.5 rounded-sm !border-transparent !px-1 !py-0.5 text-left hover:!bg-chalkboard-20 focus:!bg-chalkboard-20 focus:!outline-none dark:hover:!bg-chalkboard-90 dark:focus:!bg-chalkboard-90"
                  aria-expanded={!isAreaCollapsed}
                  aria-controls={panelId}
                  onClick={() => {
                    setAreaCollapsedById((previous) => ({
                      ...previous,
                      [area.id]: !(previous[area.id] ?? false),
                    }))
                  }}
                >
                  <CustomIcon
                    name="caretDown"
                    className={`h-4 w-4 shrink-0 ${isAreaCollapsed ? '-rotate-90' : 'rotate-0'}`}
                    aria-hidden
                  />
                  {area.icon && (
                    <CustomIcon
                      name={area.icon}
                      className="h-4 w-4 shrink-0"
                      aria-hidden
                    />
                  )}
                  <span className="truncate text-xs font-medium">
                    {area.title}
                  </span>
                  {isHudFocusVisible && areaKeybinding && (
                    <kbd
                      className={hudKeybindingClassName}
                      data-testid={`engine-scene-hud-area-${area.id}-keybinding`}
                    >
                      {areaKeybinding}
                    </kbd>
                  )}
                </button>
                {HeaderActions && (
                  <div className="shrink-0">
                    <HeaderActions {...context} />
                  </div>
                )}
              </div>
              <div
                id={panelId}
                hidden={isAreaCollapsed}
                className={area.wrapperClassName ?? ''}
              >
                {!isAreaCollapsed && <Component {...context} />}
              </div>
            </section>
          )
        })}
      </div>
    </section>
  )
}

type EngineSceneViewExtensionOverlayProps = EngineSceneExtensionContext & {
  extensions: readonly EngineSceneViewExtension[]
}

export function EngineSceneViewExtensionOverlay({
  extensions,
  ...context
}: EngineSceneViewExtensionOverlayProps) {
  const registeredExtensions = resolveEngineSceneViewExtensions(
    extensions,
    context
  )

  return (
    <div
      className="absolute inset-0 z-10 pointer-events-none"
      aria-hidden={registeredExtensions.length === 0}
    >
      {engineSceneViewExtensionZones.map((zone) => {
        const zoneExtensions = registeredExtensions.filter(
          (extension) => extension.zone === zone
        )

        if (zoneExtensions.length === 0) {
          return null
        }

        return (
          <div
            key={zone}
            className={zoneClassNames[zone]}
            data-engine-scene-view-extension-zone={zone}
          >
            {zoneExtensions.map((extension) => {
              const Component = extension.Component
              const wrapperClassName = `max-w-full pointer-events-auto ${extension.wrapperClassName ?? ''}`

              return (
                <div
                  key={extension.id}
                  className={wrapperClassName}
                  data-engine-scene-view-extension-id={extension.id}
                >
                  <Component {...context} />
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

export function mergeEngineSceneClassNames(
  contributions: readonly EngineSceneStreamClassName[]
): string {
  return twMerge(...contributions.map((contribution) => contribution.className))
}
