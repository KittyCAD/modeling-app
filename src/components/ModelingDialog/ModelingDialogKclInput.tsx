import {
  getKclSubmitValue,
  type KclCommandArgument,
} from '@src/components/ModelingDialog/ModelingDialog.arguments'
import type { Completion } from '@codemirror/autocomplete'
import {
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  completionStatus,
} from '@codemirror/autocomplete'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, tooltips } from '@codemirror/view'
import { useSignals } from '@preact/signals-react/runtime'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { CustomIcon } from '@src/components/CustomIcon'
import { Spinner } from '@src/components/Spinner'
import Tooltip from '@src/components/Tooltip'
import { editorTheme } from '@src/editor/plugins/theme'
import {
  createLocalName,
  createVariableDeclaration,
  findUniqueName,
} from '@src/lang/create'
import { getNodeFromPath } from '@src/lang/queryAst'
import type { SourceRange, VariableDeclarator } from '@src/lang/wasm'
import { formatNumberValue, isPathToNode } from '@src/lang/wasm'
import { useApp, useSingletons } from '@src/lib/boot'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { isKclCommandValue } from '@src/lib/commandUtils'
import { getResolvedTheme } from '@src/lib/theme'
import { err } from '@src/lib/trap'
import { useCalculateKclExpression } from '@src/lib/useCalculateKclExpression'
import { roundOff, roundOffWithUnits } from '@src/lib/utils'
import { varMentions } from '@src/lib/varCompletionExtension'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'
import {
  CODE_EDITOR_FOCUSED_COMMAND_SCOPE,
  CODE_EDITOR_NOT_FOCUSED_COMMAND_SCOPE,
  commandScopeService,
} from '@src/registry/contracts/commands'
import { useSelector } from '@xstate/react'
import type { ReactNode } from 'react'
import {
  use,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { AnyStateMachine, SnapshotFrom } from 'xstate'
import styles from './ModelingDialog.module.css'

const machineContextSelector = (snapshot?: SnapshotFrom<AnyStateMachine>) =>
  snapshot?.context

function getKclEditorContentAttributes(labelId: string, disabled: boolean) {
  return EditorView.contentAttributes.of({
    'aria-disabled': String(disabled),
    'aria-labelledby': labelId,
    'aria-multiline': 'false',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
  })
}

export function ModelingDialogKclInput({
  name,
  arg,
  label,
  description,
  isRequired,
  disabled,
  value,
  commandBarContext,
  selectionRanges,
  submittedValue,
  autoFocus,
  onChange,
  onValidationChange,
}: {
  name: string
  arg: KclCommandArgument
  label: ReactNode
  description?: ReactNode
  isRequired: boolean
  disabled: boolean
  value: string
  commandBarContext: CommandBarContext
  selectionRanges: Selections
  submittedValue?: unknown
  autoFocus?: boolean
  onChange: (change: ModelingDialogKclChange) => void
  onValidationChange: (state: ModelingDialogKclValidationState) => void
}) {
  useSignals()
  const { settings, wasmPromise, registry } = useApp()
  const { kclManager } = useSingletons()
  const wasmInstance = use(wasmPromise)
  const settingsValues = settings.useSettings()
  const inputId = `modeling-dialog-kcl-input-${name}`
  const labelId = `${inputId}-label`
  const editorWrapperRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onValidationChangeRef = useRef(onValidationChange)
  const lastReportedValueRef = useRef<unknown>(Symbol('initial-kcl-value'))
  const lastValidationStateRef = useRef<string>('')
  const isSyncingEditorValueRef = useRef(false)
  const initialEditorValueRef = useRef(value)
  const initialEditorDisabledRef = useRef(disabled)
  const initialEditorLabelIdRef = useRef(labelId)
  const initialEditorAutoFocusRef = useRef(autoFocus)
  const initialEditorThemeRef = useRef(settingsValues.app.theme.current)
  const compartmentsRef = useRef({
    theme: new Compartment(),
    varMentions: new Compartment(),
    setValue: new Compartment(),
    keymap: new Compartment(),
    editable: new Compartment(),
    contentAttributes: new Compartment(),
  })

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onValidationChangeRef.current = onValidationChange
  }, [onValidationChange])

  const argMachineContext = useSelector(
    arg.machineActor,
    machineContextSelector
  )
  const initialVariableName = useMemo(() => {
    if (arg.variableName !== undefined) {
      return arg.variableName instanceof Function
        ? arg.variableName(commandBarContext, argMachineContext)
        : arg.variableName
    }

    return isKclCommandValue(submittedValue) && 'variableName' in submittedValue
      ? submittedValue.variableName
      : name
  }, [arg, argMachineContext, commandBarContext, name, submittedValue])

  const [createNewVariable, setCreateNewVariable] = useState(
    (isKclCommandValue(submittedValue) && 'variableName' in submittedValue) ||
      arg.createVariable === 'byDefault' ||
      arg.createVariable === 'force' ||
      false
  )
  const [hasEditedVariableName, setHasEditedVariableName] = useState(false)

  const kclValue = useMemo(() => getKclSubmitValue(arg, value), [arg, value])
  const calculateOptions = useMemo(
    () => ({
      allowArrays: arg.allowArrays ?? false,
      allowStringArrays: arg.allowStringArrays ?? false,
    }),
    [arg.allowArrays, arg.allowStringArrays]
  )

  const sourceRangeForPrevVariables = useMemo<SourceRange | undefined>(() => {
    const nodeToEdit = commandBarContext.argumentsToSubmit.nodeToEdit
    const pathToNode = isPathToNode(nodeToEdit) ? nodeToEdit : undefined
    const node = pathToNode
      ? getNodeFromPath<Node<VariableDeclarator>>(
          kclManager.ast,
          pathToNode,
          wasmInstance
        )
      : undefined

    return !err(node) && node && node.node.type === 'VariableDeclarator'
      ? [node.node.start, node.node.end, node.node.moduleId]
      : undefined
  }, [
    commandBarContext.argumentsToSubmit.nodeToEdit,
    kclManager.ast,
    wasmInstance,
  ])

  const completionSourceRange = useMemo<SourceRange>(
    () =>
      sourceRangeForPrevVariables ||
      selectionRanges.graphSelections[0]?.codeRef?.range || [
        kclManager.codeSignal.value.length,
        kclManager.codeSignal.value.length,
      ],
    [
      kclManager.codeSignal.value.length,
      selectionRanges.graphSelections,
      sourceRangeForPrevVariables,
    ]
  )

  const {
    calcResult,
    newVariableInsertIndex,
    valueNode,
    newVariableName,
    setNewVariableName,
    isNewVariableNameUnique,
    prevVariables,
    isExecuting,
  } = useCalculateKclExpression({
    value: kclValue,
    initialVariableName,
    sourceRange: completionSourceRange,
    selectionRanges,
    rustContext: kclManager.rustContext,
    code: kclManager.codeSignal.value,
    ast: kclManager.astSignal.value,
    variables: kclManager.variablesSignal.value,
    options: calculateOptions,
  })

  useEffect(() => {
    if (hasEditedVariableName) {
      return
    }

    setNewVariableName(
      findUniqueName(kclManager.astSignal.value, initialVariableName)
    )
  }, [
    hasEditedVariableName,
    initialVariableName,
    kclManager.astSignal.value,
    setNewVariableName,
  ])

  const varMentionData = useMemo<Completion[]>(
    () =>
      prevVariables.map((variable) => {
        const roundedWithUnits = (() => {
          if (typeof variable.value !== 'number' || !variable.ty) {
            return undefined
          }
          const numWithUnits = formatNumberValue(
            variable.value,
            variable.ty,
            wasmInstance
          )
          if (err(numWithUnits)) {
            return undefined
          }
          return roundOffWithUnits(numWithUnits)
        })()

        return {
          label: variable.key,
          detail: roundedWithUnits ?? String(roundOff(Number(variable.value))),
        }
      }),
    [prevVariables, wasmInstance]
  )
  const initialEditorVarMentionDataRef = useRef(varMentionData)
  const isEmpty = value.trim() === ''
  const canUseUncalculatedValue =
    Boolean(arg.allowUncalculated) && valueNode !== null
  const canSubmitKclValue =
    (isEmpty && !isRequired) ||
    (!isExecuting &&
      valueNode !== null &&
      (calcResult !== 'NAN' || canUseUncalculatedValue) &&
      (!createNewVariable || isNewVariableNameUnique))
  const validationMessage =
    isEmpty && isRequired
      ? 'Enter a value.'
      : !isEmpty && !isExecuting && valueNode === null
        ? 'Unable to submit undefined command value.'
        : !isEmpty &&
            !isExecuting &&
            calcResult === 'NAN' &&
            !canUseUncalculatedValue
          ? "Can't calculate"
          : createNewVariable && !isNewVariableNameUnique
            ? 'Variable name unavailable'
            : undefined
  const resolvedKclValue = useMemo<KclCommandValue | undefined>(() => {
    if (isEmpty || !canSubmitKclValue || valueNode === null) {
      return undefined
    }

    return createNewVariable
      ? ({
          valueAst: valueNode,
          valueText: kclValue,
          valueCalculated: calcResult,
          variableName: newVariableName,
          insertIndex: newVariableInsertIndex,
          variableIdentifierAst: createLocalName(newVariableName),
          variableDeclarationAst: createVariableDeclaration(
            newVariableName,
            valueNode
          ),
        } satisfies KclCommandValue)
      : ({
          valueAst: valueNode,
          valueText: kclValue,
          valueCalculated: calcResult,
        } satisfies KclCommandValue)
  }, [
    calcResult,
    canSubmitKclValue,
    createNewVariable,
    isEmpty,
    kclValue,
    newVariableInsertIndex,
    newVariableName,
    valueNode,
  ])
  const valueForSummary = resolvedKclValue ?? {
    valueAst: valueNode,
    valueText: kclValue,
    valueCalculated: calcResult,
  }

  useLayoutEffect(() => {
    if (!editorWrapperRef.current) {
      return
    }

    const commandScopes = registry.optional(commandScopeService)
    const initialDisabled = initialEditorDisabledRef.current
    const compartments = compartmentsRef.current
    const editor = new EditorView({
      state: EditorState.create({
        doc: initialEditorValueRef.current,
        extensions: [
          compartments.theme.of(
            editorTheme[getResolvedTheme(initialEditorThemeRef.current)]
          ),
          compartments.varMentions.of(
            varMentions(initialEditorVarMentionDataRef.current)
          ),
          compartments.editable.of([
            EditorState.readOnly.of(initialDisabled),
            EditorView.editable.of(!initialDisabled),
          ]),
          compartments.contentAttributes.of(
            getKclEditorContentAttributes(
              initialEditorLabelIdRef.current,
              initialDisabled
            )
          ),
          compartments.setValue.of(
            EditorView.updateListener.of((update) => {
              if (update.docChanged && !isSyncingEditorValueRef.current) {
                onChangeRef.current({
                  source: 'edit',
                  value: update.state.doc.toString(),
                })
              }
            })
          ),
          closeBrackets(),
          keymap.of([...closeBracketsKeymap, ...completionKeymap]),
          compartments.keymap.of(
            keymap.of([
              {
                key: 'Enter',
                run: (editorView) => {
                  if (completionStatus(editorView.state) !== null) {
                    return false
                  }
                  editorView.dom.closest('form')?.requestSubmit()
                  return true
                },
              },
            ])
          ),
          EditorView.lineWrapping,
          tooltips({ parent: document.body }),
        ],
      }),
      parent: editorWrapperRef.current,
    })

    editorRef.current = editor
    if (initialEditorAutoFocusRef.current && !initialDisabled) {
      editor.focus()
      editor.dispatch({
        selection: { anchor: 0, head: editor.state.doc.length },
      })
    }

    return () => {
      // Check focus before React removes this editor. Otherwise opening the
      // command palette can capture its stale editor scope after dismissal.
      if (editor.dom.contains(document.activeElement)) {
        commandScopes?.removeScope(CODE_EDITOR_FOCUSED_COMMAND_SCOPE)
        commandScopes?.applyScope(CODE_EDITOR_NOT_FOCUSED_COMMAND_SCOPE)
      }
      editor.destroy()
      editorRef.current = null
    }
  }, [registry])

  useEffect(() => {
    if (!editorRef.current) {
      return
    }
    editorRef.current.dispatch({
      effects: compartmentsRef.current.theme.reconfigure(
        editorTheme[getResolvedTheme(settingsValues.app.theme.current)]
      ),
    })
  }, [settingsValues.app.theme])

  useEffect(() => {
    if (!editorRef.current) {
      return
    }
    editorRef.current.dispatch({
      effects: compartmentsRef.current.varMentions.reconfigure(
        varMentions(varMentionData)
      ),
    })
  }, [varMentionData])

  useEffect(() => {
    if (!editorRef.current) {
      return
    }
    editorRef.current.dispatch({
      effects: [
        compartmentsRef.current.editable.reconfigure([
          EditorState.readOnly.of(disabled),
          EditorView.editable.of(!disabled),
        ]),
        compartmentsRef.current.contentAttributes.reconfigure(
          getKclEditorContentAttributes(labelId, disabled)
        ),
      ],
    })
  }, [disabled, labelId])

  useEffect(() => {
    if (!editorRef.current) {
      return
    }

    const currentValue = editorRef.current.state.doc.toString()
    if (currentValue === value) {
      return
    }

    isSyncingEditorValueRef.current = true
    try {
      editorRef.current.dispatch({
        changes: {
          from: 0,
          to: editorRef.current.state.doc.length,
          insert: value,
        },
      })
    } finally {
      isSyncingEditorValueRef.current = false
    }
  }, [value])

  useEffect(() => {
    const nextValue = resolvedKclValue ?? value
    if (lastReportedValueRef.current === nextValue) {
      return
    }

    lastReportedValueRef.current = nextValue
    onChangeRef.current({ source: 'calculation', value: nextValue })
  }, [resolvedKclValue, value])

  useEffect(() => {
    const nextValidationState: ModelingDialogKclValidationState = {
      canSubmit: canSubmitKclValue,
      isChecking: !isEmpty && isExecuting,
      message: validationMessage,
    }
    const nextValidationStateKey = JSON.stringify(nextValidationState)
    if (lastValidationStateRef.current === nextValidationStateKey) {
      return
    }

    lastValidationStateRef.current = nextValidationStateKey
    onValidationChangeRef.current(nextValidationState)
  }, [canSubmitKclValue, isEmpty, isExecuting, validationMessage])

  const summaryClassName =
    validationMessage && !isExecuting
      ? 'text-destroy-80 dark:text-destroy-40'
      : 'text-succeed-80 dark:text-succeed-40'

  return (
    <div className="flex flex-col gap-1">
      <span
        id={labelId}
        className="text-xs font-medium leading-tight text-chalkboard-80 dark:text-chalkboard-20"
      >
        {label}
        {isRequired && <span aria-hidden="true"> *</span>}
        {isRequired && <span className="sr-only"> (required)</span>}
      </span>
      <div className="relative">
        <div
          ref={editorWrapperRef}
          id={inputId}
          data-testid={inputId}
          className={[
            styles.kclEditor,
            arg.createVariable !== 'disallow' ? styles.kclEditorWithAction : '',
            disabled ? styles.kclEditorDisabled : '',
          ].join(' ')}
        />
        {arg.createVariable !== 'disallow' && (
          <button
            type="button"
            aria-label="Create variable"
            aria-pressed={createNewVariable}
            id={`${inputId}-variable-checkbox`}
            data-testid={`${inputId}-variable-checkbox`}
            disabled={disabled || arg.createVariable === 'force'}
            onClick={() => setCreateNewVariable((current) => !current)}
            className={[
              'absolute top-1/2 right-1 m-0 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-sm border-0 p-0 focus-visible:outline focus-visible:outline-1 focus-visible:outline-appForeground disabled:cursor-not-allowed',
              createNewVariable
                ? 'bg-primary/15 text-primary hover:bg-primary/20'
                : 'bg-transparent text-chalkboard-60 hover:bg-chalkboard-20 hover:text-chalkboard-90 dark:text-chalkboard-40 dark:hover:bg-chalkboard-80 dark:hover:text-chalkboard-10',
            ].join(' ')}
          >
            <CustomIcon name="make-variable" className="h-4 w-4" />
            <Tooltip position="left">
              {createNewVariable ? 'Do not create variable' : 'Create variable'}
            </Tooltip>
          </button>
        )}
      </div>
      {!isEmpty && (
        <div className="flex min-w-0 items-center gap-1 text-[11px] leading-snug">
          <span className="text-chalkboard-60 dark:text-chalkboard-40">=</span>
          <span className={summaryClassName}>
            {isExecuting || !calcResult ? (
              <Spinner className="h-3 w-3 text-inherit" />
            ) : arg.valueSummary && valueNode ? (
              arg.valueSummary(valueForSummary, wasmInstance)
            ) : calcResult === 'NAN' ? (
              "Can't calculate"
            ) : (
              roundOffWithUnits(calcResult, 4)
            )}
          </span>
        </div>
      )}
      {arg.createVariable !== 'disallow' && createNewVariable && (
        <div className="flex min-w-0 items-center gap-2 text-[11px] leading-snug">
          <input
            type="text"
            id={`${inputId}-variable-name`}
            name={`${inputId}-variable-name`}
            className="mono min-h-7 min-w-0 flex-1 rounded-sm border border-chalkboard-30 bg-transparent px-2 py-1 text-xs leading-tight focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-0 focus-visible:outline-appForeground disabled:cursor-not-allowed disabled:bg-chalkboard-10 disabled:text-chalkboard-60 dark:border-chalkboard-70 dark:disabled:bg-chalkboard-90 dark:disabled:text-chalkboard-50"
            placeholder="Variable name"
            aria-label="Variable name"
            value={newVariableName}
            disabled={disabled}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck="false"
            onChange={(event) => {
              setHasEditedVariableName(true)
              setNewVariableName(event.target.value)
            }}
            onKeyDown={(event) => {
              if (
                event.currentTarget.value === '' &&
                event.key === 'Backspace' &&
                arg.createVariable !== 'force'
              ) {
                setCreateNewVariable(false)
              }
            }}
          />
          <span
            className={
              isNewVariableNameUnique
                ? 'shrink-0 text-succeed-60 dark:text-succeed-40'
                : 'shrink-0 text-destroy-60 dark:text-destroy-40'
            }
            aria-live="polite"
          >
            {isNewVariableNameUnique ? 'Available' : 'Unavailable'}
          </span>
        </div>
      )}
      {description}
    </div>
  )
}

export type ModelingDialogKclChange =
  | { source: 'edit'; value: string }
  // Keep the raw text while its expression is empty, invalid, or calculating.
  | { source: 'calculation'; value: KclCommandValue | string }

export type ModelingDialogKclValidationState = {
  canSubmit: boolean
  isChecking: boolean
  message?: string
}
