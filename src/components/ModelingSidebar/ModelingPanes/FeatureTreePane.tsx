import { Diagnostic } from '@codemirror/lint'
import { ContextMenu, ContextMenuItem } from 'components/ContextMenu'
import { CustomIcon, CustomIconName } from 'components/CustomIcon'
import Loading from 'components/Loading'
import { useModelingContext } from 'hooks/useModelingContext'
import { useKclContext } from 'lang/KclProvider'
import { codeRefFromRange, getArtifactFromRange } from 'lang/std/artifactGraph'
import { sourceRangeFromRust } from 'lang/wasm'
import {
  getOperationIcon,
  getOperationLabel,
  operationFilters,
} from 'lib/operations'
import { editorManager, engineCommandManager, kclManager } from 'lib/singletons'
import { reportRejection } from 'lib/trap'
import { toSync } from 'lib/utils'
import { ComponentProps, useCallback, useMemo, useRef, useState } from 'react'
import { Operation } from 'wasm-lib/kcl/bindings/Operation'

export const FeatureTreePane = () => {
  const { send: modelingSend, state: modelingState } = useModelingContext()
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
  const operationList = operationFilters.reduce(
    (acc, filter) => acc.filter(filter),
    unfilteredOperationList
  )

  function goToError() {
    modelingSend({
      type: 'Set context',
      data: {
        openPanes: [...modelingState.context.store.openPanes, 'code'],
      },
    })
    // TODO: this doesn't properly await the set context
    // so scrolling doesn't work if the code pane isn't open
    editorManager.scrollToFirstErrorDiagnosticIfExists()
  }

  return (
    <div className="relative">
      <section
        data-testid="debug-panel"
        className="absolute inset-0 p-1 box-border overflow-auto"
      >
        {kclManager.isExecuting ? (
          <Loading>Building feature tree...</Loading>
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

              return <OperationItem key={key} item={operation} />
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
 * Wait until a predicate is true or a timeout is reached
 * TODO: this is a temporary solution until we have a better way to
 * wait for things like selections to be set. It's whack get rid of it if you're reading this.
 */
function pollUntil(timeout: number, predicate: () => boolean, interval = 20) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      const i = setInterval(() => {
        if (predicate()) {
          clearTimeout(t)
          clearInterval(i)
          resolve()
        }
      }, interval)

      clearInterval(i)
      resolve()
    }, timeout)
  })
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
const OperationItem = (props: { item: Operation }) => {
  const { send: modelingSend, state: modelingState } = useModelingContext()
  const kclContext = useKclContext()
  const name =
    'name' in props.item && props.item.name !== null
      ? getOperationLabel(props.item)
      : 'anonymous'
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

  const selectOperation = useCallback(async () => {
    if (!jsSourceRange) {
      return
    }
    const selectionSnapshot = modelingState.context.selectionRanges
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

    // Now wait for a timeout and poll for the selection to be set
    // so we know we can advance
    await pollUntil(
      100,
      () =>
        modelingState.context.selectionRanges.graphSelections?.[0].codeRef
          .range[0] !== selectionSnapshot.graphSelections[0].codeRef.range[0],
      20
    )
  }, [
    artifact,
    jsSourceRange,
    modelingSend,
    props.item,
    engineCommandManager.artifactGraph,
  ])

  async function openCodePane() {
    modelingSend({
      type: 'Set context',
      data: {
        openPanes: [...modelingState.context.store.openPanes, 'code'],
      },
    })

    // Now wait for a timeout and poll for the pane to be open
    // so we know we can advance
    await pollUntil(
      100,
      () => modelingState.context.store.openPanes.includes('code'),
      20
    )
  }

  /**
   * For now we can only enter the "edit" flow for the startSketchOn operation.
   * TODO: https://github.com/KittyCAD/modeling-app/issues/4442
   */
  async function enterEditFlow() {
    if (
      props.item.type === 'StdLibCall' &&
      props.item.name === 'startSketchOn'
    ) {
      await selectOperation()
      modelingSend({ type: 'Enter sketch' })
    }
  }

  async function selectFunctionDefinition() {
    if (props.item.type !== 'UserDefinedFunctionCall') return
    const selectionSnapshot = modelingState.context.selectionRanges
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

    // Now wait for a timeout and poll for the selection to be set
    // so we know we can advance
    await pollUntil(
      100,
      () =>
        modelingState.context.selectionRanges.graphSelections?.[0].codeRef
          .range[0] !== selectionSnapshot.graphSelections[0].codeRef.range[0],
      20
    )
  }

  async function openToFunctionDefinition() {
    if (props.item.type !== 'UserDefinedFunctionCall') return
    await openCodePane()
    await selectFunctionDefinition()
    editorManager.scrollToSelection()
  }

  async function openToDefinition() {
    await openCodePane()
    await selectOperation()
    editorManager.scrollToSelection()
  }

  const menuItems = useMemo(
    () => [
      <ContextMenuItem onClick={toSync(openToDefinition, reportRejection)}>
        View KCL source code
      </ContextMenuItem>,
      ...(props.item.type === 'UserDefinedFunctionCall'
        ? [
            <ContextMenuItem
              onClick={toSync(openToFunctionDefinition, reportRejection)}
            >
              View function definition
            </ContextMenuItem>,
          ]
        : []),
    ],
    [modelingSend, props.item]
  )

  return (
    <OperationItemWrapper
      icon={getOperationIcon(props.item)}
      name={name}
      menuItems={menuItems}
      onClick={toSync(selectOperation, reportRejection)}
      onDoubleClick={() => toSync(enterEditFlow, reportRejection)()}
      errors={errors}
    />
  )
}
