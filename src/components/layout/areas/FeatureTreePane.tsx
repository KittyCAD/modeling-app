import type { Diagnostic } from '@codemirror/lint'
import { useMachine, useSelector } from '@xstate/react'
import type { ComponentProps } from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { Actor, Prop } from 'xstate'

import type { OpKclValue, Operation } from '@rust/kcl-lib/bindings/Operation'

import { ContextMenu, ContextMenuItem } from '@src/components/ContextMenu'
import type { CustomIconName } from '@src/components/CustomIcon'
import { CustomIcon } from '@src/components/CustomIcon'
import Loading from '@src/components/Loading'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useKclContext } from '@src/lang/KclProvider'
import { findOperationPlaneArtifact, isOffsetPlane } from '@src/lang/queryAst'
import { sourceRangeFromRust } from '@src/lang/sourceRange'
import {
  codeRefFromRange,
  getArtifactFromRange,
} from '@src/lang/std/artifactGraph'
import {
  filterOperations,
  getOperationIcon,
  getOperationLabel,
  getOperationVariableName,
  stdLibMap,
} from '@src/lib/operations'
import { uuidv4 } from '@src/lib/utils'
import type { DefaultPlaneStr } from '@src/lib/planes'
import {
  selectDefaultSketchPlane,
  selectOffsetSketchPlane,
} from '@src/lib/selections'
import {
  codeManager,
  commandBarActor,
  editorManager,
  engineCommandManager,
  getLayout,
  kclManager,
  rustContext,
  sceneInfra,
  setLayout,
  useLayout,
} from '@src/lib/singletons'
import { err } from '@src/lib/trap'
import {
  featureTreeMachine,
  featureTreeMachineDefaultContext,
} from '@src/machines/featureTreeMachine'
import {
  editorIsMountedSelector,
  kclEditorActor,
  selectionEventSelector,
} from '@src/machines/kclEditorMachine'
import toast from 'react-hot-toast'
import { base64Decode } from '@src/lang/wasm'
import { browserSaveFile } from '@src/lib/browserSaveFile'
import { exportSketchToDxf } from '@src/lib/exportDxf'
import {
  type AreaTypeComponentProps,
  DefaultLayoutPaneID,
  getOpenPanes,
  togglePaneLayoutNode,
} from '@src/lib/layout'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { FeatureTreeMenu } from '@src/components/layout/areas/FeatureTreeMenu'
import Tooltip from '@src/components/Tooltip'

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
        onClose={props.onClose}
      />
      <FeatureTreePaneContents />
    </LayoutPanel>
  )
}

export const FeatureTreePaneContents = () => {
  const isEditorMounted = useSelector(kclEditorActor, editorIsMountedSelector)
  const lastSelectionEvent = useSelector(kclEditorActor, selectionEventSelector)
  const layout = useLayout()
  const { send: modelingSend, state: modelingState } = useModelingContext()

  const sketchNoFace = modelingState.matches('Sketch no face')

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_featureTreeState, featureTreeSend] = useMachine(
    featureTreeMachine.provide({
      guards: {
        codePaneIsOpen: () =>
          getOpenPanes({ rootLayout: getLayout() }).includes(
            DefaultLayoutPaneID.Code
          ) && editorManager.getEditorView() !== null,
      },
      actions: {
        openCodePane: () => {
          const rootLayout = structuredClone(getLayout())
          setLayout(
            togglePaneLayoutNode({
              rootLayout,
              targetNodeId: DefaultLayoutPaneID.Code,
              shouldExpand: true,
            })
          )
        },
        scrollToError: () => {
          editorManager.scrollToFirstErrorDiagnosticIfExists()
        },
        sendTranslateCommand: () => {
          commandBarActor.send({
            type: 'Find and select command',
            data: { name: 'Translate', groupId: 'modeling' },
          })
        },
        sendRotateCommand: () => {
          commandBarActor.send({
            type: 'Find and select command',
            data: { name: 'Rotate', groupId: 'modeling' },
          })
        },
        sendScaleCommand: () => {
          commandBarActor.send({
            type: 'Find and select command',
            data: { name: 'Scale', groupId: 'modeling' },
          })
        },
        sendCloneCommand: () => {
          commandBarActor.send({
            type: 'Find and select command',
            data: { name: 'Clone', groupId: 'modeling' },
          })
        },
        sendAppearanceCommand: () => {
          commandBarActor.send({
            type: 'Find and select command',
            data: { name: 'Appearance', groupId: 'modeling' },
          })
        },
        sendSelectionEvent: ({ context }) => {
          if (!context.targetSourceRange) {
            return
          }
          const artifact = context.targetSourceRange
            ? getArtifactFromRange(
                context.targetSourceRange,
                kclManager.artifactGraph
              )
            : null

          if (!artifact) {
            modelingSend({
              type: 'Set selection',
              data: {
                selectionType: 'singleCodeCursor',
                selection: {
                  codeRef: codeRefFromRange(
                    context.targetSourceRange,
                    kclManager.ast
                  ),
                },
                scrollIntoView: true,
              },
            })
          } else {
            modelingSend({
              type: 'Set selection',
              data: {
                selectionType: 'singleCodeCursor',
                selection: {
                  artifact: artifact,
                  codeRef: codeRefFromRange(
                    context.targetSourceRange,
                    kclManager.ast
                  ),
                },
                scrollIntoView: true,
              },
            })
          }
        },
      },
    }),
    {
      input: {
        ...featureTreeMachineDefaultContext,
      },
      // devTools: true,
    }
  )
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
      ? kclManager.execState.operations
      : longestErrorOperationList
    : kclManager.lastSuccessfulOperations
  // We use the code that corresponds to the operations. In case this is an
  // error on the first run, fall back to whatever is currently in the code
  // editor.
  const operationsCode = kclManager.lastSuccessfulCode || codeManager.code

  // We filter out operations that are not useful to show in the feature tree
  const operationList = filterOperations(unfilteredOperationList)

  // Watch for changes in the open panes and send an event to the feature tree machine
  useEffect(() => {
    const codeOpen = getOpenPanes({ rootLayout: layout }).includes(
      DefaultLayoutPaneID.Code
    )
    if (codeOpen && isEditorMounted) {
      featureTreeSend({ type: 'codePaneOpened' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [layout, isEditorMounted, featureTreeSend])

  // Watch for changes in the selection and send an event to the feature tree machine
  useEffect(() => {
    featureTreeSend({ type: 'selected' })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [lastSelectionEvent])

  function goToError() {
    featureTreeSend({ type: 'goToError' })
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
            {!modelingState.matches('Sketch') && <DefaultPlanes />}
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
            {operationList.map((operation) => {
              const key = `${operation.type}-${
                'name' in operation ? operation.name : 'anonymous'
              }-${
                'sourceRange' in operation ? operation.sourceRange[0] : 'start'
              }`

              return (
                <OperationItem
                  key={key}
                  item={operation}
                  code={operationsCode}
                  send={featureTreeSend}
                  sketchNoFace={sketchNoFace}
                />
              )
            })}
          </>
        )}
      </section>
    </div>
  )
}

interface VisibilityToggleProps {
  visible: boolean
  onVisibilityChange: () => unknown
}

/**
 * A button that toggles the visibility of an entity
 * tied to an artifact in the feature tree.
 * For now just used for default planes.
 */
const VisibilityToggle = (props: VisibilityToggleProps) => {
  const visible = props.visible
  const handleToggleVisible = useCallback(() => {
    props.onVisibilityChange()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [props.onVisibilityChange])

  return (
    <button
      onClick={handleToggleVisible}
      className="p-0 m-0 border-transparent dark:border-transparent"
      data-testid="feature-tree-visibility-toggle"
    >
      <CustomIcon
        name={visible ? 'eyeOpen' : 'eyeCrossedOut'}
        className="w-6 h-6"
      />
    </button>
  )
}

/**
 * More generic version of OperationListItem,
 * to be used for default planes after we fix them and
 * add them to the artifact graph / feature tree
 */
const OperationItemWrapper = ({
  icon,
  name,
  variableName,
  visibilityToggle,
  valueDetail,
  menuItems,
  errors,
  customSuffix,
  className,
  selectable = true,
  greyedOut = false,
  ...props
}: React.HTMLAttributes<HTMLButtonElement> & {
  icon: CustomIconName
  name: string
  variableName?: string
  visibilityToggle?: VisibilityToggleProps
  valueDetail?: { calculated: OpKclValue; display: string }
  customSuffix?: JSX.Element
  menuItems?: ComponentProps<typeof ContextMenu>['items']
  errors?: Diagnostic[]
  selectable?: boolean
  greyedOut?: boolean
}) => {
  const menuRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={menuRef}
      className={`flex select-none items-center group/item my-0 py-0.5 px-1 ${selectable ? 'focus-within:bg-primary/25 hover:bg-2 hover:focus-within:bg-primary/25' : ''} ${greyedOut ? 'opacity-50 cursor-not-allowed' : ''}`}
      data-testid="feature-tree-operation-item"
    >
      <button
        {...props}
        className={`reset !p-0 flex-1 flex items-center gap-2 text-left text-base !border-transparent ${className}`}
      >
        <span>
          <CustomIcon name={icon} className="w-6 h-6 block" aria-hidden />
          <Tooltip position="bottom-left" contentClassName="text-xs">
            {name}
          </Tooltip>
        </span>
        <div className="flex-1 flex flex-wrap items-baseline align-baseline">
          <div className="flex-1 inline-flex items-baseline flex-wrap gap-x-2">
            <span className="text-xs">{variableName || name}</span>
            {customSuffix && customSuffix}
          </div>
          {valueDetail && (
            <code
              data-testid="value-detail"
              className="text-right text-chalkboard-70 dark:text-chalkboard-40 text-xs"
            >
              {valueDetail.display}
            </code>
          )}
        </div>
      </button>
      {errors && errors.length > 0 && (
        <em className="text-destroy-80 text-xs">has error</em>
      )}
      {visibilityToggle && <VisibilityToggle {...visibilityToggle} />}
      {menuItems && (
        <ContextMenu menuTargetElement={menuRef} items={menuItems} />
      )}
    </div>
  )
}

/**
 * A button with an icon, name, and context menu
 * for an operation in the feature tree.
 */
const OperationItem = (props: {
  item: Operation
  code: string
  send: Prop<Actor<typeof featureTreeMachine>, 'send'>
  sketchNoFace: boolean
}) => {
  const kclContext = useKclContext()
  const name = getOperationLabel(props.item)
  const valueDetail = useMemo(
    () =>
      props.item.type === 'VariableDeclaration'
        ? {
            display: props.code.slice(
              props.item.sourceRange[0],
              props.item.sourceRange[1]
            ),
            calculated: props.item.value,
          }
        : undefined,
    [props.item, props.code]
  )

  const variableName = useMemo(() => {
    return getOperationVariableName(props.item, kclContext.ast)
  }, [props.item, kclContext.ast])

  const errors = useMemo(() => {
    return kclContext.diagnostics.filter(
      (diag) =>
        diag.severity === 'error' &&
        'sourceRange' in props.item &&
        diag.from >= props.item.sourceRange[0] &&
        diag.to <= props.item.sourceRange[1]
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [kclContext.diagnostics.length])

  async function selectOperation() {
    if (props.sketchNoFace) {
      if (isOffsetPlane(props.item)) {
        const artifact = findOperationPlaneArtifact(
          props.item,
          kclManager.artifactGraph
        )
        const result = await selectOffsetSketchPlane(artifact)
        if (err(result)) {
          console.error(result)
        }
      }
    } else {
      if (props.item.type === 'GroupEnd') {
        return
      }
      props.send({
        type: 'selectOperation',
        data: {
          targetSourceRange: sourceRangeFromRust(props.item.sourceRange),
        },
      })
    }
  }

  function enterEditFlow() {
    if (
      props.item.type === 'StdLibCall' ||
      props.item.type === 'VariableDeclaration'
    ) {
      props.send({
        type: 'enterEditFlow',
        data: {
          targetSourceRange: sourceRangeFromRust(props.item.sourceRange),
          currentOperation: props.item,
        },
      })
    }
  }

  function enterAppearanceFlow() {
    if (props.item.type === 'StdLibCall') {
      props.send({
        type: 'enterAppearanceFlow',
        data: {
          targetSourceRange: sourceRangeFromRust(props.item.sourceRange),
          currentOperation: props.item,
        },
      })
    }
  }

  function enterTranslateFlow() {
    if (props.item.type === 'StdLibCall' || props.item.type === 'GroupBegin') {
      props.send({
        type: 'enterTranslateFlow',
        data: {
          targetSourceRange: sourceRangeFromRust(props.item.sourceRange),
          currentOperation: props.item,
        },
      })
    }
  }

  function enterRotateFlow() {
    if (props.item.type === 'StdLibCall' || props.item.type === 'GroupBegin') {
      props.send({
        type: 'enterRotateFlow',
        data: {
          targetSourceRange: sourceRangeFromRust(props.item.sourceRange),
          currentOperation: props.item,
        },
      })
    }
  }

  function enterScaleFlow() {
    if (props.item.type === 'StdLibCall' || props.item.type === 'GroupBegin') {
      props.send({
        type: 'enterScaleFlow',
        data: {
          targetSourceRange: sourceRangeFromRust(props.item.sourceRange),
          currentOperation: props.item,
        },
      })
    }
  }

  function enterCloneFlow() {
    if (props.item.type === 'StdLibCall' || props.item.type === 'GroupBegin') {
      props.send({
        type: 'enterCloneFlow',
        data: {
          targetSourceRange: sourceRangeFromRust(props.item.sourceRange),
          currentOperation: props.item,
        },
      })
    }
  }

  function deleteOperation() {
    if (
      props.item.type === 'StdLibCall' ||
      props.item.type === 'GroupBegin' ||
      props.item.type === 'VariableDeclaration'
    ) {
      props.send({
        type: 'deleteOperation',
        data: {
          targetSourceRange: sourceRangeFromRust(props.item.sourceRange),
        },
      })
    }
  }

  function startSketchOnOffsetPlane() {
    if (isOffsetPlane(props.item)) {
      const artifact = findOperationPlaneArtifact(
        props.item,
        kclManager.artifactGraph
      )
      if (artifact?.id) {
        sceneInfra.modelingSend({
          type: 'Enter sketch',
          data: { forceNewSketch: true },
        })

        void selectOffsetSketchPlane(artifact)
      }
    }
  }

  const menuItems = useMemo(
    () => [
      <ContextMenuItem
        onClick={() => {
          if (props.item.type === 'GroupEnd') {
            return
          }
          props.send({
            type: 'goToKclSource',
            data: {
              targetSourceRange: sourceRangeFromRust(props.item.sourceRange),
            },
          })
        }}
      >
        View KCL source code
      </ContextMenuItem>,
      ...(props.item.type === 'GroupBegin' &&
      props.item.group.type === 'FunctionCall'
        ? [
            <ContextMenuItem
              onClick={() => {
                if (props.item.type !== 'GroupBegin') {
                  return
                }
                if (props.item.group.type !== 'FunctionCall') {
                  // TODO: Add module instance support.
                  return
                }
                const functionRange = props.item.group.functionSourceRange
                // For some reason, the cursor goes to the end of the source
                // range we select.  So set the end equal to the beginning.
                functionRange[1] = functionRange[0]
                props.send({
                  type: 'goToKclSource',
                  data: {
                    targetSourceRange: sourceRangeFromRust(functionRange),
                  },
                })
              }}
            >
              View function definition
            </ContextMenuItem>,
          ]
        : []),
      ...(isOffsetPlane(props.item)
        ? [
            <ContextMenuItem onClick={startSketchOnOffsetPlane}>
              Start Sketch
            </ContextMenuItem>,
          ]
        : []),
      ...(props.item.type === 'StdLibCall' &&
      props.item.name === 'startSketchOn'
        ? [
            <ContextMenuItem
              onClick={() => {
                const exportDxf = async () => {
                  if (props.item.type !== 'StdLibCall') return
                  const result = await exportSketchToDxf(props.item, {
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
      ...(props.item.type === 'StdLibCall' ||
      props.item.type === 'VariableDeclaration'
        ? [
            <ContextMenuItem
              disabled={
                !(
                  stdLibMap[props.item.name]?.prepareToEdit ||
                  props.item.type === 'VariableDeclaration'
                )
              }
              onClick={enterEditFlow}
              hotkey="Double click"
            >
              Edit
            </ContextMenuItem>,
          ]
        : []),
      ...(props.item.type === 'StdLibCall'
        ? [
            <ContextMenuItem
              disabled={!stdLibMap[props.item.name]?.supportsAppearance}
              onClick={enterAppearanceFlow}
              data-testid="context-menu-set-appearance"
            >
              Set appearance
            </ContextMenuItem>,
          ]
        : []),
      ...(props.item.type === 'StdLibCall' || props.item.type === 'GroupBegin'
        ? [
            <ContextMenuItem
              onClick={enterTranslateFlow}
              data-testid="context-menu-set-translate"
              disabled={
                props.item.type !== 'GroupBegin' &&
                !stdLibMap[props.item.name]?.supportsTransform
              }
            >
              Translate
            </ContextMenuItem>,
            <ContextMenuItem
              onClick={enterRotateFlow}
              data-testid="context-menu-set-rotate"
              disabled={
                props.item.type !== 'GroupBegin' &&
                !stdLibMap[props.item.name]?.supportsTransform
              }
            >
              Rotate
            </ContextMenuItem>,
            <ContextMenuItem
              onClick={enterScaleFlow}
              data-testid="context-menu-set-scale"
              disabled={
                props.item.type !== 'GroupBegin' &&
                !stdLibMap[props.item.name]?.supportsTransform
              }
            >
              Scale
            </ContextMenuItem>,
            <ContextMenuItem
              onClick={enterCloneFlow}
              data-testid="context-menu-clone"
              disabled={
                props.item.type !== 'GroupBegin' &&
                !stdLibMap[props.item.name]?.supportsTransform
              }
            >
              Clone
            </ContextMenuItem>,
          ]
        : []),
      ...(props.item.type === 'StdLibCall' ||
      props.item.type === 'GroupBegin' ||
      props.item.type === 'VariableDeclaration'
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
    [props.item, props.send]
  )

  const enabled = !props.sketchNoFace || isOffsetPlane(props.item)

  return (
    <OperationItemWrapper
      selectable={enabled}
      icon={getOperationIcon(props.item)}
      name={name}
      variableName={variableName}
      valueDetail={valueDetail}
      menuItems={menuItems}
      onClick={() => {
        void selectOperation()
      }}
      onDoubleClick={props.sketchNoFace ? undefined : enterEditFlow} // no double click in "Sketch no face" mode
      errors={errors}
      greyedOut={!enabled}
    />
  )
}

const DefaultPlanes = () => {
  const { state: modelingState, send } = useModelingContext()
  const sketchNoFace = modelingState.matches('Sketch no face')

  const onClickPlane = useCallback(
    (planeId: string) => {
      if (sketchNoFace) {
        selectDefaultSketchPlane(planeId)
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
    [sketchNoFace]
  )

  const startSketchOnDefaultPlane = useCallback((planeId: string) => {
    sceneInfra.modelingSend({
      type: 'Enter sketch',
      data: { forceNewSketch: true },
    })

    selectDefaultSketchPlane(planeId)
  }, [])

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
          selectable={true}
          onClick={() => onClickPlane(plane.id)}
          menuItems={[
            <ContextMenuItem
              onClick={() => startSketchOnDefaultPlane(plane.id)}
            >
              Start Sketch
            </ContextMenuItem>,
          ]}
          visibilityToggle={{
            visible: modelingState.context.defaultPlaneVisibility[plane.key],
            onVisibilityChange: () => {
              send({
                type: 'Toggle default plane visibility',
                planeId: plane.id,
                planeKey: plane.key,
              })
            },
          }}
        />
      ))}
      <div className="h-px bg-chalkboard-50/20 my-2" />
    </div>
  )
}
