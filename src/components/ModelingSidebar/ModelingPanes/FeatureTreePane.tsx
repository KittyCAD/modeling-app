import { Diagnostic } from '@codemirror/lint'
import { useMachine } from '@xstate/react'
import { ContextMenu, ContextMenuItem } from 'components/ContextMenu'
import { CustomIcon, CustomIconName } from 'components/CustomIcon'
import Loading from 'components/Loading'
import { selectionChangedObservable } from 'components/ModelingMachineProvider'
import { useModelingContext } from 'hooks/useModelingContext'
import { useKclContext } from 'lang/KclProvider'
import { codeRefFromRange, getArtifactFromRange } from 'lang/std/artifactGraph'
import { SourceRange, sourceRangeFromRust } from 'lang/wasm'
import {
  filterOperations,
  getOperationIcon,
  getOperationLabel,
} from 'lib/operations'
import { editorManager, engineCommandManager, kclManager } from 'lib/singletons'
import { ComponentProps, useEffect, useMemo, useRef, useState } from 'react'
import { Operation } from 'wasm-lib/kcl/bindings/Operation'
import { Actor, assign, Prop, setup } from 'xstate'
import { kclEditorMountedObservable } from './KclEditorPane'

type FeatureTreeEvent =
  | {
      type: 'goToKclSource'
      data: { targetSourceRange: SourceRange }
    }
  | {
      type: 'selectOperation'
      data: { targetSourceRange: SourceRange }
    }
  | {
      type: 'enterEditFlow'
      data: { targetSourceRange: SourceRange }
    }
  | { type: 'codePaneOpened' }
  | { type: 'selected' }
  | { type: 'done' }

const featureTreeMachine = setup({
  types: {
    context: {} as { targetSourceRange?: SourceRange },
    events: {} as FeatureTreeEvent,
  },
  guards: {
    codePaneIsOpen: () => false,
  },
  actions: {
    saveTargetSourceRange: assign({
      targetSourceRange: ({ event }) =>
        'data' in event ? event.data.targetSourceRange : undefined,
    }),
    clearTargetSourceRange: assign({
      targetSourceRange: undefined,
    }),
    sendSelectionEvent: () => {},
    openCodePane: () => {},
    sendEditFlowStart: () => {},
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QDMwEMAuBXATmAKnmAHQCWEANmAMRQD2+dA0gMYUDKduLYA2gAwBdRKAAOdWKQyk6AOxEgAHogCMAFn7EAbAFYAHAHYAnGoOm9OgMw6tAGhABPRBsvF+a6wYBM-A-0uWepYGAL4h9qiYuAREZJQ0sGBULBgA8qJgOJgysgLCSCDiktJyCsoIKipabmo6-Co2Wip+-DoG9k4IWpp+Ae6W-N16KpZeYRHo2HiEYCTkVNRgshiZAKIQUgBiFHQA7nkKRVI5ZapergN6el46515GVdYdiN4GbjpGXiNGV2pan+MQJEpjFZsR6KRZFBGKwOFwcDxiIlktIodRkWAUpADgUjiV5AVyipWipiGZupYVCY1D5+F5ngg-jpiJ8DFo1OoDA13GNwkDJtEZiQIVCYWxONwSBA5DQcWIJMdSoTVG0yTodGoPAZKfwjP52o5EHVNIYvNd9M0zJZAcDBbERdDmOL4Yi6BlZJCoABhOgQMAABTQshoLF9AaDYHSS2xQkOCvxpy6lWIbS0Bm8JkM+ksDKZLK8bL0-S8NOCNoF01iGJSnqRSUxqKg6PrWIgcsK8ZOyq6aj0avTbU1Hg0KgZzVcrU+Xn+9Q+dPLUUrYOrjeI0uD1HbeK7oCJBj7xkafhMX28agZJeqHz0RhstTUD21WgXIKFxCWKxwnvWWx2uzrKKes2KIxvk8rFDuShGpY1RaKMRiHr4va9gyegPsQQRmiYVK+GYL52mCH6ZN+GwYNsexrjKm6xrinZKruqhaLBmr8PUvj6F4nGoeoxDEpYCFMVSowfPhS7CnQnpinCkoAQ2QGKLAGCYCQaDIJ+AAUxoAJTULaYnghJopOtJCIkCunpbnRBIMQgBZvAhzS3O4HJoemDJziyRgBF5D71DcomgmZLaruZaIKUpKzEKpGnabpFaBbJNZQoljaWRB9FQYy9xkj8VLnPomGjoatk-CmAx1KYWgFpYfyhHyekJURX5Qj+ZF-il8mKcpUVqZkmmsTpDVvk1JG-hRoVQGlirWZlZpvIEC3uHSgQanYxUPKSRh6pSXI+N0NJhHyshhvABRDUQcbpTN5QALRrZ0N3TtoVJwYW7F0lUAVvvMYCXdNiY0mOfzPbU+4jOO6pffahmOrCEqmX9CbdjVXgpmmcGaloehVbUObFdYzKeFtVQqJh+5Q2CDpSfDiITYjkHlEWrjqh86rqB4N5FZ0mqo1jup1J8lT5ToFPiZJxk01KMr0xlRLNLBdLarOmomPdzg0toRa3rqXwqMLosGeLcMuiQbpLJ6Pp+oGwYy9diD8ZoNhsjVfzYyWVi5hrfNeTBJIfDVBt07RV2JtYqNOxjrs4x7xVVcQva3p8Fg0oYviB8FtZB+B-3dhojvoy7WPR3jnTqEYGF6w+2p6vcrEi-V8VvhNlE28HOc2emrhNLUIzBD3GpjtqxCcd4nGcsEn0N4ujXLMRLWkeRuy26HNgYZSNyBHB6r0rHcHENYr0WNhIx6AbI3z2N-5Zx2Ie5+4a961Y2MEzvnRoeXxrJ8t+7XGfs-NVAVqi8W6-TbkjGyGh5pBCCEtc4yc1YIAeKjMOhhey+FGM0Q6IQgA */
  id: 'featureTree',
  states: {
    idle: {
      on: {
        goToKclSource: {
          target: 'goingToKclSource',
          actions: 'saveTargetSourceRange',
        },

        selectOperation: {
          entry: () => console.warn('fucking select operation'),
          target: 'selecting',
          actions: 'saveTargetSourceRange',
        },

        enterEditFlow: {
          target: 'enteringEditFlow',
          actions: 'saveTargetSourceRange',
        },
      },
    },

    goingToKclSource: {
      states: {
        selecting: {
          on: {
            selected: {
              target: 'done',
            },
          },

          entry: ['sendSelectionEvent'],

          after: {
            '500': '#featureTree.idle',
          },
        },

        done: {
          entry: ['clearTargetSourceRange'],
          always: '#featureTree.idle',
        },

        openingCodePane: {
          on: {
            codePaneOpened: 'selecting',
          },

          entry: 'openCodePane',
        },
      },

      initial: 'openingCodePane',
    },

    selecting: {
      states: {
        selecting: {
          on: {
            selected: 'done',
          },

          entry: 'sendSelectionEvent',

          after: {
            '500': {
              target: '#featureTree.idle',
              reenter: true,
            },
          },
        },

        done: {
          always: '#featureTree.idle',
          entry: 'clearTargetSourceRange',
        },
      },

      initial: 'selecting',
    },

    enteringEditFlow: {
      states: {
        selecting: {
          on: {
            selected: 'done',
          },

          after: {
            '500': '#featureTree.idle',
          },
        },

        done: {
          always: '#featureTree.idle',
        },
      },

      initial: 'selecting',
      entry: 'sendSelectionEvent',
      exit: ['clearTargetSourceRange', 'sendEditFlowStart'],
    },
  },

  initial: 'idle',
})

export const FeatureTreePane = () => {
  const { send: modelingSend, state: modelingState } = useModelingContext()
  const [featureTreeState, featureTreeSend] = useMachine(
    featureTreeMachine.provide({
      guards: {
        codePaneIsOpen: () =>
          modelingState.context.store.openPanes.includes('code') &&
          editorManager.editorView !== null,
      },
      actions: {
        openCodePane: () => {
          console.warn('openCodePane event')
          modelingSend({
            type: 'Set context',
            data: {
              openPanes: [...modelingState.context.store.openPanes, 'code'],
            },
          })
        },
        sendEditFlowStart: () => {
          console.warn('sendEditFlowStart')
          modelingSend({ type: 'Enter sketch' })
        },
        sendSelectionEvent: ({ context }) => {
          console.warn('sendSelectionEvent', context)
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

  useEffect(() => {
    const codeOpen = modelingState.context.store.openPanes.includes('code')
    if (editorManager.editorView !== null) {
      if (codeOpen) {
        featureTreeSend({ type: 'codePaneOpened' })
      }
    } else {
      const mountedSubscription = kclEditorMountedObservable.subscribe(
        (mounted) => {
          if (mounted && codeOpen) {
            featureTreeSend({ type: 'codePaneOpened' })
          }
        }
      )
      return () => mountedSubscription.unsubscribe()
    }
  }, [modelingState.context.store.openPanes])

  useEffect(() => {
    const subscription = selectionChangedObservable.subscribe((selection) => {
      console.warn('selection changed', selection)
      featureTreeSend({ type: 'selected' })
    })
    return () => subscription.unsubscribe()
  }, [featureTreeState.value, selectionChangedObservable])

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
    if (
      props.item.type === 'StdLibCall' &&
      props.item.name === 'startSketchOn'
    ) {
      props.send({
        type: 'enterEditFlow',
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
          console.log('view source', props.item)
          if (props.item.type === 'UserDefinedFunctionReturn') {
            return
          }
          console.warn('sending goToKclSource', props.item.sourceRange)
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
                console.log('view function source', props.item)
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
