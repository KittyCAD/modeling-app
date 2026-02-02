import type { Diagnostic } from '@codemirror/lint'
import type { ComponentProps, ReactNode } from 'react'
import { use, useCallback, useMemo, memo } from 'react'
import type { OpKclValue, Operation } from '@rust/kcl-lib/bindings/Operation'
import { type ContextMenu, ContextMenuItem } from '@src/components/ContextMenu'
import type { CustomIconName } from '@src/components/CustomIcon'
import { CustomIcon } from '@src/components/CustomIcon'
import Loading from '@src/components/Loading'
import { useModelingContext } from '@src/hooks/useModelingContext'
import {
  findOperationArtifact,
  findOperationPlaneArtifact,
  isOffsetPlane,
} from '@src/lang/queryAst'
import { sourceRangeFromRust } from '@src/lang/sourceRange'
import { getArtifactFromRange } from '@src/lang/std/artifactGraph'
import {
  filterOperations,
  getHideOpByArtifactId,
  getOperationCalculatedDisplay,
  getOperationIcon,
  getOperationLabel,
  getOperationVariableName,
  getOpTypeLabel,
  onHide,
  groupOperationTypeStreaks,
  stdLibMap,
} from '@src/lib/operations'
import { stripQuotes } from '@src/lib/utils'
import { isArray, uuidv4 } from '@src/lib/utils'
import type { DefaultPlaneStr } from '@src/lib/planes'
import { selectOffsetSketchPlane } from '@src/lib/selections'
import { selectSketchPlane } from '@src/hooks/useEngineConnectionSubscriptions'
import { useSingletons } from '@src/lib/boot'
import { err, reportRejection } from '@src/lib/trap'
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
import { toUtf16 } from '@src/lang/errors'
import {
  prepareEditCommand,
  sendDeleteCommand,
  sendSelectionEvent,
} from '@src/lib/featureTree'
import type { VisibilityToggleProps } from '@src/components/VisibilityToggle'
import { VisibilityToggle } from '@src/components/VisibilityToggle'
import { RowItemWithIconMenuAndToggle } from '@src/components/RowItemWithIconMenuAndToggle'

type Singletons = ReturnType<typeof useSingletons>
type SystemDeps = Pick<
  Singletons,
  | 'kclManager'
  | 'sceneInfra'
  | 'sceneEntitiesManager'
  | 'rustContext'
  | 'commandBarActor'
>

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
          // it doesn't know how to handle Splits as childs of Panes very well,
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
  const {
    commandBarActor,
    engineCommandManager,
    getLayout,
    kclManager,
    rustContext,
    sceneEntitiesManager,
    sceneInfra,
    setLayout,
  } = useSingletons()
  const {
    send: modelingSend,
    state: modelingState,
    actor: modelingActor,
  } = useModelingContext()
  const systemDeps: SystemDeps = {
    kclManager,
    sceneInfra,
    sceneEntitiesManager,
    rustContext,
    commandBarActor,
  }

  const selectOperation = useCallback(
    (sourceRange: SourceRange) => {
      sendSelectionEvent({
        sourceRange,
        kclManager,
        modelingSend,
      })
    },
    [modelingSend, kclManager]
  )

  const sketchNoFace = modelingState.matches('Sketch no face')

  // If there are parse errors we show the last successful operations
  // and overlay a message on top of the pane
  const parseErrors = kclManager.errors.filter((e) => e.kind !== 'engine')

  // If there are engine errors we show the successful operations
  // Errors return an operation list, so use the longest one if there are multiple
  const longestErrorOperationList = kclManager.errors.reduce((acc, error) => {
    return error.operations && error.operations.length > acc.length
      ? error.operations
      : acc
  }, [] as Operation[])

  const unfilteredOperationList = !parseErrors.length
    ? !kclManager.errors.length
      ? kclManager.execState?.operations
      : longestErrorOperationList
    : kclManager.lastSuccessfulOperations
  // We use the code that corresponds to the operations. In case this is an
  // error on the first run, fall back to whatever is currently in the code
  // editor.
  const operationsCode =
    kclManager.lastSuccessfulCode || kclManager.codeSignal.value

  // We filter out operations that are not useful to show in the feature tree
  const operationList = groupOperationTypeStreaks(
    filterOperations(unfilteredOperationList),
    ['VariableDeclaration']
  )

  function goToError() {
    const l = getLayout()
    if (!isCodePaneOpen(l)) {
      openCodePane(l, setLayout)
    }
    kclManager.scrollToFirstErrorDiagnosticIfExists()
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
              <DefaultPlanes systemDeps={systemDeps} />
            )}
            {parseErrors.length > 0 && (
              <div
                className={`absolute inset-0 rounded-lg p-2 ${
                  operationList.length &&
                  `bg-destroy-10/40 dark:bg-destroy-80/40`
                }`}
              >
                <div className="text-sm bg-destroy-80 text-chalkboard-10 py-1 px-2 rounded flex gap-2 items-center">
                  <p className="flex-1">
                    Errors found in KCL code.
                    <br />
                    Please fix them before continuing.
                  </p>
                  <button
                    onClick={goToError}
                    className="bg-chalkboard-10 text-destroy-80 p-1 rounded-sm flex-none hover:bg-chalkboard-10 hover:border-destroy-70 hover:text-destroy-80 border-transparent"
                  >
                    View error
                  </button>
                </div>
              </div>
            )}
            {operationList.map((opOrList) => {
              const key = `${isArray(opOrList) ? opOrList[0].type : opOrList.type}-${
                'name' in opOrList ? opOrList.name : 'anonymous'
              }-${
                'sourceRange' in opOrList ? opOrList.sourceRange[0] : 'start'
              }`

              return isArray(opOrList) ? (
                <OperationItemGroup
                  key={key}
                  items={opOrList}
                  code={operationsCode}
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
                  sketchNoFace={sketchNoFace}
                  systemDeps={systemDeps}
                  modelingActor={modelingActor}
                  engineCommandManager={engineCommandManager}
                  onSelect={selectOperation}
                />
              )
            })}
          </>
        )}
      </section>
    </div>
  )
})

/**
 * A grouping of operation items into a disclosure (or dropdown)
 */
function OperationItemGroup({
  items,
  code,
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
                sketchNoFace={sketchNoFace}
                systemDeps={systemDeps}
                modelingActor={modelingActor}
                engineCommandManager={engineCommandManager}
                onSelect={onSelect}
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
  } & OpValueProps) => {
    return (
      <RowItemWithIconMenuAndToggle
        {...props}
        icon={icon}
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
  sketchNoFace: boolean
  systemDeps: SystemDeps
  engineCommandManager: Singletons['engineCommandManager']
  modelingActor: ReturnType<typeof useModelingContext>['actor']
  onSelect: (sourceRange: SourceRange) => void
}
/**
 * A button with an icon, name, and context menu
 * for an operation in the feature tree.
 */
const OperationItem = ({
  item,
  code,
  sketchNoFace,
  onSelect,
  systemDeps,
  modelingActor,
  engineCommandManager,
}: OperationProps) => {
  const { getLayout, setLayout } = useSingletons()
  const { kclManager, sceneInfra, commandBarActor } = systemDeps
  const diagnostics = kclManager.diagnosticsSignal.value
  const ast = kclManager.astSignal.value
  const wasmInstance = use(kclManager.wasmInstancePromise)
  const name = getOperationLabel(item)
  const sourceRange =
    'sourceRange' in item && sourceRangeFromRust(item.sourceRange)
  const isSelected = useMemo(() => {
    const selected =
      sourceRange &&
      kclManager.editorState.selection.main.from >= sourceRange[0] &&
      kclManager.editorState.selection.main.to <= sourceRange[1]
    return selected
  }, [kclManager.editorState.selection, sourceRange])
  const valueDetail = useMemo(() => {
    return getFeatureTreeValueDetail(item, code)
  }, [item, code])

  const variableName = useMemo(() => {
    return getOperationVariableName(item, ast, wasmInstance)
  }, [item, ast, wasmInstance])

  const errors = useMemo(() => {
    return diagnostics.filter(
      (diag) =>
        diag.severity === 'error' &&
        'sourceRange' in item &&
        diag.from >= toUtf16(item.sourceRange[0], code) &&
        diag.to <= toUtf16(item.sourceRange[1], code)
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [diagnostics.length])

  const selectOperation = useCallback(
    async (providedSourceRange?: SourceRange) => {
      if (sketchNoFace) {
        if (isOffsetPlane(item)) {
          const artifact = findOperationPlaneArtifact(
            item,
            kclManager.artifactGraph
          )
          const result = await selectOffsetSketchPlane(artifact, systemDeps)
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
    [sketchNoFace, onSelect, item, kclManager.artifactGraph, systemDeps]
  )

  const enterEditFlow = useCallback(() => {
    if (
      item.type === 'StdLibCall' ||
      item.type === 'VariableDeclaration' ||
      item.type === 'SketchSolve'
    ) {
      const artifact =
        getArtifactFromRange(
          item.sourceRange,
          systemDeps.kclManager.artifactGraph
        ) ?? undefined
      prepareEditCommand({
        artifactGraph: systemDeps.kclManager.artifactGraph,
        code: systemDeps.kclManager.code,
        commandBarActor,
        operation: item,
        rustContext: systemDeps.rustContext,
        artifact,
      }).catch((e) => toast.error(err(e) ? e.message : JSON.stringify(e)))
    }
  }, [
    item,
    commandBarActor,
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
        toast.error(e)
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
        sceneInfra.modelingSend({
          type: 'Enter sketch',
          data: { forceNewSketch: true },
        })

        void selectOffsetSketchPlane(artifact, systemDeps)
      }
    }
  }

  const menuItems = useMemo(
    () => [
      <ContextMenuItem
        onClick={() => {
          if (item.type === 'GroupEnd') {
            return
          }
          const l = getLayout()
          if (!isCodePaneOpen(l)) {
            openCodePane(l, setLayout)
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
                const l = getLayout()
                if (!isCodePaneOpen(l)) {
                  openCodePane(l, setLayout)
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
                  const result = await exportSketchToDxf(item, {
                    engineCommandManager,
                    kclManager,
                    toast,
                    uuidv4,
                    base64Decode,
                    browserSaveFile,
                  })

                  if (err(result)) {
                    // Additional error logging for debugging purposes
                    // Main error handling (toasts) is already done in exportSketchToDxf
                    console.error('DXF export failed:', result.message)
                  } else {
                    console.log('DXF export completed successfully')
                  }
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
    [item]
  )

  const enabled = !sketchNoFace || isOffsetPlane(item)

  const operationArtifact =
    item.type === 'StdLibCall' && kclManager.execState?.artifactGraph
      ? findOperationArtifact(item, kclManager.execState.artifactGraph)
      : undefined
  const hideOperation = operationArtifact
    ? getHideOpByArtifactId(
        kclManager.execState?.operations ?? [],
        operationArtifact.id
      )
    : undefined

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
      onClick={() => {
        console.log('FRANK CLICK')
        void selectOperation()
      }}
      onContextMenu={() => {
        void selectOperation()
      }}
      onDoubleClick={sketchNoFace ? undefined : enterEditFlow} // no double click in "Sketch no face" mode
      isSelected={isSelected}
      errors={errors}
      disabled={!enabled}
      visibilityToggle={
        item.type === 'StdLibCall' && item.name === 'helix'
          ? {
              visible: hideOperation === undefined,
              onVisibilityChange: () => {
                selectOperation()
                  .then(() => {
                    onHide({
                      ast: kclManager.ast,
                      artifactGraph: kclManager.artifactGraph,
                      modelingActor,
                    })
                  })
                  .catch(reportRejection)
              },
            }
          : undefined
      }
    />
  )
}

const DefaultPlanes = ({ systemDeps }: { systemDeps: SystemDeps }) => {
  const { rustContext, sceneInfra } = systemDeps
  const { state: modelingState, send } = useModelingContext()
  const sketchNoFace = modelingState.matches('Sketch no face')

  const onClickPlane = useCallback(
    (planeId: string) => {
      if (sketchNoFace) {
        void selectSketchPlane(
          planeId,
          modelingState.context.store.useNewSketchMode?.current,
          systemDeps
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
    [sketchNoFace, modelingState.context.store.useNewSketchMode]
  )

  const startSketchOnDefaultPlane = useCallback(
    (planeId: string) => {
      sceneInfra.modelingSend({
        type: 'Enter sketch',
        data: { forceNewSketch: true },
      })

      void selectSketchPlane(
        planeId,
        modelingState.context.store.useNewSketchMode?.current,
        systemDeps
      )
    },
    [modelingState.context.store.useNewSketchMode, sceneInfra, systemDeps]
  )

  const visibilityToggle = useCallback(
    (plane: (typeof planes)[number]) => ({
      visible: modelingState.context.defaultPlaneVisibility[plane.key],
      onVisibilityChange: () => {
        send({
          type: 'Toggle default plane visibility',
          planeId: plane.id,
          planeKey: plane.key,
        })
      },
    }),
    [modelingState.context.defaultPlaneVisibility, send]
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
          onClick={() => onClickPlane(plane.id)}
          menuItems={[
            <ContextMenuItem
              onClick={() => startSketchOnDefaultPlane(plane.id)}
            >
              Start Sketch
            </ContextMenuItem>,
          ]}
          visibilityToggle={visibilityToggle(plane)}
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
