import type { Diagnostic } from '@codemirror/lint'
import { useMachine, useSelector } from '@xstate/react'
import type { ComponentProps } from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { Actor, Prop } from 'xstate'

import type { Operation } from '@rust/kcl-lib/bindings/Operation'

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
import { sourceRangeFromRust } from '@src/lang/wasm'
import {
  filterOperations,
  getOperationIcon,
  getOperationLabel,
  stdLibMap,
} from '@src/lib/operations'
import { editorManager, kclManager, rustContext } from '@src/lib/singletons'
import {
  featureTreeMachine,
  featureTreeMachineDefaultContext,
} from '@src/machines/featureTreeMachine'
import {
  editorIsMountedSelector,
  kclEditorActor,
  selectionEventSelector,
} from '@src/machines/kclEditorMachine'

export const FeatureTreePane = () => {
  const isEditorMounted = useSelector(kclEditorActor, editorIsMountedSelector)
  const lastSelectionEvent = useSelector(kclEditorActor, selectionEventSelector)
  const { send: modelingSend, state: modelingState } = useModelingContext()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_featureTreeState, featureTreeSend] = useMachine(
    featureTreeMachine.provide({
      guards: {
        codePaneIsOpen: () =>
          modelingState.context.store.openPanes.includes('code') &&
          editorManager.editorView !== null,
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
          <Loading className="h-full">Building feature tree...</Loading>
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
    <button onClick={handleToggleVisible} className="p-0 m-0">
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
  visibilityToggle,
  menuItems,
  errors,
  customSuffix,
  className,
  selectable = true,
  ...props
}: React.HTMLAttributes<HTMLButtonElement> & {
  icon: CustomIconName
  name: string
  visibilityToggle?: VisibilityToggleProps
  customSuffix?: JSX.Element
  menuItems?: ComponentProps<typeof ContextMenu>['items']
  errors?: Diagnostic[]
  selectable?: boolean
}) => {
  const menuRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={menuRef}
      className={`flex select-none items-center group/item my-0 py-0.5 px-1 ${selectable ? 'focus-within:bg-primary/10 hover:bg-primary/5' : ''}`}
    >
      <button
        {...props}
        className={`reset flex-1 flex items-center gap-2 text-left text-base ${selectable ? 'border-transparent dark:border-transparent' : 'border-none cursor-default'} ${className}`}
      >
        <CustomIcon name={icon} className="w-5 h-5 block" />
        <div className="flex items-baseline">
          <div className="mr-2">{name}</div>
          {customSuffix && customSuffix}
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
}) => {
  const kclContext = useKclContext()
  const name = getOperationLabel(props.item)
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

  /**
   * For now we can only enter the "edit" flow for the startSketchOn operation.
   * TODO: https://github.com/KittyCAD/modeling-app/issues/4442
   */
  function enterEditFlow() {
    if (props.item.type === 'StdLibCall') {
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
      ...(props.item.type === 'StdLibCall'
        ? [
            <ContextMenuItem
              disabled={!stdLibMap[props.item.name]?.prepareToEdit}
              onClick={enterEditFlow}
              hotkey="Double click"
            >
              Edit
            </ContextMenuItem>,
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

  return (
    <OperationItemWrapper
      icon={getOperationIcon(props.item)}
      name={name}
      menuItems={menuItems}
      onClick={selectOperation}
      onDoubleClick={enterEditFlow}
      errors={errors}
    />
  )
}

const DefaultPlanes = () => {
  const { state: modelingState, send } = useModelingContext()

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
          selectable={false}
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
