import { getFeatureTreeValueDetail } from '@src/lib/featureTree/operationPresentation'
import { createContext, useContext, type ComponentType } from 'react'
import { featureTree } from '@src/lib/featureTree/registry/contract'
import type { Diagnostic } from '@codemirror/lint'
import type { Operation, OpKclValue } from '@rust/kcl-lib/bindings/Operation'
import type { PlaneName } from '@rust/kcl-lib/bindings/PlaneName'
import { type ContextMenu, ContextMenuItem } from '@src/components/ContextMenu'
import type { CustomIconName } from '@src/components/CustomIcon'
import { selectSketchPlane } from '@src/hooks/useEngineConnectionSubscriptions'
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
  base64Decode,
  getAllOperations,
  type SourceRange,
} from '@src/lang/wasm'
import type { useSingletons } from '@src/lib/boot'
import { useApp } from '@src/lib/boot'
import { LEGACY_SKETCH_MODE_REMOVED_MESSAGE } from '@src/lib/constants'
import {
  findSameVisibleStdLibOperationAfterSourceChange,
  getOperationKey,
} from '@src/lib/featureTree/featureTreeOperationTree'
import {
  getOperationCalculatedDisplay,
  getOperationIcon,
  getOperationLabel,
  getOperationVariableName,
  onHide,
  onUnhide,
  stdLibMap,
} from '@src/lib/operations'
import { defaultPlaneNameToKcl } from '@src/lib/planes'
import { err, isErr, reportRejection } from '@src/lib/trap'
import { isArray, isOverlap, uuidv4 } from '@src/lib/utils'
import type { ComponentProps, ReactNode } from 'react'
import { memo, use, useCallback, useMemo } from 'react'
import toast from 'react-hot-toast'
export { getFeatureTreeValueDetail } from '@src/lib/featureTree/operationPresentation'

export { buildOperationTree } from '@src/lib/featureTree/featureTreeOperationTree'

import { useSignals } from '@preact/signals-react/runtime'
import type { SceneEntities } from '@src/clientSideScene/sceneEntities'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { RowItemWithIconMenuAndToggle } from '@src/components/RowItemWithIconMenuAndToggle'
import Tooltip from '@src/components/Tooltip'
import { VisibilityToggle } from '@src/components/VisibilityToggle'
import { sourceRangeToUtf16, toUtf16 } from '@src/lang/errors'
import { browserSaveFile } from '@src/lib/browserSaveFile'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { exportSketchToDxf } from '@src/lib/exportDxf'
import {
  prepareEditCommand,
  resolveFeatureTreeVisibility,
  sendDeleteCommand,
} from '@src/lib/featureTree'
import { DefaultLayoutPaneID } from '@src/lib/layout'
import { PATHS } from '@src/lib/paths'
import type RustContext from '@src/lib/rustContext'
import type { CommandBarActorType } from '@src/machines/commandBarMachine'
// eslint-disable-next-line zds/no-react-router-hooks -- URL-state migration: feature-tree file opening (useNavigate).
import { useNavigate } from 'react-router-dom'

type Singletons = ReturnType<typeof useSingletons>

type StdLibCallOperation = Extract<Operation, { type: 'StdLibCall' }>

export type SystemDeps = Pick<Singletons, 'kclManager'> & {
  commandBarActor: CommandBarActorType
  sceneInfra: SceneInfra
  sceneEntitiesManager: SceneEntities
  rustContext: RustContext
}

// IMPORTANT: Edit after auto-fix is only correct if auto-fix doesn't change the
// operations. The migration can change the KCL, and we need to choose the
// correct operation to edit.
// `findSameVisibleStdLibOperationAfterSourceChange()` uses a heuristic, but it
// may fail since operations don't have an identity that persists across
// executions. Currently, we don't change the operations in an auto-fix, but
// this seems brittle.
const Z0006_AUTO_FIX_BEFORE_EDIT_OPERATION_NAMES = new Set([
  'fillet',
  'chamfer',
  'extrude',
  'revolve',
  'helix',
  // 'mirror3d', add in when edit from feature tree is supported
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

interface VisibilityToggleProps {
  visible: boolean
  onVisibilityChange: () => unknown
}

type OpValueProps = {
  name: string
  type?: Operation['type']
  variableName?: string
  valueDetail?: { calculated: OpKclValue; display: string }
  /** A named view is described by the name it declares, not by its variable. */
  isNamedView?: boolean
}

/**
 * More generic version of OperationListItem,
 * to be used for default planes after we fix them and
 * add them to the artifact graph / feature tree
 */
export type OperationRowProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'type' | 'onClick' | 'onDoubleClick' | 'onContextMenu'
> & {
  onClick?: (event: Event) => void
  onDoubleClick?: (event: Event) => void
  nodeId?: string
  icon: CustomIconName
  visibilityToggle?: VisibilityToggleProps
  customSuffix?: React.JSX.Element
  menuItems?: ComponentProps<typeof ContextMenu>['items']
  errors?: Diagnostic[]
  onContextMenu?: (e: MouseEvent) => void
  Tooltip?: ReactNode
  isSelected?: boolean
  size?: 'default' | 'sm'
} & OpValueProps

/** Both trees share row behavior and supply only their own presentation. */
export const OperationRowRenderer = createContext<
  ComponentType<OperationRowProps> | undefined
>(undefined)

export const OperationItemWrapper = memo(
  ({
    nodeId,
    icon,
    name,
    type,
    variableName,
    visibilityToggle,
    valueDetail,
    isNamedView,
    menuItems,
    errors,
    customSuffix,
    className,
    Tooltip,
    size = 'default',
    ...props
  }: OperationRowProps) => {
    const Renderer = useContext(OperationRowRenderer)
    if (Renderer)
      return (
        <Renderer
          nodeId={nodeId}
          icon={icon}
          name={name}
          type={type}
          variableName={variableName}
          visibilityToggle={visibilityToggle}
          valueDetail={valueDetail}
          isNamedView={isNamedView}
          menuItems={menuItems}
          errors={errors}
          customSuffix={customSuffix}
          className={className}
          Tooltip={Tooltip}
          size={size}
          {...props}
        />
      )
    return (
      <RowItemWithIconMenuAndToggle
        {...props}
        onClick={
          props.onClick
            ? (event) => props.onClick?.(event.nativeEvent)
            : undefined
        }
        onContextMenu={
          props.onContextMenu
            ? (event) =>
                props.onContextMenu?.(
                  event instanceof MouseEvent ? event : event.nativeEvent
                )
            : undefined
        }
        onDoubleClick={
          props.onDoubleClick
            ? (event) => props.onDoubleClick?.(event.nativeEvent)
            : undefined
        }
        icon={icon}
        size={size}
        LabelSecondary={
          <>
            {valueDetail ? (
              <>
                {variableName ? (
                  <span className="text-sm">{variableName}</span>
                ) : null}
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

export function namedViewTooltipText({
  name,
  valueDetail,
  variableName,
}: {
  name: string
  valueDetail: { calculated: OpKclValue; display: string }
  variableName?: string
}): string {
  const viewName = getOperationCalculatedDisplay(valueDetail.calculated)
  const declaration = variableName ? `, declared as ${variableName}` : ''

  return `${name} "${viewName}"${declaration}`
}

export function VariableTooltipContents({
  variableName,
  valueDetail,
  name,
  type,
  isNamedView,
}: OpValueProps) {
  if (isNamedView && valueDetail) {
    return <>{namedViewTooltipText({ name, valueDetail, variableName })}</>
  }

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

export interface OperationProps {
  nodeId?: string
  item: Operation
  code: string
  isStaleReference?: boolean
  sketchNoFace: boolean
  systemDeps: SystemDeps
  engineCommandManager: ConnectionManager
  modelingActor: ReturnType<typeof useModelingContext>['actor']
  onSelect: (sourceRange: SourceRange) => void
  visibilityOperations: Operation[]
  size?: 'default' | 'sm'
  isModuleOwned?: boolean
  /** During live execution, the module that received the latest operation. */
  liveActiveModuleId?: number | null
  /** During live execution, the operation that was most recently added. */
  liveLatestOperationKey: string | null
  /** When set, this item is a deduplicated module reference; clicking scrolls to the expanded branch. */
  referenceModuleId?: number
}

export function getFeatureTreeSketchSelectionContext({
  modelingActor,
}: Pick<OperationProps, 'modelingActor'>) {
  const modelingSnapshot = modelingActor.getSnapshot()
  return {
    sketchNoFace: modelingSnapshot.matches('Sketch no face'),
  }
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
export const OperationItem = ({
  nodeId,
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
  visibilityOperations,
  liveLatestOperationKey,
}: OperationProps) => {
  useSignals()
  const app = useApp()
  const navigate = useNavigate()
  const { layout } = app
  const { kclManager, commandBarActor } = systemDeps
  const diagnostics = kclManager.diagnosticsSignal.value
  const liveAst = kclManager.astSignal.value
  const ast = kclManager.hasParseErrors() ? kclManager.lastGoodAst : liveAst
  const wasmInstance = use(kclManager.wasmInstancePromise)
  const name = getOperationLabel(item)
  const sourceRange =
    'sourceRange' in item &&
    sourceRangeToUtf16(sourceRangeFromRust(item.sourceRange), kclManager.code)
  const isLiveLatest = liveLatestOperationKey === getOperationKey(item)
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

  const isNamedView = item.type === 'StdLibCall' && item.name === 'view::named'

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
      const sketchSelectionContext = getFeatureTreeSketchSelectionContext({
        modelingActor,
      })
      if (sketchSelectionContext.sketchNoFace) {
        if (isOffsetPlane(item)) {
          const artifact = findOperationPlaneArtifact(
            item,
            kclManager.artifactGraph
          )
          void selectSketchPlane(artifact?.id, kclManager)
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
    [isModuleOwned, modelingActor, onSelect, item, kclManager]
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

      layout.openPane(DefaultLayoutPaneID.Code)

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
        const message = err(e) ? e.message : JSON.stringify(e)
        toast.error(message, {
          duration:
            message === LEGACY_SKETCH_MODE_REMOVED_MESSAGE ? 5_000 : undefined,
        })
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

        void selectSketchPlane(artifact.id, kclManager)
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
      fileOperations: app.fileOperations,
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
                  !stdLibMap[item.name]?.supportsTransform &&
                  !stdLibMap[item.name]?.supportsTranslate
                }
              >
                Translate
              </ContextMenuItem>,
              <ContextMenuItem
                onClick={enterRotateFlow}
                data-testid="context-menu-set-rotate"
                disabled={
                  item.type !== 'GroupBegin' &&
                  !stdLibMap[item.name]?.supportsTransform &&
                  !stdLibMap[item.name]?.supportsRotate
                }
              >
                Rotate
              </ContextMenuItem>,
              <ContextMenuItem
                onClick={enterScaleFlow}
                data-testid="context-menu-set-scale"
                disabled={
                  item.type !== 'GroupBegin' &&
                  !stdLibMap[item.name]?.supportsTransform &&
                  !stdLibMap[item.name]?.supportsScale
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
    operations: visibilityOperations,
    artifactGraph: kclManager.artifactGraph,
  })

  return (
    <OperationItemWrapper
      nodeId={nodeId}
      icon={getOperationIcon(item)}
      name={name}
      type={item.type}
      variableName={variableName}
      valueDetail={valueDetail}
      isNamedView={isNamedView}
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
              isNamedView={isNamedView}
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
                const row = branch.matches(
                  '[data-testid="feature-tree-operation-item"]'
                )
                  ? branch
                  : branch.querySelector<HTMLElement>(
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

export const DefaultPlanes = ({
  flat = false,
  systemDeps,
  disabled = false,
}: {
  flat?: boolean
  systemDeps: SystemDeps
  disabled?: boolean
}) => {
  const { rustContext, sceneInfra, kclManager } = systemDeps
  const { registry } = useApp()
  const { state: modelingState, send } = useModelingContext()
  const sketchNoFace = modelingState.matches('Sketch no face')
  const selectedDefaultPlaneId =
    modelingState.context.selectionRanges.otherSelections.find(
      (selection) =>
        typeof selection === 'object' &&
        'id' in selection &&
        'name' in selection
    )?.id

  const onClickPlane = useCallback(
    (planeId: string) => {
      if (sketchNoFace) {
        void selectSketchPlane(planeId, kclManager)
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
                name: defaultPlaneNameToKcl(foundDefaultPlane[0] as PlaneName),
                id: planeId,
              },
            },
          })
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    [sketchNoFace]
  )

  const startSketchOnDefaultPlane = useCallback(
    (planeId: string) => {
      sceneInfra.modelingSend({
        type: 'Enter sketch',
        data: { forceNewSketch: true },
      })

      void selectSketchPlane(planeId, kclManager)
    },
    [sceneInfra, kclManager]
  )

  const planes = registry.get(featureTree).model.value.planes.map((plane) => ({
    ...plane,
    id: plane.planeId,
    name: plane.label,
    customSuffix: (
      <div
        className={`${plane.key === 'xz' ? 'text-blue-500/50' : plane.key === 'xy' ? 'text-red-500/50' : 'text-green-500/50'} font-bold text-xs`}
      >
        {plane.key.toUpperCase()}
      </div>
    ),
  }))

  if (!planes.length) return null

  const content = (
    <>
      {planes.map((plane) => (
        <OperationItemWrapper
          key={plane.key}
          nodeId={`plane:${plane.key}`}
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
      {!flat && <div className="h-px bg-chalkboard-50/20 my-2" />}
    </>
  )
  return flat ? content : <div className="mb-2">{content}</div>
}
