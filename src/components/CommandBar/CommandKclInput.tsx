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
import type { CommandArgument, KclCommandValue } from '@src/lib/commandTypes'
import { isKclCommandValue } from '@src/lib/commandUtils'
import { getResolvedTheme } from '@src/lib/theme'
import { err } from '@src/lib/trap'
import { useCalculateKclExpression } from '@src/lib/useCalculateKclExpression'
import { roundOff, roundOffWithUnits } from '@src/lib/utils'
import { varMentions } from '@src/lib/varCompletionExtension'
import type { Selections } from '@src/machines/modelingSharedTypes'
import {
  CODE_EDITOR_FOCUSED_COMMAND_SCOPE,
  CODE_EDITOR_NOT_FOCUSED_COMMAND_SCOPE,
  commandScopeService,
} from '@src/registry/contracts/commands'
import type { ReactNode } from 'react'
import {
  use,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import styles from './CommandKclInput.module.css'

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

export function CommandKclInput({
  name,
  arg,
  label,
  description,
  isRequired,
  disabled,
  value,
  nodeToEdit,
  variableName,
  selectionRanges,
  submittedValue,
  autoFocus,
  inline = false,
  onChange,
  onValidationChange,
}: {
  name: string
  arg: CommandKclArgument
  label: ReactNode
  description?: ReactNode
  isRequired: boolean
  disabled: boolean
  value: string
  nodeToEdit?: unknown
  variableName?: string
  selectionRanges: Selections
  submittedValue?: unknown
  autoFocus?: boolean
  inline?: boolean
  onChange: (change: CommandKclChange) => void
  onValidationChange: (state: CommandKclValidationState) => void
}) {
  useSignals()
  const { settings, wasmPromise, registry } = useApp()
  const { kclManager } = useSingletons()
  const wasmInstance = use(wasmPromise)
  const settingsValues = settings.useSettings()
  const inputId = `command-kcl-input-${name}`
  const labelId = `${inputId}-label`
  const editorWrapperRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onValidationChangeRef = useRef(onValidationChange)
  const lastReportedValueRef = useRef<unknown>(Symbol('initial-kcl-value'))
  const lastValidationStateRef = useRef<string>('')
  const isSyncingEditorValueRef = useRef(false)
  const compartmentsRef = useRef({
    theme: new Compartment(),
    varMentions: new Compartment(),
    editable: new Compartment(),
    contentAttributes: new Compartment(),
  })

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onValidationChangeRef.current = onValidationChange
  }, [onValidationChange])

  const initialVariableName = useMemo(() => {
    if (variableName !== undefined) {
      return variableName
    }

    return isKclCommandValue(submittedValue) && 'variableName' in submittedValue
      ? submittedValue.variableName
      : name
  }, [variableName, name, submittedValue])

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
  }, [nodeToEdit, kclManager.ast, wasmInstance])

  const completionSourceRange = useMemo<SourceRange>(
    () =>
      sourceRangeForPrevVariables ||
      selectionRanges.graphSelections[0]?.codeRef?.range || [
        kclManager.codeSignal.value.length,
        kclManager.codeSignal.value.length,
        kclManager.ast.moduleId,
      ],
    [
      kclManager.ast.moduleId,
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
  const initialEditorProps = useRef({
    value,
    disabled,
    labelId,
    autoFocus,
    theme: settingsValues.app.theme.current,
    varMentionData,
  })
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
    const initial = initialEditorProps.current
    const compartments = compartmentsRef.current
    const editor = new EditorView({
      state: EditorState.create({
        doc: initial.value,
        extensions: [
          compartments.theme.of(editorTheme[getResolvedTheme(initial.theme)]),
          compartments.varMentions.of(varMentions(initial.varMentionData)),
          compartments.editable.of([
            EditorState.readOnly.of(initial.disabled),
            EditorView.editable.of(!initial.disabled),
          ]),
          compartments.contentAttributes.of(
            getKclEditorContentAttributes(initial.labelId, initial.disabled)
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !isSyncingEditorValueRef.current) {
              onChangeRef.current({
                source: 'edit',
                value: update.state.doc.toString(),
              })
            }
          }),
          closeBrackets(),
          keymap.of([...closeBracketsKeymap, ...completionKeymap]),
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
          ]),
          EditorView.lineWrapping,
          tooltips({ parent: document.body }),
        ],
      }),
      parent: editorWrapperRef.current,
    })

    editorRef.current = editor
    if (initial.autoFocus && !initial.disabled) {
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
    const nextValidationState: CommandKclValidationState = {
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

  return (
    <div className={inline ? '' : 'flex flex-col gap-1'}>
      <label
        className={
          inline
            ? 'flex gap-4 items-center mx-4 my-4 border-b border-chalkboard-50'
            : 'flex flex-col gap-1'
        }
      >
        <span
          id={labelId}
          data-testid="cmd-bar-arg-name"
          className="capitalize text-chalkboard-80 dark:text-chalkboard-20"
        >
          {label}
          {!inline && isRequired && <span aria-hidden="true"> *</span>}
        </span>
        <div
          ref={editorWrapperRef}
          id={inputId}
          data-testid="cmd-bar-arg-value"
          className={inline ? styles.inlineEditor : styles.editor}
        />
        {(inline || !isEmpty) && (
          <span className="flex items-center gap-1 text-xs">
            <CustomIcon
              name="equal"
              className="w-4 h-4 text-chalkboard-70 dark:text-chalkboard-40"
            />
            <span
              className={
                validationMessage
                  ? 'text-destroy-80 dark:text-destroy-40'
                  : 'text-succeed-80 dark:text-succeed-40'
              }
            >
              {isExecuting ? (
                <Spinner className="w-4 h-4 text-inherit" />
              ) : arg.valueSummary && valueNode ? (
                arg.valueSummary(valueForSummary, wasmInstance)
              ) : calcResult === 'NAN' ? (
                "Can't calculate"
              ) : (
                roundOffWithUnits(calcResult, 4)
              )}
            </span>
          </span>
        )}
      </label>
      {description}
      {arg.createVariable !== 'disallow' && (
        <div
          className={
            inline
              ? 'flex items-baseline gap-4 mx-4'
              : 'flex flex-wrap items-baseline gap-2 text-xs'
          }
        >
          <input
            type="checkbox"
            id={`${inputId}-variable-checkbox`}
            data-testid="cmd-bar-variable-checkbox"
            checked={createNewVariable}
            disabled={disabled || arg.createVariable === 'force'}
            onChange={() => {
              onChange({ source: 'edit', value: resolvedKclValue ?? value })
              setCreateNewVariable((current) => !current)
            }}
          />
          <label htmlFor={`${inputId}-variable-checkbox`}>
            Create new variable
          </label>
          {createNewVariable && (
            <>
              <input
                type="text"
                id={`${inputId}-variable-name`}
                name={`${inputId}-variable-name`}
                aria-label="Variable name"
                className="min-w-0 flex-1 border-0 border-b border-chalkboard-50 bg-transparent focus:outline-none"
                placeholder="Variable name"
                value={newVariableName}
                disabled={disabled}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                spellCheck="false"
                autoFocus
                onChange={(event) => {
                  onChange({ source: 'edit', value: resolvedKclValue ?? value })
                  setHasEditedVariableName(true)
                  setNewVariableName(event.target.value)
                }}
                onKeyDown={(event) => {
                  if (
                    event.currentTarget.value === '' &&
                    event.key === 'Backspace' &&
                    arg.createVariable !== 'force'
                  ) {
                    onChange({
                      source: 'edit',
                      value: resolvedKclValue ?? value,
                    })
                    setCreateNewVariable(false)
                  }
                }}
              />
              <span
                className={
                  isNewVariableNameUnique
                    ? 'text-succeed-60 dark:text-succeed-40'
                    : 'text-destroy-60 dark:text-destroy-40'
                }
              >
                {isNewVariableNameUnique ? 'Available' : 'Unavailable'}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export type CommandKclChange = {
  source: 'edit' | 'calculation'
  // Keep the raw text while its expression is empty, invalid, or calculating.
  value: KclCommandValue | string
}

export type CommandKclValidationState = {
  canSubmit: boolean
  isChecking: boolean
  message?: string
}

export type CommandKclArgument = Extract<
  CommandArgument<unknown>,
  { inputType: 'kcl' }
>

export function getKclInputValue(
  arg: CommandKclArgument,
  value: unknown
): string {
  if (isKclCommandValue(value)) {
    return arg.kclValueToInput
      ? arg.kclValueToInput(value.valueText)
      : value.valueText
  }
  return typeof value === 'string' ? value : ''
}

function getKclSubmitValue(arg: CommandKclArgument, value: string): string {
  return arg.inputToKclValue ? arg.inputToKclValue(value.trim()) : value.trim()
}
