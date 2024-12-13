import { Diagnostic } from '@codemirror/lint'
import { ContextMenu, ContextMenuItem } from 'components/ContextMenu'
import { CustomIcon, CustomIconName } from 'components/CustomIcon'
import { useModelingContext } from 'hooks/useModelingContext'
import { useKclContext } from 'lang/KclProvider'
import { codeRefFromRange, getArtifactFromRange } from 'lang/std/artifactGraph'
import { sourceRangeFromRust } from 'lang/wasm'
import { editorManager, engineCommandManager, kclManager } from 'lib/singletons'
import { ComponentProps, useCallback, useMemo, useRef, useState } from 'react'
import { Operation } from 'wasm-lib/kcl/bindings/Operation'

const stdLibIconMap: Record<string, CustomIconName> = {
  startSketchOn: 'sketch',
  extrude: 'extrude',
  revolve: 'revolve',
  fillet: 'fillet3d',
  chamfer: 'chamfer3d',
  offsetPlane: 'plane',
  shell: 'shell',
  loft: 'loft',
  sweep: 'sweep',
}

function getOperationIcon(op: Operation): CustomIconName {
  switch (op.type) {
    case 'StdLibCall':
      return stdLibIconMap[op.name] ?? 'questionMark'
    default:
      return 'make-variable'
  }
}

/**
 * Exclude StdLibCall operations that occur
 * between a UserDefinedFunctionCall and the next UserDefinedFunctionReturn
 */
function isNotStdLibInUserFunction(
  operation: Operation,
  index: number,
  allOperations: Operation[]
) {
  if (operation.type === 'StdLibCall') {
    const lastUserDefinedFunctionCallIndex = allOperations
      .slice(0, index)
      .findLastIndex((op) => op.type === 'UserDefinedFunctionCall')
    const lastUserDefinedFunctionReturnIndex = allOperations
      .slice(0, index)
      .findLastIndex((op) => op.type === 'UserDefinedFunctionReturn')

    console.log(`checking ${operation.type} at index ${index}`, {
      lastUserDefinedFunctionCallIndex,
      lastUserDefinedFunctionReturnIndex,
    })
    return (
      lastUserDefinedFunctionCallIndex < lastUserDefinedFunctionReturnIndex ||
      lastUserDefinedFunctionReturnIndex === -1
    )
  }
  return true
}

/**
 * A second filter to exclude UserDefinedFunctionCall operations
 * that don't have any operations inside them
 */
function isNotUserFunctionWithNoOperations(
  operation: Operation,
  index: number,
  allOperations: Operation[]
) {
  if (operation.type === 'UserDefinedFunctionCall') {
    return (
      index <= allOperations.length &&
      allOperations[index + 1].type !== 'UserDefinedFunctionReturn'
    )
  }
  return true
}

/**
 * A third filter to exclude UserDefinedFunctionReturn operations
 */
function isNotUserFunctionReturn(operation: Operation) {
  return operation.type !== 'UserDefinedFunctionReturn'
}

export const FeatureTreePane = () => {
  const { send: modelingSend, state: modelingState } = useModelingContext()
  const parseErrors = kclManager.errors.filter((e) => e.kind !== 'engine' && e)
  const longestErrorOperationList = kclManager.errors.reduce((acc, error) => {
    return error.operations && error.operations.length > acc.length
      ? error.operations
      : acc
  }, [] as Operation[])
  const operationList = !parseErrors.length
    ? !kclManager.errors.length
      ? kclManager.execState.operations
      : longestErrorOperationList
    : kclManager.lastSuccessfulOperations
  const defaultPlanes = useMemo(() => {
    return kclManager?.defaultPlanes
  }, [kclManager.defaultPlanes])

  return (
    <div className="relative">
      <section
        data-testid="debug-panel"
        className="absolute inset-0 p-1 box-border overflow-auto"
      >
        {defaultPlanes !== null && (
          <div className="relative">
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
                    onClick={() => {
                      modelingSend({
                        type: 'Set context',
                        data: {
                          openPanes: [
                            ...modelingState.context.store.openPanes,
                            'code',
                          ],
                        },
                      })
                      // TODO: this doesn't properly await the set context
                      // so scrolling doesn't work if the code pane isn't open
                      editorManager.scrollToFirstErrorDiagnosticIfExists()
                    }}
                    className="bg-chalkboard-10 text-destroy-80 p-1 rounded-sm flex-none hover:bg-chalkboard-10 hover:border-destroy-70 hover:text-destroy-80 border-transparent"
                  >
                    View error
                  </button>
                </div>
              </div>
            )}
            {operationList
              .filter(isNotUserFunctionWithNoOperations)
              .filter(isNotStdLibInUserFunction)
              .filter(isNotUserFunctionReturn)
              .map((operation) => (
                <OperationListItem
                  key={`${operation.type}-${
                    'name' in operation ? operation.name : 'anonymous'
                  }-${
                    'sourceRange' in operation
                      ? operation.sourceRange[0]
                      : 'start'
                  }`}
                  item={operation}
                />
              ))}
          </div>
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
const OperationPaneItem = (props: {
  icon: CustomIconName
  name: string
  handleSelect: () => void
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
        onClick={props.handleSelect}
        className="reset flex-1 flex items-center gap-2 border-transparent dark:border-transparent text-left text-base"
      >
        <CustomIcon name={props.icon} className="w-5 h-5 block" />
        {props.name}
      </button>
      {props.errors && props.errors.length > 0 && (
        <em className="text-destroy-80 text-xs">has error</em>
      )}
      {props.visibilityToggle && (
        <VisibilityToggle {...props.visibilityToggle} />
      )}
      {props.menuItems && (
        <ContextMenu menuTargetElement={menuRef} items={props.menuItems} />
      )}
    </div>
  )
}

const OperationListItem = (props: { item: Operation }) => {
  const { send: modelingSend, state: modelingState } = useModelingContext()
  const kclContext = useKclContext()
  const jsSourceRange =
    'sourceRange' in props.item
      ? sourceRangeFromRust(props.item.sourceRange)
      : null
  const errors = useMemo(() => {
    return kclContext.diagnostics.filter(
      (diag) =>
        diag.severity === 'error' &&
        'sourceRange' in props.item &&
        diag.from >= props.item.sourceRange[0] &&
        diag.to <= props.item.sourceRange[1]
    )
  }, [kclContext.diagnostics.length])
  const artifact = jsSourceRange
    ? getArtifactFromRange(jsSourceRange, engineCommandManager.artifactGraph)
    : null
  const selectOperation = useCallback(() => {
    if (!jsSourceRange) {
      return
    }
    if (!artifact || !('codeRef' in artifact)) {
      modelingSend({
        type: 'Set selection',
        data: {
          selectionType: 'singleCodeCursor',
          selection: {
            codeRef: codeRefFromRange(jsSourceRange, kclManager.ast),
          },
        },
      })
    } else {
      modelingSend({
        type: 'Set selection',
        data: {
          selectionType: 'singleCodeCursor',
          selection: {
            artifact: artifact,
            codeRef: codeRefFromRange(jsSourceRange, kclManager.ast),
          },
        },
      })
    }
  }, [
    artifact,
    jsSourceRange,
    modelingSend,
    props.item,
    engineCommandManager.artifactGraph,
  ])

  function openToFunctionDefinition() {
    if (props.item.type !== 'UserDefinedFunctionCall') return
    modelingSend({
      type: 'Set selection',
      data: {
        selectionType: 'singleCodeCursor',
        selection: {
          codeRef: codeRefFromRange(
            sourceRangeFromRust(props.item.functionSourceRange),
            kclManager.ast
          ),
        },
      },
    })
  }

  const menuItems = useMemo(
    () => [
      <ContextMenuItem
        onClick={() => {
          selectOperation()
          modelingSend({
            type: 'Set context',
            data: {
              openPanes: [...modelingState.context.store.openPanes, 'code'],
            },
          })
          // TODO: this doesn't properly await the set context
          // so scrolling doesn't work if the code pane isn't open
          editorManager.scrollToSelection()
        }}
      >
        View KCL source code
      </ContextMenuItem>,
      ...(props.item.type === 'UserDefinedFunctionCall'
        ? [
            <ContextMenuItem onClick={openToFunctionDefinition}>
              View function definition
            </ContextMenuItem>,
          ]
        : []),
      <ContextMenuItem
        onClick={() => {
          selectOperation()
          modelingSend({ type: 'Delete selection' })
        }}
      >
        Delete
      </ContextMenuItem>,
    ],
    [modelingSend, props.item]
  )

  return (
    <OperationPaneItem
      icon={getOperationIcon(props.item)}
      name={
        'name' in props.item && props.item.name !== null
          ? props.item.name
          : 'anonymous'
      }
      menuItems={menuItems}
      handleSelect={selectOperation}
      errors={errors}
    />
  )
}
