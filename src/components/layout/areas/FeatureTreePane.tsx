import type { Diagnostic } from '@codemirror/lint'
import type { ComponentProps, DragEvent, ReactNode } from 'react'
import { use, useCallback, useMemo, memo, useState } from 'react'
import type { OpKclValue, Operation } from '@rust/kcl-lib/bindings/Operation'
import { type ContextMenu, ContextMenuItem } from '@src/components/ContextMenu'
import type { CustomIconName } from '@src/components/CustomIcon'
import { CustomIcon } from '@src/components/CustomIcon'
import Loading from '@src/components/Loading'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { findOperationPlaneArtifact, isOffsetPlane } from '@src/lang/queryAst'
import { sourceRangeFromRust } from '@src/lang/sourceRange'
import { getArtifactFromRange } from '@src/lang/std/artifactGraph'
import { topLevelRange } from '@src/lang/util'
import {
  filterOperations,
  getOperationCalculatedDisplay,
  getOperationIcon,
  getOperationLabel,
  getOperationVariableName,
  getOpTypeLabel,
  getSketchBlockOperationKey,
  groupSketchBlockOperations,
  onHide,
  groupOperationTypeStreaks,
  isSketchBlockOperationGroup,
  stdLibMap,
  onUnhide,
} from '@src/lib/operations'
import { isArray, isOverlap, stripQuotes, uuidv4 } from '@src/lib/utils'
import type { DefaultPlaneStr } from '@src/lib/planes'
import { selectSketchPlane } from '@src/hooks/useEngineConnectionSubscriptions'
import { useApp, useSingletons } from '@src/lib/boot'
import { err, isErr, reportRejection } from '@src/lib/trap'
import toast from 'react-hot-toast'
import { base64Decode, type SourceRange } from '@src/lang/wasm'
import { browserSaveFile } from '@src/lib/browserSaveFile'
import { exportSketchToDxf } from '@src/lib/exportDxf'
import {
  type AreaTypeComponentProps,
  DefaultLayoutPaneID,
  getOpenPanes,
  togglePaneLayoutNode,
  type Layout,
} from '@src/lib/layout'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { FeatureTreeMenu } from '@src/components/layout/areas/FeatureTreeMenu'
import Tooltip from '@src/components/Tooltip'
import { Disclosure } from '@headlessui/react'
import { toUtf16, sourceRangeToUtf16 } from '@src/lang/errors'
import {
  prepareEditCommand,
  resolveFeatureTreeVisibility,
  sendDeleteCommand,
  sendSelectionEvent,
} from '@src/lib/featureTree'
import {
  getUnrenderedChangesDisabledReason,
  shouldDisableModelingForUnrenderedChanges,
} from '@src/lib/automaticRendering'
import { VisibilityToggle } from '@src/components/VisibilityToggle'
import { RowItemWithIconMenuAndToggle } from '@src/components/RowItemWithIconMenuAndToggle'
import type { CommandBarActorType } from '@src/machines/commandBarMachine'
import { useSignals } from '@preact/signals-react/runtime'
import type { SceneEntities } from '@src/clientSideScene/sceneEntities'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type RustContext from '@src/lib/rustContext'
import type { ConnectionManager } from '@src/network/connectionManager'
import { executingEditorService } from '@src/registry/contracts/executingEditor'
import usePlatform from '@src/hooks/usePlatform'
import { hotkeyDisplay } from '@src/lib/hotkeys'
import { findTopLevelRollbackExit } from '@src/lang/modifyAst/rollback'

type Singletons = ReturnType<typeof useSingletons>
type SystemDeps = Pick<Singletons, 'kclManager'> & {
  commandBarActor: CommandBarActorType
  sceneInfra: SceneInfra
  sceneEntitiesManager: SceneEntities
  rustContext: RustContext
}

const UNRENDERED_EXECUTE_HOTKEY = 'mod+s'

export function FeatureTreePane(props: AreaTypeComponentProps) {
  return (
    <LayoutPanel
      title={props.layout.label}
      id={`${props.layout.id}-pane`}
      className="border-none"
    >
      <LayoutPanelHeader
        id={props.layout.id}
        icon="model"
        title={props.layout.label}
        Menu={FeatureTreeMenu}
        onClose={() => {
          // Gotcha: because our layout system is a goofy first draft,
          // it doesn't know how to handle Splits as children of Panes very well,
          // so the onClose here needs to explicitly state the Split to close,
          // since this layout will be used in a Simple layout now.
          props.onClose?.('feature-tree')
        }}
      />
      <FeatureTreePaneContents />
    </LayoutPanel>
  )
}

function isCodePaneOpen(layout: Layout) {
  return getOpenPanes({ rootLayout: layout }).includes(DefaultLayoutPaneID.Code)
}
function openCodePane(layout: Layout, setLayout: (l: Layout) => void) {
  const rootLayout = structuredClone(layout)
  setLayout(
    togglePaneLayoutNode({
      rootLayout,
      targetNodeId: DefaultLayoutPaneID.Code,
      shouldExpand: true,
    })
  )
}

export const FeatureTreePaneContents = memo(() => {
  useSignals()
  const app = useApp()
  const { layout, commands, settings } = app
  const settingsValues = settings.useSettings()
  const platform = usePlatform()
  const unrenderedExecuteHotkeyLabel = hotkeyDisplay(
    UNRENDERED_EXECUTE_HOTKEY,
    platform
  )
  const { kclManager } = useSingletons()
  const executionService = app.registry.signal(executingEditorService).value
  const { engineCommandManager, rustContext } = kclManager
  const {
    send: modelingSend,
    state: modelingState,
    actor: modelingActor,
  } = useModelingContext()
  const systemDeps: SystemDeps = useMemo(
    () => ({
      kclManager,
      sceneInfra: kclManager.sceneInfra,
      sceneEntitiesManager: kclManager.sceneEntitiesManager,
      rustContext,
      commandBarActor: commands.actor,
    }),
    [kclManager, rustContext, commands.actor]
  )

  const selectOperation = useCallback(
    (sourceRange: SourceRange) => {
      sendSelectionEvent({
        sourceRange: sourceRangeToUtf16(sourceRange, kclManager.code),
        kclManager,
        modelingSend,
      })
    },
    [modelingSend, kclManager]
  )

  const sketchNoFace = modelingState.matches('Sketch no face')
  const hasParseErrors = kclManager.hasParseErrors()
  const disableModelingForUnrenderedChanges =
    shouldDisableModelingForUnrenderedChanges({
      settings: settingsValues,
      hasEditsSinceLastExecution:
        kclManager.hasEditsSinceLastExecutionSignal.value,
    })
  const diagnostics = kclManager.diagnosticsSignal.value
  const parseDiagnostics = hasParseErrors
    ? diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
    : []
  const firstParseDiagnostic = parseDiagnostics[0]
  const firstParseAction = firstParseDiagnostic?.actions?.[0]

  // If there are engine errors we show the successful operations
  // Errors return an operation list, so use the longest one if there are multiple
  const longestErrorOperationList = kclManager.errors.reduce((acc, error) => {
    return error.operations && error.operations.length > acc.length
      ? error.operations
      : acc
  }, [] as Operation[])

  const unfilteredOperationList = !hasParseErrors
    ? !kclManager.errors.length
      ? kclManager.operations
      : longestErrorOperationList
    : kclManager.lastSuccessfulOperations
  // We use the code that corresponds to the operations. In case this is an
  // error on the first run, fall back to whatever is currently in the code
  // editor.
  const operationsCode = hasParseErrors
    ? kclManager.lastSuccessfulCode || kclManager.codeSignal.value
    : disableModelingForUnrenderedChanges
      ? kclManager.lastSuccessfulCode || kclManager.codeSignal.value
      : kclManager.codeSignal.value
  const isReadOnlyFeatureTree =
    hasParseErrors || disableModelingForUnrenderedChanges

  // We filter out operations that are not useful to show in the feature tree
  const operationList = groupSketchBlockOperations(
    groupOperationTypeStreaks(filterOperations(unfilteredOperationList), [
      'VariableDeclaration',
    ])
  )
  const isOpenCascade =
    'isOpenCascade' in engineCommandManager &&
    engineCommandManager.isOpenCascade === true
  const rollbackExit = isOpenCascade
    ? findTopLevelRollbackExit(operationsCode)
    : undefined
  const rollbackOffset = rollbackExit?.range[0]
  const [isDraggingRollback, setIsDraggingRollback] = useState(false)
  const [rollbackPreviewRange, setRollbackPreviewRange] = useState<
    SourceRange | undefined
  >(undefined)
  const operationEntries = useMemo(
    () =>
      operationList.map((opOrList, index) => {
        const key = operationTreeItemKey(opOrList)
        return {
          opOrList,
          key,
          itemRange: operationTreeItemRange(opOrList),
          previousRange:
            index > 0
              ? operationTreeItemRange(operationList[index - 1])
              : undefined,
        }
      }),
    [operationList]
  )
  const actualRollbackRange = useMemo(
    () => rollbackRangeForOffset(operationEntries, rollbackOffset),
    [operationEntries, rollbackOffset]
  )
  const displayedRollbackRange = isDraggingRollback
    ? rollbackPreviewRange
    : actualRollbackRange
  const isShowingStaleFeatureTree = hasParseErrors && operationList.length > 0

  const startRollbackDrag = useCallback(
    (event: DragEvent<HTMLElement>, range: SourceRange | undefined) => {
      event.dataTransfer.setData('application/zoo-rollback-bar', 'true')
      event.dataTransfer.effectAllowed = 'move'
      const dragImage = document.createElement('canvas')
      dragImage.width = 1
      dragImage.height = 1
      event.dataTransfer.setDragImage(dragImage, 0, 0)
      setIsDraggingRollback(true)
      setRollbackPreviewRange(range)
    },
    []
  )

  const endRollbackDrag = useCallback(() => {
    setIsDraggingRollback(false)
    setRollbackPreviewRange(undefined)
  }, [])

  const moveRollbackPreviewToClosestSlot = useCallback(
    (
      event: DragEvent<HTMLElement>,
      itemRange: SourceRange | undefined,
      previousRange: SourceRange | undefined
    ) => {
      if (!isDraggingRollback) {
        return
      }
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      const isUpperHalf = event.clientY < rect.top + rect.height / 2
      setRollbackPreviewRange(isUpperHalf ? previousRange : itemRange)
    },
    [isDraggingRollback]
  )

  const dropRollback = useCallback(
    (event: DragEvent<HTMLElement>, range: SourceRange | undefined) => {
      if (!isDraggingRollback) {
        return
      }
      event.preventDefault()
      kclManager
        .moveOpenCascadeRollbackMarker(range)
        .catch(reportRejection)
        .finally(endRollbackDrag)
    },
    [endRollbackDrag, isDraggingRollback, kclManager]
  )

  function goToError() {
    const l = layout.signal.value
    if (!isCodePaneOpen(l)) {
      openCodePane(l, layout.set)
    }
    kclManager.scrollToFirstErrorDiagnosticIfExists()
  }

  function applyParseQuickFix() {
    if (!firstParseDiagnostic || !firstParseAction) return
    firstParseAction.apply(
      kclManager.editorView,
      firstParseDiagnostic.from,
      firstParseDiagnostic.to
    )
  }

  return (
    <div className="relative">
      <section
        data-testid="debug-panel"
        className="absolute inset-0 p-1 box-border overflow-auto mr-1"
      >
        {kclManager.isExecuting ? (
          <Loading className="h-full" isDummy={true}>
            Building feature tree...
          </Loading>
        ) : (
          <>
            {!modelingState.matches('Sketch') && (
              <DefaultPlanes
                systemDeps={systemDeps}
                disabled={disableModelingForUnrenderedChanges}
              />
            )}
            {disableModelingForUnrenderedChanges && !hasParseErrors && (
              <div className="text-sm bg-2 text-2 py-2 px-2 rounded flex flex-col gap-2 flex-none mb-2 border border-chalkboard-20 dark:border-chalkboard-80">
                <p className="font-medium">
                  Feature tree actions are disabled.
                </p>
                <p className="text-xs opacity-80">
                  {getUnrenderedChangesDisabledReason()}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      executionService?.executeCode().catch(reportRejection)
                    }}
                    disabled={kclManager.isExecuting || !executionService}
                    className="flex gap-1 items-center py-0 pl-0.5 pr-1 m-0 flex-none text-primary dark:text-primary border border-solid border-primary bg-primary/10 dark:bg-primary/20 hover:bg-primary/20 dark:hover:bg-primary/30 hover:border-primary active:border-primary disabled:cursor-wait disabled:opacity-70"
                  >
                    <CustomIcon name="play" className="w-5 h-5" />
                    <span>Execute</span>
                    {unrenderedExecuteHotkeyLabel && (
                      <kbd className="hotkey text-xs">
                        {unrenderedExecuteHotkeyLabel}
                      </kbd>
                    )}
                  </button>
                </div>
              </div>
            )}
            {hasParseErrors && (
              <div className="text-sm bg-destroy-80 text-chalkboard-10 py-2 px-2 rounded flex flex-col gap-2 flex-none mb-2">
                <p className="font-medium">
                  KCL parse errors are blocking the current feature tree.
                </p>
                <p className="whitespace-pre-wrap break-words text-xs">
                  {firstParseDiagnostic?.message ||
                    'Fix the parse error to rebuild the feature tree.'}
                </p>
                <p className="text-xs text-chalkboard-20">
                  {isShowingStaleFeatureTree
                    ? 'Showing the last successful feature tree as a read-only reference. It may not match the current code.'
                    : 'No successful feature tree is available yet for this file.'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={goToError}
                    className="bg-chalkboard-10 text-destroy-80 p-1 rounded-sm flex-none hover:bg-chalkboard-10 hover:border-destroy-70 hover:text-destroy-80 border-transparent"
                  >
                    View error
                  </button>
                  {firstParseAction && (
                    <button
                      onClick={applyParseQuickFix}
                      className="bg-destroy-70 text-chalkboard-10 p-1 rounded-sm flex-none hover:bg-destroy-60 border-transparent"
                    >
                      {firstParseAction.name}
                    </button>
                  )}
                </div>
              </div>
            )}
            {operationEntries.map(
              ({ opOrList, key, itemRange, previousRange }) => {
                const shouldRenderRollbackAfter =
                  itemRange !== undefined &&
                  sourceRangesEqual(itemRange, displayedRollbackRange)
                const isBelowRollback =
                  rollbackOffset !== undefined &&
                  itemRange !== undefined &&
                  itemRange[0] > rollbackOffset

                let rendered: ReactNode
                if (
                  isArray(opOrList) &&
                  isSketchBlockOperationGroup(opOrList)
                ) {
                  const sketchGroupKey =
                    getSketchBlockOperationKey(opOrList[0]) ?? key
                  rendered = (
                    <SketchBlockOperationGroup
                      key={sketchGroupKey}
                      items={opOrList}
                      code={operationsCode}
                      isStaleReference={isReadOnlyFeatureTree}
                      sketchNoFace={sketchNoFace}
                      systemDeps={systemDeps}
                      modelingActor={modelingActor}
                      engineCommandManager={engineCommandManager}
                      onSelect={selectOperation}
                    />
                  )
                } else {
                  rendered = isArray(opOrList) ? (
                    <OperationItemGroup
                      key={key}
                      items={opOrList}
                      code={operationsCode}
                      isStaleReference={isReadOnlyFeatureTree}
                      sketchNoFace={sketchNoFace}
                      systemDeps={systemDeps}
                      modelingActor={modelingActor}
                      engineCommandManager={engineCommandManager}
                      onSelect={selectOperation}
                    />
                  ) : (
                    <OperationItem
                      key={key}
                      item={opOrList}
                      code={operationsCode}
                      isStaleReference={isReadOnlyFeatureTree}
                      sketchNoFace={sketchNoFace}
                      systemDeps={systemDeps}
                      modelingActor={modelingActor}
                      engineCommandManager={engineCommandManager}
                      onSelect={selectOperation}
                    />
                  )
                }

                return (
                  <div
                    key={key}
                    className={isBelowRollback ? 'opacity-40' : undefined}
                    onDragOver={
                      isOpenCascade && itemRange
                        ? (event) =>
                            moveRollbackPreviewToClosestSlot(
                              event,
                              itemRange,
                              previousRange
                            )
                        : undefined
                    }
                    onDrop={
                      isOpenCascade && itemRange
                        ? (event) => {
                            dropRollback(event, rollbackPreviewRange)
                          }
                        : undefined
                    }
                  >
                    {rendered}
                    {shouldRenderRollbackAfter && (
                      <RollbackBar
                        onDragStart={(event) =>
                          startRollbackDrag(event, itemRange)
                        }
                        onDragEnd={endRollbackDrag}
                      />
                    )}
                  </div>
                )
              }
            )}
            {isOpenCascade &&
              (displayedRollbackRange === undefined ||
                rollbackOffset === undefined) && (
                <RollbackBar
                  onDragStart={(event) => startRollbackDrag(event, undefined)}
                  onDragEnd={endRollbackDrag}
                  onDragOver={(event) => {
                    if (!isDraggingRollback) return
                    event.preventDefault()
                    setRollbackPreviewRange(undefined)
                  }}
                  onDrop={(event) => dropRollback(event, undefined)}
                />
              )}
          </>
        )}
      </section>
    </div>
  )
})

function RollbackBar({
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  onDragStart: (event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
  onDragOver?: (event: DragEvent<HTMLElement>) => void
  onDrop?: (event: DragEvent<HTMLElement>) => void
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="my-2 flex justify-center cursor-grab active:cursor-grabbing"
    >
      <div className="h-1.5 w-16 rounded-full bg-primary shadow-sm shadow-primary/20" />
      <Tooltip hoverOnly position="top" delay={250} contentClassName="text-xs">
        Rollback bar
      </Tooltip>
    </div>
  )
}

function operationTreeItemKey(item: Operation | Operation[]) {
  if (!isArray(item)) {
    return `${item.type}-${
      'name' in item ? item.name : 'anonymous'
    }-${'sourceRange' in item ? item.sourceRange[0] : 'start'}`
  }
  const first = item[0]
  const last = item[item.length - 1]
  return `group-${
    first?.type ?? 'unknown'
  }-${first && 'sourceRange' in first ? first.sourceRange[0] : 'start'}-${
    last && 'sourceRange' in last ? last.sourceRange[1] : 'end'
  }`
}

function operationTreeItemRange(
  item: Operation | Operation[]
): SourceRange | undefined {
  if (isArray(item)) {
    const ranges = item.flatMap((operation) =>
      'sourceRange' in operation ? [operation.sourceRange] : []
    )
    if (ranges.length === 0) {
      return undefined
    }
    return [
      Math.min(...ranges.map((range) => range[0])),
      Math.max(...ranges.map((range) => range[1])),
      ranges[0][2],
    ]
  }
  return 'sourceRange' in item ? item.sourceRange : undefined
}

function rollbackRangeForOffset(
  operationEntries: { itemRange: SourceRange | undefined }[],
  rollbackOffset: number | undefined
): SourceRange | undefined {
  if (rollbackOffset === undefined) {
    return undefined
  }
  return operationEntries
    .map((entry) => entry.itemRange)
    .filter((range): range is SourceRange => range !== undefined)
    .filter((range) => range[1] <= rollbackOffset)
    .sort((a, b) => b[1] - a[1])[0]
}

function sourceRangesEqual(
  left: SourceRange | undefined,
  right: SourceRange | undefined
) {
  return (
    left !== undefined &&
    right !== undefined &&
    left[0] === right[0] &&
    left[1] === right[1] &&
    left[2] === right[2]
  )
}
function SketchBlockOperationGroup({
  items,
  code,
  isStaleReference,
  sketchNoFace,
  systemDeps,
  modelingActor,
  engineCommandManager,
  onSelect,
}: Omit<OperationProps, 'item'> & { items: Operation[] }) {
  if (items.length === 0) {
    return null
  }

  const parentItem =
    items.find((item) => item.type === 'SketchSolve') ?? items[0]
  const childItems = items.filter((item) => item !== parentItem)

  if (childItems.length === 0) {
    return (
      <OperationItem
        item={parentItem}
        code={code}
        isStaleReference={isStaleReference}
        sketchNoFace={sketchNoFace}
        systemDeps={systemDeps}
        modelingActor={modelingActor}
        engineCommandManager={engineCommandManager}
        onSelect={onSelect}
      />
    )
  }

  return (
    <Disclosure>
      <div className="flex items-start gap-1">
        <Disclosure.Button
          data-testid="sketchblock-group-caret"
          className="reset !px-0 !py-1 self-stretch !border-transparent focus-within:bg-primary/25 hover:!bg-2 hover:focus-within:bg-primary/25"
        >
          <CustomIcon
            name="caretDown"
            className="w-4 h-4 block -rotate-90 ui-open:rotate-0 ui-open:transform"
            aria-hidden
          />
        </Disclosure.Button>
        <div className="flex-1 min-w-0">
          <OperationItem
            item={parentItem}
            code={code}
            isStaleReference={isStaleReference}
            sketchNoFace={sketchNoFace}
            systemDeps={systemDeps}
            modelingActor={modelingActor}
            engineCommandManager={engineCommandManager}
            onSelect={onSelect}
          />
        </div>
      </div>
      <Disclosure.Panel>
        <div className="border-l b-4 ml-6">
          {childItems.map((item) => {
            const key = `${item.type}-${
              'name' in item ? item.name : 'anonymous'
            }-${'sourceRange' in item ? item.sourceRange[0] : 'start'}`
            return (
              <OperationItem
                key={key}
                item={item}
                code={code}
                isStaleReference={isStaleReference}
                sketchNoFace={sketchNoFace}
                systemDeps={systemDeps}
                modelingActor={modelingActor}
                engineCommandManager={engineCommandManager}
                onSelect={onSelect}
                size="sm"
              />
            )
          })}
        </div>
      </Disclosure.Panel>
    </Disclosure>
  )
}

interface VisibilityToggleProps {
  visible: boolean
  onVisibilityChange: () => unknown
}

/**
 * A grouping of operation items into a disclosure (or dropdown)
 */
function OperationItemGroup({
  items,
  code,
  isStaleReference,
  sketchNoFace,
  systemDeps,
  modelingActor,
  engineCommandManager,
  onSelect,
}: Omit<OperationProps, 'item'> & { items: Operation[] }) {
  return (
    <Disclosure>
      <Disclosure.Button className="reset w-full min-w-[0px] !px-1 flex items-center gap-2 text-left text-base !border-transparent focus-within:bg-primary/25 hover:!bg-2 hover:focus-within:bg-primary/25">
        <CustomIcon
          name="caretDown"
          className="w-6 h-6 block self-start -rotate-90 ui-open:rotate-0 ui-open:transform"
          aria-hidden
        />
        <span className="text-sm flex-1">
          {items.length} {getOpTypeLabel(items[0].type)}s
        </span>
      </Disclosure.Button>
      <Disclosure.Panel as="ul" className="border-b b-4">
        <div className="border-l b-4 ml-4">
          {items.map((op) => {
            const key = `${op.type}-${
              'name' in op ? op.name : 'anonymous'
            }-${'sourceRange' in op ? op.sourceRange[0] : 'start'}`
            return (
              <OperationItem
                key={key}
                item={op}
                code={code}
                isStaleReference={isStaleReference}
                sketchNoFace={sketchNoFace}
                systemDeps={systemDeps}
                modelingActor={modelingActor}
                engineCommandManager={engineCommandManager}
                onSelect={onSelect}
                size="sm"
              />
            )
          })}
        </div>
      </Disclosure.Panel>
    </Disclosure>
  )
}

type OpValueProps = {
  name: string
  type?: Operation['type']
  variableName?: string
  valueDetail?: { calculated: OpKclValue; display: string }
}

/**
 * More generic version of OperationListItem,
 * to be used for default planes after we fix them and
 * add them to the artifact graph / feature tree
 */
const OperationItemWrapper = memo(
  ({
    icon,
    name,
    type,
    variableName,
    visibilityToggle,
    valueDetail,
    menuItems,
    errors,
    customSuffix,
    className,
    Tooltip,
    size = 'default',
    ...props
  }: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
    icon: CustomIconName
    visibilityToggle?: VisibilityToggleProps
    customSuffix?: React.JSX.Element
    menuItems?: ComponentProps<typeof ContextMenu>['items']
    errors?: Diagnostic[]
    onContextMenu?: (e: MouseEvent) => void
    Tooltip?: ReactNode
    isSelected?: boolean
    size?: 'default' | 'sm'
  } & OpValueProps) => {
    return (
      <RowItemWithIconMenuAndToggle
        {...props}
        icon={icon}
        size={size}
        LabelSecondary={
          <>
            {variableName && valueDetail ? (
              <>
                <span className="text-sm">{variableName}</span>
                <code
                  data-testid="value-detail"
                  className="block min-w-[0px] flex-auto overflow-hidden whitespace-nowrap overflow-ellipsis text-chalkboard-70 dark:text-chalkboard-40 text-xs"
                >
                  {getOperationCalculatedDisplay(valueDetail.calculated)}
                </code>
              </>
            ) : null}
            {customSuffix ?? null}
          </>
        }
        Warning={
          errors && errors.length > 0 ? (
            <em className="text-destroy-80 text-xs">has error</em>
          ) : null
        }
        Tooltip={Tooltip}
        Toggle={
          visibilityToggle ? <VisibilityToggle {...visibilityToggle} /> : null
        }
        menuItems={menuItems}
      >
        {variableName ?? name}
      </RowItemWithIconMenuAndToggle>
    )
  }
)

function VariableTooltipContents({
  variableName,
  valueDetail,
  name,
  type,
}: OpValueProps) {
  return variableName && valueDetail ? (
    <div className="flex flex-col gap-2">
      <p>
        <span>{name}</span>
        <span> named </span>
        <span>{variableName ?? ''}</span>
      </p>
      <p className="font-mono text-xs">
        <span>{getOperationCalculatedDisplay(valueDetail.calculated)}</span>
        <span> = </span>
        <span>{valueDetail.display}</span>
      </p>
    </div>
  ) : type === 'GroupBegin' ? (
    <>{`Function call of ${name} named ${variableName}`}</>
  ) : (
    <>{`${variableName ? '' : 'Unnamed '}${name}${variableName ? ` named ${variableName}` : ''}`}</>
  )
}

interface OperationProps {
  item: Operation
  code: string
  isStaleReference?: boolean
  sketchNoFace: boolean
  systemDeps: SystemDeps
  engineCommandManager: ConnectionManager
  modelingActor: ReturnType<typeof useModelingContext>['actor']
  onSelect: (sourceRange: SourceRange) => void
  size?: 'default' | 'sm'
}
/**
 * A button with an icon, name, and context menu
 * for an operation in the feature tree.
 */
const OperationItem = ({
  item,
  code,
  isStaleReference = false,
  sketchNoFace,
  onSelect,
  systemDeps,
  modelingActor,
  engineCommandManager,
  size,
}: OperationProps) => {
  useSignals()
  const { layout } = useApp()
  const { kclManager, commandBarActor } = systemDeps
  const useSketchSolveMode =
    modelingActor.getSnapshot().context.store.useSketchSolveMode?.current
  const diagnostics = kclManager.diagnosticsSignal.value
  const liveAst = kclManager.astSignal.value
  const ast = kclManager.hasParseErrors() ? kclManager.lastGoodAst : liveAst
  const wasmInstance = use(kclManager.wasmInstancePromise)
  const name = getOperationLabel(item)
  const sourceRange =
    'sourceRange' in item &&
    sourceRangeToUtf16(sourceRangeFromRust(item.sourceRange), kclManager.code)
  const isSelected = useMemo(() => {
    if (!sourceRange) {
      return false
    }

    return kclManager.editorState.selection.ranges.some(({ from, to }) => {
      return isOverlap(sourceRange, topLevelRange(from, to))
    })
  }, [kclManager.editorState.selection, sourceRange])
  const valueDetail = useMemo(() => {
    return getFeatureTreeValueDetail(item, code)
  }, [item, code])

  const variableName = useMemo(() => {
    return getOperationVariableName(item, ast, wasmInstance)
  }, [item, ast, wasmInstance])

  const errors = useMemo(() => {
    if (isStaleReference) {
      return []
    }
    return diagnostics.filter(
      (diag) =>
        diag.severity === 'error' &&
        'sourceRange' in item &&
        diag.from >= toUtf16(item.sourceRange[0], code) &&
        diag.to <= toUtf16(item.sourceRange[1], code)
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [diagnostics.length, isStaleReference])

  const selectOperation = useCallback(
    async (providedSourceRange?: SourceRange) => {
      if (sketchNoFace) {
        if (isOffsetPlane(item)) {
          const artifact = findOperationPlaneArtifact(
            item,
            kclManager.artifactGraph
          )
          const result = await selectSketchPlane(
            artifact?.id,
            useSketchSolveMode,
            kclManager
          )
          if (err(result)) {
            console.error(result)
          }
        }
      } else if (providedSourceRange !== undefined) {
        onSelect(sourceRangeFromRust(providedSourceRange))
      } else {
        if (item.type === 'GroupEnd') {
          return
        }
        onSelect(sourceRangeFromRust(item.sourceRange))
      }
    },
    [sketchNoFace, onSelect, item, kclManager, useSketchSolveMode]
  )

  const enterEditFlow = useCallback(() => {
    if (
      item.type === 'StdLibCall' ||
      item.type === 'VariableDeclaration' ||
      item.type === 'SketchSolve'
    ) {
      const startEdit = async () => {
        if (
          'isOpenCascade' in engineCommandManager &&
          engineCommandManager.isOpenCascade === true
        ) {
          const rollbackResult =
            await systemDeps.kclManager.beginOpenCascadeRollbackEdit(
              item.sourceRange
            )
          if (err(rollbackResult)) {
            throw rollbackResult
          }
        }
        const artifact =
          getArtifactFromRange(
            item.sourceRange,
            systemDeps.kclManager.artifactGraph
          ) ?? undefined
        return prepareEditCommand({
          artifactGraph: systemDeps.kclManager.artifactGraph,
          code: systemDeps.kclManager.code,
          commandBarActor,
          operation: item,
          rustContext: systemDeps.rustContext,
          artifact,
        })
      }
      startEdit().catch((e) =>
        toast.error(err(e) ? e.message : JSON.stringify(e))
      )
    }
  }, [
    item,
    commandBarActor,
    engineCommandManager,
    systemDeps.kclManager,
    systemDeps.kclManager.artifactGraph,
    systemDeps.kclManager.code,
    systemDeps.rustContext,
  ])

  function enterAppearanceFlow() {
    selectOperation()
      .then(() => {
        if (
          item.type === 'StdLibCall' ||
          (item.type === 'GroupBegin' && item.group.type === 'FunctionCall')
        ) {
          commandBarActor.send({
            type: 'Find and select command',
            data: { name: 'Appearance', groupId: 'modeling' },
          })
        }
      })
      .catch((e) => toast.error(e))
  }

  function enterTranslateFlow() {
    selectOperation()
      .then(() => {
        if (item.type === 'StdLibCall' || item.type === 'GroupBegin') {
          commandBarActor.send({
            type: 'Find and select command',
            data: { name: 'Translate', groupId: 'modeling' },
          })
        }
      })
      .catch((e) => toast.error(e))
  }

  function enterRotateFlow() {
    selectOperation()
      .then(() => {
        if (item.type === 'StdLibCall' || item.type === 'GroupBegin') {
          commandBarActor.send({
            type: 'Find and select command',
            data: { name: 'Rotate', groupId: 'modeling' },
          })
        }
      })
      .catch((e) => toast.error(e))
  }

  function enterScaleFlow() {
    selectOperation()
      .then(() => {
        if (item.type === 'StdLibCall' || item.type === 'GroupBegin') {
          commandBarActor.send({
            type: 'Find and select command',
            data: { name: 'Scale', groupId: 'modeling' },
          })
        }
      })
      .catch((e) => toast.error(e))
  }

  function enterCloneFlow() {
    selectOperation()
      .then(() => {
        if (item.type === 'StdLibCall' || item.type === 'GroupBegin') {
          commandBarActor.send({
            type: 'Find and select command',
            data: { name: 'Clone', groupId: 'modeling' },
          })
        }
      })
      .catch((e) => toast.error(e))
  }

  function deleteOperation() {
    if (
      item.type === 'StdLibCall' ||
      item.type === 'GroupBegin' ||
      item.type === 'VariableDeclaration' ||
      item.type === 'SketchSolve'
    ) {
      const maybeArtifact =
        getArtifactFromRange(item.sourceRange, kclManager.artifactGraph) ??
        undefined
      sendDeleteCommand({
        artifact: maybeArtifact,
        targetSourceRange: item.sourceRange,
        systemDeps,
      }).catch((e) => {
        toast.error(isErr(e) ? e.message : JSON.stringify(e))
      })
    }
  }

  function startSketchOnOffsetPlane() {
    if (isOffsetPlane(item)) {
      const artifact = findOperationPlaneArtifact(
        item,
        kclManager.artifactGraph
      )
      if (artifact?.id) {
        kclManager.sceneInfra.modelingSend({
          type: 'Enter sketch',
          data: { forceNewSketch: true },
        })

        void selectSketchPlane(artifact.id, useSketchSolveMode, kclManager)
      }
    }
  }

  const menuItems = useMemo(
    () =>
      isStaleReference
        ? []
        : [
            <ContextMenuItem
              onClick={() => {
                if (item.type === 'GroupEnd') {
                  return
                }
                const l = layout.signal.value
                if (!isCodePaneOpen(l)) {
                  openCodePane(l, layout.set)
                }
                selectOperation().catch(reportRejection)
              }}
            >
              View KCL source code
            </ContextMenuItem>,
            ...(item.type === 'GroupBegin' && item.group.type === 'FunctionCall'
              ? [
                  <ContextMenuItem
                    onClick={() => {
                      if (item.type !== 'GroupBegin') {
                        return
                      }
                      if (item.group.type !== 'FunctionCall') {
                        // TODO: Add module instance support.
                        return
                      }
                      const functionRange = item.group.functionSourceRange
                      // For some reason, the cursor goes to the end of the source
                      // range we select.  So set the end equal to the beginning.
                      functionRange[1] = functionRange[0]
                      const l = layout.signal.value
                      if (!isCodePaneOpen(l)) {
                        openCodePane(l, layout.set)
                      }
                      selectOperation(functionRange).catch(reportRejection)
                    }}
                  >
                    View function definition
                  </ContextMenuItem>,
                ]
              : []),
            ...(isOffsetPlane(item)
              ? [
                  <ContextMenuItem onClick={startSketchOnOffsetPlane}>
                    Start Sketch
                  </ContextMenuItem>,
                ]
              : []),
            ...(item.type === 'StdLibCall' && item.name === 'startSketchOn'
              ? [
                  <ContextMenuItem
                    onClick={() => {
                      const exportDxf = async () => {
                        if (item.type !== 'StdLibCall') return
                        await exportSketchToDxf(item, {
                          engineCommandManager,
                          kclManager,
                          toast,
                          uuidv4,
                          base64Decode,
                          browserSaveFile,
                        })
                      }
                      void exportDxf()
                    }}
                    data-testid="context-menu-export-dxf"
                  >
                    Export to DXF
                  </ContextMenuItem>,
                ]
              : []),
            ...(item.type === 'StdLibCall' && item.name === 'subtract2d'
              ? [
                  <ContextMenuItem
                    onClick={() => {
                      const exportDxf = async () => {
                        if (item.type !== 'StdLibCall') return
                        await exportSketchToDxf(item, {
                          engineCommandManager,
                          kclManager,
                          toast,
                          uuidv4,
                          base64Decode,
                          browserSaveFile,
                        })
                      }
                      void exportDxf()
                    }}
                    data-testid="context-menu-export-dxf"
                  >
                    Export to DXF
                  </ContextMenuItem>,
                ]
              : []),
            ...(item.type === 'StdLibCall' ||
            item.type === 'VariableDeclaration' ||
            item.type === 'SketchSolve'
              ? [
                  <ContextMenuItem
                    disabled={
                      item.type !== 'VariableDeclaration' &&
                      item.type !== 'SketchSolve' &&
                      stdLibMap[item.name]?.prepareToEdit === undefined
                    }
                    onClick={enterEditFlow}
                    hotkey="Double click"
                  >
                    Edit
                  </ContextMenuItem>,
                ]
              : []),
            ...(item.type === 'StdLibCall' ||
            (item.type === 'GroupBegin' && item.group.type === 'FunctionCall')
              ? [
                  <ContextMenuItem
                    disabled={
                      !(
                        (item.type === 'GroupBegin' &&
                          item.group.type === 'FunctionCall') ||
                        (item.type === 'StdLibCall' &&
                          stdLibMap[item.name]?.supportsAppearance)
                      )
                    }
                    onClick={enterAppearanceFlow}
                    data-testid="context-menu-set-appearance"
                  >
                    Set appearance
                  </ContextMenuItem>,
                ]
              : []),
            ...(item.type === 'StdLibCall' || item.type === 'GroupBegin'
              ? [
                  <ContextMenuItem
                    onClick={enterTranslateFlow}
                    data-testid="context-menu-set-translate"
                    disabled={
                      item.type !== 'GroupBegin' &&
                      !stdLibMap[item.name]?.supportsTransform
                    }
                  >
                    Translate
                  </ContextMenuItem>,
                  <ContextMenuItem
                    onClick={enterRotateFlow}
                    data-testid="context-menu-set-rotate"
                    disabled={
                      item.type !== 'GroupBegin' &&
                      !stdLibMap[item.name]?.supportsTransform
                    }
                  >
                    Rotate
                  </ContextMenuItem>,
                  <ContextMenuItem
                    onClick={enterScaleFlow}
                    data-testid="context-menu-set-scale"
                    disabled={
                      item.type !== 'GroupBegin' &&
                      !stdLibMap[item.name]?.supportsTransform
                    }
                  >
                    Scale
                  </ContextMenuItem>,
                  <ContextMenuItem
                    onClick={enterCloneFlow}
                    data-testid="context-menu-clone"
                    disabled={
                      item.type !== 'GroupBegin' &&
                      !stdLibMap[item.name]?.supportsTransform
                    }
                  >
                    Clone
                  </ContextMenuItem>,
                ]
              : []),
            ...(item.type === 'StdLibCall' ||
            item.type === 'GroupBegin' ||
            item.type === 'VariableDeclaration' ||
            item.type === 'SketchSolve'
              ? [
                  <ContextMenuItem
                    onClick={deleteOperation}
                    hotkey="Delete"
                    data-testid="context-menu-delete"
                  >
                    Delete
                  </ContextMenuItem>,
                ]
              : []),
          ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    [item, isStaleReference, layout.signal.value]
  )

  const enabled = (!sketchNoFace || isOffsetPlane(item)) && !isStaleReference

  const visibilityState = resolveFeatureTreeVisibility({
    item,
    operations: kclManager.operations ?? [],
    artifactGraph: kclManager.artifactGraph,
  })

  return (
    <OperationItemWrapper
      icon={getOperationIcon(item)}
      name={name}
      type={item.type}
      variableName={variableName}
      valueDetail={valueDetail}
      Tooltip={
        <Tooltip
          delay={500}
          position="bottom-left"
          wrapperClassName="left-0 right-0"
          contentClassName="text-sm max-w-full"
        >
          <VariableTooltipContents
            variableName={variableName}
            valueDetail={valueDetail}
            name={name}
            type={item.type}
          />
        </Tooltip>
      }
      menuItems={menuItems}
      onClick={
        isStaleReference
          ? undefined
          : () => {
              void selectOperation()
            }
      }
      onContextMenu={
        isStaleReference
          ? undefined
          : () => {
              void selectOperation()
            }
      }
      onDoubleClick={
        sketchNoFace || isStaleReference ? undefined : enterEditFlow
      } // no double click in "Sketch no face" mode
      isSelected={isSelected}
      errors={errors}
      disabled={!enabled}
      size={size}
      visibilityToggle={
        !isStaleReference && visibilityState.canToggleVisibility
          ? {
              visible: visibilityState.hideOperation === undefined,
              onVisibilityChange: () => {
                selectOperation()
                  .then(() => {
                    if (visibilityState.hideOperation === undefined) {
                      onHide({
                        ast: kclManager.ast,
                        artifactGraph: kclManager.artifactGraph,
                        modelingActor,
                      })
                    } else if (visibilityState.targetArtifact !== undefined) {
                      onUnhide({
                        hideOperation: visibilityState.hideOperation,
                        targetArtifact: visibilityState.targetArtifact,
                        kclManager,
                      })
                        .then((result) => {
                          if (err(result)) {
                            toast.error(
                              result.message || 'Error while unhiding.'
                            )
                          }
                        })
                        .catch((e) => {
                          toast.error(e.message || 'Error while unhiding.')
                        })
                    }
                  })
                  .catch(reportRejection)
              },
            }
          : undefined
      }
    />
  )
}

export const DefaultPlanes = ({
  systemDeps,
  disabled = false,
}: {
  systemDeps: SystemDeps
  disabled?: boolean
}) => {
  const { rustContext, sceneInfra, kclManager } = systemDeps
  const { state: modelingState, send } = useModelingContext()
  const sketchNoFace = modelingState.matches('Sketch no face')
  const isOpenCascade =
    'isOpenCascade' in kclManager.engineCommandManager &&
    Boolean(kclManager.engineCommandManager.isOpenCascade)
  const selectedDefaultPlaneKeys = useMemo(
    () =>
      selectedFeatureTreeDefaultPlaneKeys(
        modelingState.context.selectionRanges,
        rustContext.defaultPlanes
      ),
    [modelingState.context.selectionRanges, rustContext.defaultPlanes]
  )

  const onClickPlane = useCallback(
    (planeId: string) => {
      if (sketchNoFace) {
        void selectSketchPlane(
          planeId,
          modelingState.context.store.useSketchSolveMode?.current,
          kclManager
        )
      } else {
        const foundDefaultPlane =
          rustContext.defaultPlanes !== null &&
          Object.entries(rustContext.defaultPlanes).find(
            ([, plane]) => plane === planeId
          )
        if (foundDefaultPlane) {
          send({
            type: 'Set selection',
            data: {
              selectionType: 'defaultPlaneSelection',
              selection: {
                name: foundDefaultPlane[0] as DefaultPlaneStr,
                id: planeId,
              },
            },
          })
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    [sketchNoFace, modelingState.context.store.useSketchSolveMode]
  )

  const startSketchOnDefaultPlane = useCallback(
    (planeId: string) => {
      sceneInfra.modelingSend({
        type: 'Enter sketch',
        data: { forceNewSketch: true },
      })

      void selectSketchPlane(
        planeId,
        modelingState.context.store.useSketchSolveMode?.current,
        kclManager
      )
    },
    [modelingState.context.store.useSketchSolveMode, sceneInfra, kclManager]
  )

  const defaultPlanes = rustContext.defaultPlanes
  if (!defaultPlanes && !isOpenCascade) {
    return null
  }

  const planes = [
    {
      name: 'Front plane',
      id: defaultPlanes?.xz,
      key: 'xz',
      customSuffix: (
        <div className="text-blue-500/50 font-bold text-xs">XZ</div>
      ),
    },
    {
      name: 'Top plane',
      id: defaultPlanes?.xy,
      key: 'xy',
      customSuffix: <div className="text-red-500/50 font-bold text-xs">XY</div>,
    },
    {
      name: 'Side plane',
      id: defaultPlanes?.yz,
      key: 'yz',
      customSuffix: (
        <div className="text-green-500/50 font-bold text-xs">YZ</div>
      ),
    },
  ] as const

  return (
    <div className="mb-2">
      {isOpenCascade && (
        <OperationItemWrapper
          key="origin"
          customSuffix={
            <div className="text-chalkboard-60 font-bold text-xs">0,0,0</div>
          }
          icon={'circle'}
          name="Origin"
          disabled={disabled}
          visibilityToggle={
            disabled
              ? undefined
              : {
                  visible: modelingState.context.defaultPlaneVisibility.origin,
                  onVisibilityChange: () => {
                    send({
                      type: 'Toggle default plane visibility',
                      planeKey: 'origin',
                    })
                  },
                }
          }
        />
      )}
      {planes.map((plane) => {
        const planeId = plane.id
        const planeDisabled = disabled || !planeId

        return (
          <OperationItemWrapper
            key={plane.key}
            customSuffix={plane.customSuffix}
            icon={'plane'}
            name={plane.name}
            disabled={planeDisabled}
            isSelected={selectedDefaultPlaneKeys.has(plane.key)}
            onClick={planeDisabled ? undefined : () => onClickPlane(planeId)}
            menuItems={
              planeDisabled
                ? undefined
                : [
                    <ContextMenuItem
                      onClick={() => startSketchOnDefaultPlane(planeId)}
                    >
                      Start Sketch
                    </ContextMenuItem>,
                  ]
            }
            visibilityToggle={
              disabled
                ? undefined
                : {
                    visible:
                      modelingState.context.defaultPlaneVisibility[plane.key],
                    onVisibilityChange: () => {
                      send({
                        type: 'Toggle default plane visibility',
                        planeId,
                        planeKey: plane.key,
                      })
                    },
                  }
            }
          />
        )
      })}
      <div className="h-px bg-chalkboard-50/20 my-2" />
    </div>
  )
}

export function selectedFeatureTreeDefaultPlaneKeys(
  selectionRanges: {
    otherSelections?: unknown[]
  },
  defaultPlanes: RustContext['defaultPlanes']
) {
  const selected = new Set<'xy' | 'xz' | 'yz'>()
  if (!defaultPlanes) {
    return selected
  }

  for (const selection of selectionRanges.otherSelections ?? []) {
    if (!selection || typeof selection !== 'object') {
      continue
    }
    const id =
      'id' in selection && typeof selection.id === 'string'
        ? selection.id
        : undefined
    if (!id) {
      continue
    }
    if (id === defaultPlanes.xy || id === defaultPlanes.negXy) {
      selected.add('xy')
    } else if (id === defaultPlanes.xz || id === defaultPlanes.negXz) {
      selected.add('xz')
    } else if (id === defaultPlanes.yz || id === defaultPlanes.negYz) {
      selected.add('yz')
    }
  }

  return selected
}

/**
 * Helper function to get value detail for operations (both datum and variable declarations)
 * @param operation - The operation to extract value detail from
 * @param code - The source code string to extract values from
 * @returns Value detail object with display string and calculated value, or undefined if no value
 */
export function getFeatureTreeValueDetail(
  operation: Operation,
  code: string
): { calculated: OpKclValue; display: string } | undefined {
  if (operation.type === 'VariableDeclaration') {
    return {
      display: code.slice(
        ...operation.sourceRange.map((r) => toUtf16(r, code))
      ),
      calculated: operation.value,
    }
  }

  // Show datum name for GDT Datum operations
  if (operation.type === 'StdLibCall' && operation.name === 'gdt::datum') {
    const nameArg = operation.labeledArgs?.name
    if (nameArg?.sourceRange) {
      const nameRaw = code.slice(
        ...nameArg.sourceRange.map((r) => toUtf16(r, code))
      )
      const datumName = stripQuotes(nameRaw)
      if (datumName) {
        const stringValue: OpKclValue = {
          type: 'String',
          value: datumName,
        }
        return {
          display: datumName,
          calculated: stringValue,
        }
      }
    }
  }

  return undefined
}
