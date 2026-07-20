import type { Diagnostic } from '@codemirror/lint'
import type { OpKclValue, Operation } from '@rust/kcl-lib/bindings/Operation'
import { type ContextMenu, ContextMenuItem } from '@src/components/ContextMenu'
import type { CustomIconName } from '@src/components/CustomIcon'
import { CustomIcon } from '@src/components/CustomIcon'
import { useModelingContext } from '@src/hooks/useModelingContext'
import {
  findOperationArtifact,
  findOperationPlaneArtifact,
  isOffsetPlane,
} from '@src/lang/queryAst'
import { sourceRangeFromRust } from '@src/lang/sourceRange'
import { getArtifactFromRange } from '@src/lang/std/artifactGraph'
import { topLevelRange } from '@src/lang/util'
import {
  ROOT_MODULE_ID,
  type SourceRange,
  base64Decode,
  countOperations,
  emptyOperationsByModule,
  getAllOperations,
} from '@src/lang/wasm'
import { useApp, useSingletons } from '@src/lib/boot'
import {
  type OperationTreeNode,
  buildOperationTree,
  findSameVisibleStdLibOperationAfterSourceChange,
  getOperationKey,
  getOperationTreeNodeKey,
  isOperationTreeBranch,
} from '@src/lib/featureTreeOperationTree'
import {
  getOpTypeLabel,
  getOperationCalculatedDisplay,
  getOperationIcon,
  getOperationLabel,
  getOperationVariableName,
  onHide,
  onUnhide,
  stdLibMap,
} from '@src/lib/operations'
import type { DefaultPlaneStr } from '@src/lib/planes'
import { getSelectedDefaultPlane, selectSketchPlane } from '@src/lib/selections'
import { err, isErr, reportRejection } from '@src/lib/trap'
import { isArray, isOverlap, stripQuotes, uuidv4 } from '@src/lib/utils'
import type { ComponentProps, ReactNode } from 'react'
import { memo, use, useCallback, useMemo } from 'react'
import toast from 'react-hot-toast'
export { buildOperationTree } from '@src/lib/featureTreeOperationTree'
import { Disclosure } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import type { SceneEntities } from '@src/clientSideScene/sceneEntities'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { RowItemWithIconMenuAndToggle } from '@src/components/RowItemWithIconMenuAndToggle'
import Tooltip from '@src/components/Tooltip'
import { VisibilityToggle } from '@src/components/VisibilityToggle'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { FeatureTreeMenu } from '@src/components/layout/areas/FeatureTreeMenu'
import usePlatform from '@src/hooks/usePlatform'
import { sourceRangeToUtf16, toUtf16 } from '@src/lang/errors'
import {
  getUnrenderedChangesDisabledReason,
  shouldDisableModelingForUnrenderedChanges,
} from '@src/lib/automaticRendering'
import { browserSaveFile } from '@src/lib/browserSaveFile'
import { exportSketchToDxf } from '@src/lib/exportDxf'
import {
  prepareEditCommand,
  resolveFeatureTreeVisibility,
  sendDeleteCommand,
  sendSelectionEvent,
} from '@src/lib/featureTree'
import {
  type AreaTypeComponentProps,
  DefaultLayoutPaneID,
  type Layout,
  getOpenPanes,
  togglePaneLayoutNode,
} from '@src/lib/layout'
import { PATHS } from '@src/lib/paths'
import type RustContext from '@src/lib/rustContext'
import type { CommandBarActorType } from '@src/machines/commandBarMachine'
import type { ConnectionManager } from '@src/network/connectionManager'
import { executingEditorService } from '@src/registry/contracts/executingEditor'
import {
  findKeymapItemForCommand,
  keymapKeystrokesDisplay,
  keymapScopesValueSpec,
  keymapService,
} from '@src/registry/contracts/keymap'
import { APP_COMMAND_IDS } from '@src/registry/extensions/commands/appCommands'
import { useNavigate } from 'react-router-dom'

type Singletons = ReturnType<typeof useSingletons>

type ModuleInstanceOperation = Extract<Operation, { type: 'ModuleInstance' }>
type StdLibCallOperation = Extract<Operation, { type: 'StdLibCall' }>

type SystemDeps = Pick<Singletons, 'kclManager'> & {
  commandBarActor: CommandBarActorType
  sceneInfra: SceneInfra
  sceneEntitiesManager: SceneEntities
  rustContext: RustContext
}

// Keep automatic edit-time migration disabled until all feature-tree and
// point-click edit flows support the new edge specifier syntax. Until then,
// expose Z0006 only as an explicit lint action.
//
// IMPORTANT: Edit after auto-fix is only correct if auto-fix doesn't change the
// operations. The migration can change the KCL, and we need to choose the
// correct operation to edit.
// `findSameVisibleStdLibOperationAfterSourceChange()` uses a heuristic, but it
// may fail since operations don't have an identity that persists across
// executions. Currently, we don't change the operations in an auto-fix, but
// this seems brittle.
const ENABLE_Z0006_AUTO_FIX_BEFORE_FEATURE_TREE_EDIT = false
const UNRENDERED_EXECUTE_HOTKEY = 'mod+s'

const Z0006_AUTO_FIX_BEFORE_EDIT_OPERATION_NAMES = new Set([
  'fillet',
  'chamfer',
  'extrude',
  'revolve',
  'helix',
  'mirror3d',
  'gdt::flatness',
  'gdt::straightness',
  'gdt::circularity',
  'gdt::cylindricity',
  'gdt::position',
  'gdt::profile',
  'gdt::profileLine',
  'gdt::profileSurface',
  'gdt::distance',
  'gdt::perpendicularity',
  'gdt::angularity',
  'gdt::concentricity',
  'gdt::symmetry',
  'gdt::runout',
  'gdt::parallelism',
  'gdt::annotation',
])

export function supportsZ0006AutoFixBeforeFeatureTreeEdit(
  operation: Operation
): boolean {
  return (
    operation.type === 'StdLibCall' &&
    Z0006_AUTO_FIX_BEFORE_EDIT_OPERATION_NAMES.has(operation.name)
  )
}

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
  const keymap = app.registry.optional(keymapService)
  const unrenderedExecuteHotkeyLabel = keymapKeystrokesDisplay(
    keymap
      ? findKeymapItemForCommand(
          keymap.keymap.value,
          APP_COMMAND_IDS.editor.render,
          keymap.getCurrentScopes(),
          app.registry.signal(keymapScopesValueSpec).value
        )?.keystrokes
      : [UNRENDERED_EXECUTE_HOTKEY],
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
  const longestErrorOperationsByModule = kclManager.errors.reduce(
    (acc, error) => {
      return countOperations(error.operations) > countOperations(acc)
        ? error.operations
        : acc
    },
    emptyOperationsByModule()
  )

  const unfilteredOperationsByModule = kclManager.isExecuting
    ? kclManager.operationsByModule
    : !hasParseErrors
      ? !kclManager.errors.length
        ? kclManager.operationsByModule
        : longestErrorOperationsByModule
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
  const operationList = buildOperationTree(
    unfilteredOperationsByModule,
    ROOT_MODULE_ID
  )
  const isShowingStaleFeatureTree = hasParseErrors && operationList.length > 0

  // Live execution tracking: expand only the active module branch.
  const liveActiveModuleId = kclManager.liveActiveModuleId

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
        <>
          {kclManager.isExecuting && (
            <div className="text-xs bg-primary/10 text-primary py-2 px-2 rounded flex-none mb-2 border border-primary/20">
              Updating feature tree...
            </div>
          )}
          {!modelingState.matches('Sketch') && (
            <DefaultPlanes
              systemDeps={systemDeps}
              disabled={disableModelingForUnrenderedChanges}
            />
          )}
          {disableModelingForUnrenderedChanges && !hasParseErrors && (
            <div className="text-sm bg-2 text-2 py-2 px-2 rounded flex flex-col gap-2 flex-none mb-2 border border-chalkboard-20 dark:border-chalkboard-80">
              <p className="font-medium">Feature tree actions are disabled.</p>
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
          {operationList.map((node) => (
            <OperationTreeNodeItem
              key={getOperationTreeNodeKey(node)}
              node={node}
              code={operationsCode}
              isStaleReference={isReadOnlyFeatureTree}
              sketchNoFace={sketchNoFace}
              systemDeps={systemDeps}
              modelingActor={modelingActor}
              engineCommandManager={engineCommandManager}
              onSelect={selectOperation}
              liveActiveModuleId={liveActiveModuleId}
            />
          ))}
        </>
      </section>
    </div>
  )
})

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
  isModuleOwned = false,
}: Omit<OperationProps, 'item'> & {
  items: Operation[]
  isModuleOwned?: boolean
}) {
  const contentItems = items.filter((item) => item.type !== 'GroupEnd')
  if (contentItems.length === 0) {
    return null
  }

  const parentItem =
    contentItems[0]?.type === 'GroupBegin' &&
    items.some((i) => i.type === 'GroupEnd')
      ? contentItems[0]
      : undefined
  const childItems = parentItem
    ? contentItems.filter((i) => i !== parentItem)
    : []

  if (parentItem) {
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
          isModuleOwned={isModuleOwned}
        />
      )
    }

    return (
      <Disclosure>
        <div className="flex items-start gap-1">
          <Disclosure.Button
            data-testid="operation-group-caret"
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
              isModuleOwned={isModuleOwned}
            />
          </div>
        </div>
        <Disclosure.Panel>
          <div className="border-l b-4 ml-6">
            {childItems.map((item) => {
              return (
                <OperationItem
                  key={getOperationKey(item)}
                  item={item}
                  code={code}
                  isStaleReference={isStaleReference}
                  sketchNoFace={sketchNoFace}
                  systemDeps={systemDeps}
                  modelingActor={modelingActor}
                  engineCommandManager={engineCommandManager}
                  onSelect={onSelect}
                  size="sm"
                  isModuleOwned={isModuleOwned}
                />
              )
            })}
          </div>
        </Disclosure.Panel>
      </Disclosure>
    )
  }

  return (
    <Disclosure>
      <Disclosure.Button className="reset w-full min-w-[0px] !px-1 flex items-center gap-2 text-left text-base !border-transparent focus-within:bg-primary/25 hover:!bg-2 hover:focus-within:bg-primary/25">
        <CustomIcon
          name="caretDown"
          className="w-6 h-6 block self-start -rotate-90 ui-open:rotate-0 ui-open:transform"
          aria-hidden
        />
        <span className="text-sm flex-1">
          {contentItems.length} {getOpTypeLabel(contentItems[0].type)}s
        </span>
      </Disclosure.Button>
      <Disclosure.Panel as="ul" className="border-b b-4">
        <div className="border-l b-4 ml-4">
          {contentItems.map((op) => {
            return (
              <OperationItem
                key={getOperationKey(op)}
                item={op}
                code={code}
                isStaleReference={isStaleReference}
                sketchNoFace={sketchNoFace}
                systemDeps={systemDeps}
                modelingActor={modelingActor}
                engineCommandManager={engineCommandManager}
                onSelect={onSelect}
                size="sm"
                isModuleOwned={isModuleOwned}
              />
            )
          })}
        </div>
      </Disclosure.Panel>
    </Disclosure>
  )
}

function OperationBranchGroup({
  parentItem,
  childItems,
  code,
  isStaleReference,
  sketchNoFace,
  systemDeps,
  modelingActor,
  engineCommandManager,
  onSelect,
  isModuleOwned = false,
  liveActiveModuleId,
}: Omit<OperationProps, 'item'> & {
  parentItem: ModuleInstanceOperation
  childItems: OperationTreeNode[]
  isModuleOwned?: boolean
}) {
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
        isModuleOwned={true}
      />
    )
  }

  // During live execution, only expand the branch whose module received the
  // latest operation.  Outside live execution every branch defaults open.
  // Changing the key forces a Disclosure remount with the new defaultOpen
  // (headlessui v1 does not support a controlled `open` prop).
  const isLive = liveActiveModuleId != null
  const shouldBeOpen = !isLive || liveActiveModuleId === parentItem.moduleId

  return (
    <Disclosure
      key={`${parentItem.moduleId}-${shouldBeOpen}`}
      defaultOpen={shouldBeOpen}
    >
      <div
        className="flex items-start gap-1"
        data-module-branch={parentItem.moduleId}
      >
        <Disclosure.Button
          data-testid="operation-group-caret"
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
            isModuleOwned={true}
          />
        </div>
      </div>
      <Disclosure.Panel>
        <div className="border-l b-4 ml-6">
          {childItems.map((node) => {
            return (
              <OperationTreeNodeItem
                key={getOperationTreeNodeKey(node)}
                node={node}
                code={code}
                isStaleReference={isStaleReference}
                sketchNoFace={sketchNoFace}
                systemDeps={systemDeps}
                modelingActor={modelingActor}
                engineCommandManager={engineCommandManager}
                onSelect={onSelect}
                isModuleOwned={true}
              />
            )
          })}
        </div>
      </Disclosure.Panel>
    </Disclosure>
  )
}

function OperationTreeNodeItem({
  node,
  ...props
}: Omit<OperationProps, 'item'> & {
  node: OperationTreeNode
  isModuleOwned?: boolean
}) {
  if (isArray(node)) {
    return <OperationItemGroup items={node} {...props} />
  }

  if (isOperationTreeBranch(node)) {
    return (
      <OperationBranchGroup
        parentItem={node.parent}
        childItems={node.children}
        {...props}
      />
    )
  }

  // A plain ModuleInstance node (not a branch) is a deduplicated reference.
  // Clicking it should scroll to the expanded branch for that module.
  const referenceModuleId =
    node.type === 'ModuleInstance' ? node.moduleId : undefined

  return (
    <OperationItem
      item={node}
      {...props}
      referenceModuleId={referenceModuleId}
    />
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
        {variableName && valueDetail ? name : (variableName ?? name)}
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
  isModuleOwned?: boolean
  /** During live execution, the module that received the latest operation. */
  liveActiveModuleId?: number | null
  /** When set, this item is a deduplicated module reference; clicking scrolls to the expanded branch. */
  referenceModuleId?: number
}

function getFeatureTreeArtifactForEditOperation(
  operation: Operation,
  artifactGraph: SystemDeps['kclManager']['artifactGraph']
) {
  if (
    'sourceRange' in operation &&
    operation.sourceRange != null &&
    isArray(operation.sourceRange) &&
    operation.sourceRange.length >= 2
  ) {
    const sourceRange = operation.sourceRange
    const artifact = getArtifactFromRange(
      [sourceRange[0], sourceRange[1], sourceRange[2] ?? 0],
      artifactGraph
    )
    if (artifact) return artifact
  }

  if (operation.type === 'StdLibCall') {
    return findOperationArtifact(operation, artifactGraph) ?? undefined
  }

  return undefined
}

async function applyZ0006FixAndReselectFeatureTreeOperation({
  operation,
  systemDeps,
}: {
  operation: StdLibCallOperation
  systemDeps: SystemDeps
}): Promise<StdLibCallOperation | undefined> {
  const beforeOperations = getAllOperations(
    systemDeps.kclManager.lastSuccessfulOperations
  )
  const applied = await systemDeps.kclManager.applyZ0006FixBeforeEdit()
  if (!applied) return operation

  return findSameVisibleStdLibOperationAfterSourceChange({
    operation,
    beforeOperations,
    afterOperations: getAllOperations(
      systemDeps.kclManager.lastSuccessfulOperations
    ),
  })
}

async function prepareFeatureTreeEditCommand({
  operation,
  artifact,
  commandBarActor,
  selectOperation,
  systemDeps,
}: {
  operation: Operation
  artifact: ReturnType<typeof getArtifactFromRange> | undefined
  commandBarActor: CommandBarActorType
  selectOperation: () => Promise<void>
  systemDeps: SystemDeps
}) {
  await selectOperation()

  let operationToEdit: Operation | undefined = operation
  if (
    ENABLE_Z0006_AUTO_FIX_BEFORE_FEATURE_TREE_EDIT &&
    operation.type === 'StdLibCall' &&
    supportsZ0006AutoFixBeforeFeatureTreeEdit(operation)
  ) {
    operationToEdit = await applyZ0006FixAndReselectFeatureTreeOperation({
      operation,
      systemDeps,
    })
  }

  if (!operationToEdit) {
    toast.error(
      'Could not safely reselect operation after automatic migration. Please try again.'
    )
    return
  }

  const artifactForEdit:
    | NonNullable<ReturnType<typeof getArtifactFromRange>>
    | undefined =
    operationToEdit === operation
      ? (artifact ?? undefined)
      : getFeatureTreeArtifactForEditOperation(
          operationToEdit,
          systemDeps.kclManager.artifactGraph
        )

  return prepareEditCommand({
    artifactGraph: systemDeps.kclManager.artifactGraph,
    code: systemDeps.kclManager.code,
    commandBarActor,
    operation: operationToEdit,
    rustContext: systemDeps.rustContext,
    artifact: artifactForEdit,
  })
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
  isModuleOwned = false,
  referenceModuleId,
}: OperationProps) => {
  useSignals()
  const app = useApp()
  const navigate = useNavigate()
  const { layout } = app
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
  const isLiveLatest =
    kclManager.liveLatestOperationKey === getOperationKey(item)
  const isEditorSelected = useMemo(() => {
    if (!sourceRange) {
      return false
    }

    return kclManager.editorState.selection.ranges.some(({ from, to }) => {
      return isOverlap(sourceRange, topLevelRange(from, to))
    })
  }, [kclManager.editorState.selection, sourceRange])
  const isSelected = isLiveLatest || isEditorSelected
  const valueDetail = useMemo(() => {
    return getFeatureTreeValueDetail(item, code)
  }, [item, code])

  const variableName = useMemo(() => {
    // Module-owned ModuleInstance operations have a nodePath relative to their
    // own module's AST, not the currently open file.  Looking up the import
    // alias in the wrong AST would return a bogus result (e.g. the parent
    // module's alias).  Other operation types (VariableDeclaration, etc.)
    // derive their name from the operation data directly, so they're safe.
    if (isModuleOwned && item.type === 'ModuleInstance') return undefined
    return getOperationVariableName(item, ast, wasmInstance)
  }, [item, ast, wasmInstance, isModuleOwned])

  const errors = useMemo(() => {
    if (isStaleReference || isModuleOwned) {
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
  }, [diagnostics.length, isModuleOwned, isStaleReference])

  const selectOperation = useCallback(
    async (providedSourceRange?: SourceRange) => {
      if (isModuleOwned) {
        return
      }
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
    [
      isModuleOwned,
      sketchNoFace,
      onSelect,
      item,
      kclManager,
      useSketchSolveMode,
    ]
  )

  const viewOperationSource = useCallback(
    async (providedSourceRange?: SourceRange) => {
      if (item.type === 'GroupEnd') {
        return
      }

      const targetModuleId =
        item.type === 'ModuleInstance'
          ? item.moduleId
          : (providedSourceRange?.[2] ?? item.sourceRange[2])
      const targetModulePath = kclManager.execState.filenames[targetModuleId]

      const l = layout.signal.value
      if (!isCodePaneOpen(l)) {
        openCodePane(l, layout.set)
      }

      if (targetModulePath?.type === 'Local' && app.project) {
        const targetPath = targetModulePath.value
        if (app.project.executingPath !== targetPath) {
          kclManager.pendingFeatureTreeSourceSelection = {
            path: targetPath,
            range: providedSourceRange ?? item.sourceRange,
          }
          await navigate(`${PATHS.FILE}/${encodeURIComponent(targetPath)}`)
          return
        }
      }

      const moduleStartRange: SourceRange = [0, 0, targetModuleId]
      const targetRange =
        providedSourceRange ??
        (item.type === 'ModuleInstance' ? moduleStartRange : item.sourceRange)

      onSelect(targetRange)
    },
    [app, item, kclManager, layout, navigate, onSelect]
  )

  const enterEditFlow = useCallback(() => {
    if (isModuleOwned) {
      return
    }
    if (
      item.type === 'StdLibCall' ||
      item.type === 'VariableDeclaration' ||
      (item.type === 'GroupBegin' && item.group.type === 'SketchBlock')
    ) {
      const artifact =
        getArtifactFromRange(
          item.sourceRange,
          systemDeps.kclManager.artifactGraph
        ) ?? undefined
      if (
        item.type === 'GroupBegin' &&
        item.group.type === 'SketchBlock' &&
        artifact?.type === 'sketchBlock' &&
        artifact.id &&
        typeof artifact.sketchId === 'number'
      ) {
        // Allow double clicking on any sketch even with shift pressed
        modelingActor.send({
          type: 'Edit sketch solve',
          data: { artifactId: artifact.id },
        })
        return
      }

      prepareFeatureTreeEditCommand({
        operation: item,
        artifact,
        commandBarActor,
        selectOperation,
        systemDeps,
      }).catch((e) => {
        toast.error(err(e) ? e.message : JSON.stringify(e))
      })
    }
  }, [
    isModuleOwned,
    item,
    modelingActor,
    commandBarActor,
    selectOperation,
    systemDeps,
  ])

  function enterAppearanceFlow() {
    if (isModuleOwned) return
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
    if (isModuleOwned) return
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
    if (isModuleOwned) return
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
    if (isModuleOwned) return
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
    if (isModuleOwned) return
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
    if (isModuleOwned) {
      return
    }
    if (
      item.type === 'StdLibCall' ||
      item.type === 'GroupBegin' ||
      item.type === 'VariableDeclaration'
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
    if (isModuleOwned) {
      return
    }
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

  function canExportDxf(
    item: Operation
  ): item is Parameters<typeof exportSketchToDxf>[0] {
    return (
      (item.type === 'StdLibCall' &&
        (item.name === 'startSketchOn' || item.name === 'subtract2d')) ||
      (item.type === 'GroupBegin' && item.group.type === 'SketchBlock')
    )
  }

  function exportDxf() {
    if (!canExportDxf(item)) {
      return
    }
    exportSketchToDxf(item, {
      engineCommandManager,
      kclManager,
      toast,
      uuidv4,
      base64Decode,
      browserSaveFile,
    }).catch(reportRejection)
  }

  const menuItems = useMemo(
    () => {
      const viewSourceMenuItem = (
        <ContextMenuItem
          onClick={() => {
            if (item.type === 'GroupEnd') {
              return
            }
            void viewOperationSource().catch(reportRejection)
          }}
        >
          View KCL source code
        </ContextMenuItem>
      )

      if (isStaleReference) {
        return []
      }

      if (isModuleOwned) {
        return [viewSourceMenuItem]
      }

      return [
        viewSourceMenuItem,
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
                  viewOperationSource(functionRange).catch(reportRejection)
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
        ...(canExportDxf(item)
          ? [
              <ContextMenuItem
                onClick={exportDxf}
                data-testid="context-menu-export-dxf"
              >
                Export to DXF
              </ContextMenuItem>,
            ]
          : []),
        ...(item.type === 'StdLibCall' ||
        item.type === 'VariableDeclaration' ||
        (item.type === 'GroupBegin' && item.group.type === 'SketchBlock')
          ? [
              <ContextMenuItem
                disabled={
                  item.type !== 'VariableDeclaration' &&
                  item.type === 'StdLibCall' &&
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
        item.type === 'VariableDeclaration'
          ? [
              <ContextMenuItem
                onClick={deleteOperation}
                hotkey="Delete"
                data-testid="context-menu-delete"
              >
                Remove operation
              </ContextMenuItem>,
            ]
          : []),
      ]
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    [
      item,
      isModuleOwned,
      isStaleReference,
      layout.signal.value,
      viewOperationSource,
    ]
  )

  const enabled = (!sketchNoFace || isOffsetPlane(item)) && !isStaleReference

  const visibilityState = resolveFeatureTreeVisibility({
    item,
    operations: getAllOperations(kclManager.operationsByModule),
    artifactGraph: kclManager.artifactGraph,
  })

  return (
    <OperationItemWrapper
      icon={getOperationIcon(item)}
      name={name}
      type={item.type}
      variableName={variableName}
      valueDetail={valueDetail}
      customSuffix={
        item.type === 'ModuleInstance' && item.glob ? (
          <span className="text-chalkboard-60 dark:text-chalkboard-50 text-xs">
            *
          </span>
        ) : undefined
      }
      Tooltip={
        isModuleOwned ? undefined : (
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
        )
      }
      menuItems={menuItems}
      onClick={
        referenceModuleId != null
          ? (e) => {
              const container = (e.target as HTMLElement).closest(
                '[data-testid="debug-panel"]'
              )
              const branch = container?.querySelector(
                `[data-module-branch="${referenceModuleId}"]`
              ) as HTMLElement | null
              if (branch) {
                branch.scrollIntoView({ block: 'center', behavior: 'smooth' })
                // Brief highlight on the module heading row.
                const row = branch.querySelector<HTMLElement>(
                  '[data-testid="feature-tree-operation-item"]'
                )
                if (row) {
                  row.classList.add('bg-primary/25')
                  setTimeout(() => {
                    row.classList.remove('bg-primary/25')
                  }, 1500)
                }
              }
            }
          : isStaleReference || isModuleOwned
            ? undefined
            : () => {
                void selectOperation()
              }
      }
      onContextMenu={
        isStaleReference || isModuleOwned
          ? undefined
          : () => {
              void selectOperation()
            }
      }
      onDoubleClick={
        sketchNoFace || isStaleReference || isModuleOwned
          ? undefined
          : enterEditFlow
      } // no double click in "Sketch no face" mode
      isSelected={isSelected}
      errors={errors}
      disabled={!enabled && referenceModuleId == null}
      size={size}
      visibilityToggle={
        !isStaleReference &&
        !isModuleOwned &&
        visibilityState.canToggleVisibility
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

const DefaultPlanes = ({
  systemDeps,
  disabled = false,
}: {
  systemDeps: SystemDeps
  disabled?: boolean
}) => {
  const { rustContext, sceneInfra, kclManager } = systemDeps
  const { state: modelingState, send } = useModelingContext()
  const sketchNoFace = modelingState.matches('Sketch no face')
  const selectedDefaultPlaneId = getSelectedDefaultPlane(
    modelingState.context.selectionRanges
  )?.id

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
  if (!defaultPlanes) return null

  const planes = [
    {
      name: 'Front plane',
      id: defaultPlanes.xz,
      key: 'xz',
      customSuffix: (
        <div className="text-blue-500/50 font-bold text-xs">XZ</div>
      ),
    },
    {
      name: 'Top plane',
      id: defaultPlanes.xy,
      key: 'xy',
      customSuffix: <div className="text-red-500/50 font-bold text-xs">XY</div>,
    },
    {
      name: 'Side plane',
      id: defaultPlanes.yz,
      key: 'yz',
      customSuffix: (
        <div className="text-green-500/50 font-bold text-xs">YZ</div>
      ),
    },
  ] as const

  return (
    <div className="mb-2">
      {planes.map((plane) => (
        <OperationItemWrapper
          key={plane.key}
          customSuffix={plane.customSuffix}
          icon={'plane'}
          name={plane.name}
          disabled={disabled}
          isSelected={selectedDefaultPlaneId === plane.id}
          onClick={disabled ? undefined : () => onClickPlane(plane.id)}
          menuItems={
            disabled
              ? undefined
              : [
                  <ContextMenuItem
                    onClick={() => startSketchOnDefaultPlane(plane.id)}
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
                      planeId: plane.id,
                      planeKey: plane.key,
                    })
                  },
                }
          }
        />
      ))}
      <div className="h-px bg-chalkboard-50/20 my-2" />
    </div>
  )
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
