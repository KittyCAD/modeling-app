import { Diagnostic } from '@codemirror/lint'
import { useMachine, useSelector } from '@xstate/react'
import { ContextMenu, ContextMenuItem } from 'components/ContextMenu'
import { CustomIcon, CustomIconName } from 'components/CustomIcon'
import Loading from 'components/Loading'
import { useModelingContext } from 'hooks/useModelingContext'
import { useKclContext } from 'lang/KclProvider'
import { codeRefFromRange, getArtifactFromRange } from 'lang/std/artifactGraph'
import { sourceRangeFromRust } from 'lang/wasm'
import {
  filterOperations,
  getOperationIcon,
  getOperationLabel,
  stdLibMap,
} from 'lib/operations'
import {
  codeManager,
  editorManager,
  engineCommandManager,
  kclManager,
} from 'lib/singletons'
import { ComponentProps, useEffect, useMemo, useRef, useState } from 'react'
import { Operation } from 'wasm-lib/kcl/bindings/Operation'
import { Actor, Prop } from 'xstate'
import { featureTreeMachine } from 'machines/featureTreeMachine'
import {
  editorIsMountedSelector,
  kclEditorActor,
  selectionEventSelector,
} from 'machines/kclEditorMachine'

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
        sendEditFlowStart: () => {
          modelingSend({ type: 'Enter sketch' })
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
                engineCommandManager.artifactGraph
              )
            : null

          if (!artifact || !('codeRef' in artifact)) {
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
    })
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

export const visibilityMap = new Map<string, boolean>()

interface VisibilityToggleProps {
  entityId: string
  initialVisibility: boolean
  onVisibilityChange?: () => void
}

/**
 * A button that toggles the visibility of an entity
 * tied to an artifact in the feature tree.
 * TODO: this is unimplemented and will be used for
 * default planes after we fix them and add them to the artifact graph / feature tree
 */
const VisibilityToggle = (props: VisibilityToggleProps) => {
  const [visible, setVisible] = useState(props.initialVisibility)

  function handleToggleVisible() {
    setVisible(!visible)
    visibilityMap.set(props.entityId, !visible)
    props.onVisibilityChange?.()
  }

  return (
    <button
      onClick={handleToggleVisible}
      className="border-transparent p-0 m-0"
    >
      <CustomIcon
        name={visible ? 'eyeOpen' : 'eyeCrossedOut'}
        className={`w-5 h-5 ${
          visible
            ? 'hidden group-hover/item:block group-focus-within/item:block'
            : 'text-chalkboard-50'
        }`}
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
  className,
  ...props
}: React.HTMLAttributes<HTMLButtonElement> & {
  icon: CustomIconName
  name: string
  visibilityToggle?: VisibilityToggleProps
  menuItems?: ComponentProps<typeof ContextMenu>['items']
  errors?: Diagnostic[]
}) => {
  const menuRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={menuRef}
      className="flex select-none items-center group/item my-0 py-0.5 px-1 focus-within:bg-primary/10 hover:bg-primary/5"
    >
      <button
        {...props}
        className={`reset flex-1 flex items-center gap-2 border-transparent dark:border-transparent text-left text-base ${className}`}
      >
        <CustomIcon name={icon} className="w-5 h-5 block" />
        {name}
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
  const name =
    'name' in props.item && props.item.name !== null
      ? getOperationLabel(props.item)
      : 'anonymous'
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
    if (props.item.type === 'UserDefinedFunctionReturn') {
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

  function enterDeleteFlow() {
    if (props.item.type === 'StdLibCall') {
      props.send({
        type: 'enterDeleteFlow',
        data: {
          targetSourceRange: sourceRangeFromRust(props.item.sourceRange),
          currentOperation: props.item,
        },
      })
    }
  }

  const menuItems = useMemo(
    () => [
      <ContextMenuItem
        onClick={() => {
          if (props.item.type === 'UserDefinedFunctionReturn') {
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
      ...(props.item.type === 'UserDefinedFunctionCall'
        ? [
            <ContextMenuItem
              onClick={() => {
                if (props.item.type !== 'UserDefinedFunctionCall') {
                  return
                }
                const functionRange = props.item.functionSourceRange
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
      ...(props.item.type === 'StdLibCall' &&
      stdLibMap[props.item.name]?.prepareToEdit
        ? [<ContextMenuItem onClick={enterEditFlow}>Edit</ContextMenuItem>]
        : []),
      ...(props.item.type === 'StdLibCall'
        ? [<ContextMenuItem onClick={enterDeleteFlow}>Delete</ContextMenuItem>]
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
