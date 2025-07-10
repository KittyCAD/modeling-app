import type { Diagnostic } from '@codemirror/lint'
import { useMachine, useSelector } from '@xstate/react'
import type { ComponentProps } from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { Actor, Prop } from 'xstate'

import type { Operation, OpKclValue } from '@rust/kcl-lib/bindings/Operation'

import { ContextMenu, ContextMenuItem } from '@src/components/ContextMenu'
import type { CustomIconName } from '@src/components/CustomIcon'
import { CustomIcon } from '@src/components/CustomIcon'
import Loading from '@src/components/Loading'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useKclContext } from '@src/lang/KclProvider'
import {
  codeRefFromRange,
  getArtifactFromRange,
} from '@src/lang/std/artifactGraph'
import { sourceRangeFromRust } from '@src/lang/sourceRange'
import {
  filterOperations,
  getOperationIcon,
  getOperationLabel,
  getOperationVariableName,
  stdLibMap,
} from '@src/lib/operations'
import {
  editorManager,
  kclManager,
  rustContext,
  sceneInfra,
} from '@src/lib/singletons'
import {
  featureTreeMachine,
  featureTreeMachineDefaultContext,
} from '@src/machines/featureTreeMachine'
import {
  editorIsMountedSelector,
  kclEditorActor,
  selectionEventSelector,
} from '@src/machines/kclEditorMachine'
import type { Plane } from '@rust/kcl-lib/bindings/Artifact'
import {
  selectDefaultSketchPlane,
  selectOffsetSketchPlane,
} from '@src/lib/selections'
import type { DefaultPlaneStr } from '@src/lib/planes'

export const FeatureTreePane = () => {
  const isEditorMounted = useSelector(kclEditorActor, editorIsMountedSelector)
  const lastSelectionEvent = useSelector(kclEditorActor, selectionEventSelector)
  const { send: modelingSend, state: modelingState } = useModelingContext()

  const sketchNoFace = modelingState.matches('Sketch no face')

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_featureTreeState, featureTreeSend] = useMachine(
    featureTreeMachine.provide({
      guards: {
        codePaneIsOpen: () =>
          modelingState.context.store.openPanes.includes('code') &&
          editorManager.getEditorView() !== null,
      },
      actions: {
        openCodePane: () => {
          modelingSend({
            type: 'Set context',
            data: {
              openPanes: [...modelingState.context.store.openPanes, 'code'],
            },
          })
        },
        scrollToError: () => {
          editorManager.scrollToFirstErrorDiagnosticIfExists()
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

  // We filter out operations that are not useful to show in the feature tree
  const operationList = filterOperations(unfilteredOperationList)

  // Watch for changes in the open panes and send an event to the feature tree machine
  useEffect(() => {
    const codeOpen = modelingState.context.store.openPanes.includes('code')
    if (codeOpen && isEditorMounted) {
      featureTreeSend({ type: 'codePaneOpened' })
    }
  }, [modelingState.context.store.openPanes, isEditorMounted])

  // Watch for changes in the selection and send an event to the feature tree machine
  useEffect(() => {
    featureTreeSend({ type: 'selected' })
  }, [lastSelectionEvent])

  function goToError() {
    featureTreeSend({ type: 'goToError' })
  }

  return (
    <div className="relative">
      <section
        data-testid="debug-panel"
        className="absolute inset-0 p-1 box-border overflow-auto"
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
  }, [props.onVisibilityChange])

  return (
    <button
      onClick={handleToggleVisible}
      className="p-0 m-0"
      data-testid="feature-tree-visibility-toggle"
    >
      <CustomIcon
        name={visible ? 'eyeOpen' : 'eyeCrossedOut'}
        className="w-5 h-5"
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
      className={`flex select-none items-center group/item my-0 py-0.5 px-1 ${selectable ? 'focus-within:bg-primary/10 hover:bg-primary/5' : ''} ${greyedOut ? 'opacity-50 cursor-not-allowed' : ''}`}
      data-testid="feature-tree-operation-item"
    >
      <button
        {...props}
        className={`reset !py-0.5 !px-1 flex-1 flex items-center gap-2 text-left text-base ${selectable ? 'border-transparent dark:border-transparent' : '!border-transparent cursor-default'} ${className}`}
      >
        <CustomIcon name={icon} className="w-5 h-5 block" />
        <div className="flex flex-1 items-baseline align-baseline">
          <div className="flex-1 inline-flex items-baseline flex-wrap gap-x-2">
            {name}
            {variableName && (
              <span className="text-chalkboard-70 dark:text-chalkboard-40 text-xs">
                {variableName}
              </span>
            )}
            {customSuffix && customSuffix}
          </div>
          {valueDetail && (
            <code className="px-1 text-right text-chalkboard-70 dark:text-chalkboard-40 text-xs">
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
  send: Prop<Actor<typeof featureTreeMachine>, 'send'>
  sketchNoFace: boolean
}) => {
  const kclContext = useKclContext()
  const name = getOperationLabel(props.item)
  const valueDetail = useMemo(
    () =>
      props.item.type === 'VariableDeclaration'
        ? {
            display: kclContext.code.slice(
              props.item.sourceRange[0],
              props.item.sourceRange[1]
            ),
            calculated: props.item.value,
          }
        : undefined,
    [props.item, kclContext.code]
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
  }, [kclContext.diagnostics.length])

  function selectOperation() {
    if (props.sketchNoFace) {
      if (isOffsetPlane(props.item)) {
        const artifact = findOperationArtifact(props.item)
        void selectOffsetSketchPlane(artifact)
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

  /**
   * For now we can only enter the "edit" flow for the startSketchOn operation.
   * TODO: https://github.com/KittyCAD/modeling-app/issues/4442
   */
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
    if (props.item.type === 'StdLibCall' || props.item.type === 'GroupBegin') {
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
      const artifact = findOperationArtifact(props.item)
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
              Set translate
            </ContextMenuItem>,
            <ContextMenuItem
              onClick={enterRotateFlow}
              data-testid="context-menu-set-rotate"
              disabled={
                props.item.type !== 'GroupBegin' &&
                !stdLibMap[props.item.name]?.supportsTransform
              }
            >
              Set rotate
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
      onClick={selectOperation}
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

type StdLibCallOp = Extract<Operation, { type: 'StdLibCall' }>

const isOffsetPlane = (item: Operation): item is StdLibCallOp => {
  return item.type === 'StdLibCall' && item.name === 'offsetPlane'
}

const findOperationArtifact = (item: StdLibCallOp) => {
  const nodePath = JSON.stringify(item.nodePath)
  const artifact = [...kclManager.artifactGraph.values()].find(
    (a) => JSON.stringify((a as Plane).codeRef?.nodePath) === nodePath
  )
  return artifact
}
