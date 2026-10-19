import type { Completion } from '@codemirror/autocomplete'
import {
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  completionStatus,
} from '@codemirror/autocomplete'
import { EditorView, keymap, placeholder, tooltips } from '@codemirror/view'
import type { ReactNode } from 'react'
import {
  use,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useSignals } from '@preact/signals-react/runtime'

import type { Node } from '@rust/kcl-lib/bindings/Node'

import { CustomIcon } from '@src/components/CustomIcon'
import { Spinner } from '@src/components/Spinner'
import {
  createLocalName,
  createVariableDeclaration,
  findUniqueName,
} from '@src/lang/create'
import type { KclManager } from '@src/lang/KclManager'
import { getNodeFromPath } from '@src/lang/queryAst'
import type { SourceRange, VariableDeclarator } from '@src/lang/wasm'
import { formatNumberValue, isPathToNode } from '@src/lang/wasm'
import type { AppSettingsSystem } from '@src/lib/app'
import type { CommandArgument, KclCommandValue } from '@src/lib/commandTypes'
import { isKclCommandValue } from '@src/lib/commandUtils'
import { getResolvedTheme } from '@src/lib/theme'
import { err } from '@src/lib/trap'
import { useCalculateKclExpression } from '@src/lib/useCalculateKclExpression'
import { roundOff, roundOffWithUnits } from '@src/lib/utils'
import { varMentions } from '@src/lib/varCompletionExtension'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

import { Compartment, EditorState } from '@codemirror/state'
import { editorTheme } from '@src/editor/plugins/theme'
import {
  noAutofillInputProps,
  setNoAutofillAttributes,
} from '@src/lib/autofill'
import type { Selections } from '@src/machines/modelingSharedTypes'
import {
  CODE_EDITOR_FOCUSED_COMMAND_SCOPE,
  CODE_EDITOR_NOT_FOCUSED_COMMAND_SCOPE,
  type CommandScopeService,
} from '@src/registry/contracts/commands'
import styles from './CommandKclInput.module.css'

function getKclEditorContentAttributes(labelId: string) {
  return EditorView.contentAttributes.of({
    'aria-labelledby': labelId,
    'aria-multiline': 'false',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
  })
}

export function CommandKclInput({
  kclManager,
  settings,
  wasmPromise,
  commandScopes,
  name,
  arg,
  label,
  labelAction,
  description,
  placeholder: placeholderText,
  isRequired = true,
  inline = true,
  value,
  nodeToEdit,
  variableName,
  selectionRanges,
  submittedValue,
  autoFocus,
  onChange,
  onValidationChange,
}: {
  kclManager: KclManager
  settings: AppSettingsSystem
  wasmPromise: Promise<ModuleType>
  commandScopes?: CommandScopeService
  name: string
  arg: CommandKclArgument
  label: ReactNode
  labelAction?: ReactNode
  description?: ReactNode
  placeholder?: string
  isRequired?: boolean
  inline?: boolean
  value: string
  nodeToEdit?: unknown
  variableName?: string
  selectionRanges: Selections
  submittedValue?: unknown
  autoFocus?: boolean
  onChange: (change: CommandKclChange) => void
  onValidationChange: (state: CommandKclValidationState) => void
}) {
  useSignals()
  const wasmInstance = use(wasmPromise)
  const settingsValues = settings.useSettings()
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

  const initialVariableName = useMemo(() => {
    if (variableName !== undefined) {
      return variableName
    }

    return isKclCommandValue(submittedValue) && 'variableName' in submittedValue
      ? submittedValue.variableName
      : name
  }, [variableName, name, submittedValue])
  const kclValue = useMemo(
    () =>
      arg.inputToKclValue ? arg.inputToKclValue(value.trim()) : value.trim(),
    [arg, value]
  )
  const [createNewVariable, setCreateNewVariable] = useState(
    (isKclCommandValue(submittedValue) && 'variableName' in submittedValue) ||
      arg.createVariable === 'byDefault' ||
      arg.createVariable === 'force' ||
      false
  )
  const [hasEditedVariableName, setHasEditedVariableName] = useState(false)
  const inputId = `command-kcl-input-${name}`
  const labelId = `${inputId}-label`
  const editorRef = useRef<HTMLDivElement>(null)
  const miniEditorRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onValidationChangeRef = useRef(onValidationChange)
  const lastReportedValueRef = useRef<unknown>(Symbol('initial-kcl-value'))
  const lastValidationStateRef = useRef<string>('')
  const isSyncingEditorValueRef = useRef(false)
  const compartmentsRef = useRef({
    theme: new Compartment(),
    varMentions: new Compartment(),
    contentAttributes: new Compartment(),
    placeholder: new Compartment(),
  })

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onValidationChangeRef.current = onValidationChange
  }, [onValidationChange])

  const allowBooleans = arg.allowBooleans ?? false
  const allowArrays = arg.allowArrays ?? false
  const allowStringArrays = arg.allowStringArrays ?? false
  const options = useMemo(
    () => ({ allowBooleans, allowArrays, allowStringArrays }),
    [allowBooleans, allowArrays, allowStringArrays]
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
    options,
  })

  const varMentionData: Completion[] = prevVariables.map((v) => {
    const roundedWithUnits = (() => {
      if (typeof v.value !== 'number' || !v.ty) {
        return undefined
      }
      const numWithUnits = formatNumberValue(v.value, v.ty, wasmInstance)
      if (err(numWithUnits)) {
        return undefined
      }
      return roundOffWithUnits(numWithUnits)
    })()
    return {
      label: v.key,
      detail: roundedWithUnits ?? String(roundOff(Number(v.value))),
    }
  })
  const varMentionsExtension = varMentions(varMentionData)
  const initialEditorProps = useRef({
    value,
    labelId,
    placeholderText,
    autoFocus,
    theme: settingsValues.app.theme.current,
    varMentionData,
  })

  useLayoutEffect(() => {
    if (!editorRef.current) {
      return
    }

    const initial = initialEditorProps.current
    const compartments = compartmentsRef.current
    const miniEditor = new EditorView({
      state: EditorState.create({
        doc: initial.value,
        extensions: [
          compartments.theme.of(editorTheme[getResolvedTheme(initial.theme)]),
          compartments.varMentions.of(varMentions(initial.varMentionData)),
          compartments.contentAttributes.of(
            getKclEditorContentAttributes(initial.labelId)
          ),
          compartments.placeholder.of(
            initial.placeholderText ? placeholder(initial.placeholderText) : []
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
              run: (editor) => {
                // Only submit if there is no completion active
                if (completionStatus(editor.state) !== null) return false
                editor.dom.closest('form')?.requestSubmit()
                return true
              },
            },
          ]),
          EditorView.lineWrapping,
          tooltips({ parent: document.body }),
        ],
      }),
      parent: editorRef.current,
    })

    setNoAutofillAttributes(editorRef.current)
    setNoAutofillAttributes(miniEditor.dom)
    setNoAutofillAttributes(miniEditor.contentDOM)
    miniEditorRef.current = miniEditor
    if (initial.autoFocus) {
      miniEditor.focus()
      miniEditor.dispatch({
        selection: { anchor: 0, head: miniEditor.state.doc.length },
      })
    }

    return () => {
      // Check focus before React removes this editor. Otherwise opening the
      // command palette can capture its stale editor scope after dismissal.
      if (miniEditor.dom.contains(document.activeElement)) {
        commandScopes?.removeScope(CODE_EDITOR_FOCUSED_COMMAND_SCOPE)
        commandScopes?.applyScope(CODE_EDITOR_NOT_FOCUSED_COMMAND_SCOPE)
      }
      miniEditor.destroy()
      miniEditorRef.current = null
    }
  }, [commandScopes])

  useEffect(() => {
    const miniEditor = miniEditorRef.current
    if (!miniEditor) {
      return
    }
    miniEditor.dispatch({
      effects: [
        compartmentsRef.current.varMentions.reconfigure(varMentionsExtension),
      ],
    })
  }, [varMentionsExtension])

  useEffect(() => {
    const miniEditor = miniEditorRef.current
    if (!miniEditor) {
      return
    }
    miniEditor.dispatch({
      effects: compartmentsRef.current.theme.reconfigure(
        editorTheme[getResolvedTheme(settingsValues.app.theme.current)]
      ),
    })
  }, [settingsValues.app.theme])

  useEffect(() => {
    const miniEditor = miniEditorRef.current
    if (!miniEditor) {
      return
    }
    miniEditor.dispatch({
      effects: [
        compartmentsRef.current.contentAttributes.reconfigure(
          getKclEditorContentAttributes(labelId)
        ),
        compartmentsRef.current.placeholder.reconfigure(
          placeholderText ? placeholder(placeholderText) : []
        ),
      ],
    })
  }, [labelId, placeholderText])

  useEffect(() => {
    const miniEditor = miniEditorRef.current
    if (!miniEditor) {
      return
    }

    const currentValue = miniEditor.state.doc.toString()
    if (currentValue === value) {
      return
    }

    isSyncingEditorValueRef.current = true
    try {
      miniEditor.dispatch({
        changes: {
          from: 0,
          to: miniEditor.state.doc.length,
          insert: value,
        },
      })
    } finally {
      isSyncingEditorValueRef.current = false
    }
  }, [value])

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

  const FieldContainer = labelAction ? 'div' : 'label'
  const fieldLabel = (
    <span
      id={labelId}
      data-testid="cmd-bar-arg-name"
      className="capitalize text-chalkboard-80 dark:text-chalkboard-20"
    >
      {label}
      {!inline && isRequired && <span aria-hidden="true"> *</span>}
    </span>
  )

  return (
    <div className={inline ? '' : 'flex flex-col gap-1'}>
      <FieldContainer
        className={
          inline
            ? 'flex gap-4 items-center mx-4 my-4 border-solid border-b border-chalkboard-50'
            : 'flex flex-col gap-1'
        }
      >
        {labelAction ? (
          <div className="flex items-center justify-between gap-1">
            {fieldLabel}
            {labelAction}
          </div>
        ) : (
          fieldLabel
        )}
        <div
          id={inputId}
          data-testid="cmd-bar-arg-value"
          ref={editorRef}
          className={inline ? styles.editor : styles.compactEditor}
        />
        {(inline || !isEmpty) && (
          <span
            className={inline ? 'contents' : 'flex items-center gap-1 text-xs'}
          >
            <CustomIcon
              name="equal"
              className={
                inline
                  ? 'w-5 h-5 text-chalkboard-70 dark:text-chalkboard-40'
                  : 'w-4 h-4 text-chalkboard-70 dark:text-chalkboard-40'
              }
            />
            <span
              className={
                calcResult === 'NAN'
                  ? 'text-destroy-80 dark:text-destroy-40'
                  : 'text-succeed-80 dark:text-succeed-40'
              }
            >
              {isExecuting === true || !calcResult ? (
                <Spinner className="text-inherit w-4 h-4" />
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
      </FieldContainer>
      {description}
      {arg.createVariable !== 'disallow' && (
        <div
          className={
            inline
              ? 'flex items-baseline gap-4 mx-4'
              : 'flex flex-wrap items-center gap-2 text-xs'
          }
        >
          <input
            type="checkbox"
            id={`${inputId}-variable-checkbox`}
            data-testid="cmd-bar-variable-checkbox"
            checked={createNewVariable}
            disabled={arg.createVariable === 'force'}
            onChange={(e) => {
              onChange({ source: 'edit', value: resolvedKclValue ?? value })
              setCreateNewVariable(e.target.checked)
            }}
            className={
              inline ? 'bg-chalkboard-10 dark:bg-chalkboard-80' : undefined
            }
          />
          <label
            htmlFor={`${inputId}-variable-checkbox`}
            className={
              inline
                ? 'text-blue border-none bg-transparent font-sm flex gap-1 items-center pl-0 pr-1'
                : undefined
            }
          >
            Create new variable
          </label>
          {createNewVariable && (
            <>
              <input
                {...noAutofillInputProps}
                type="text"
                id={`${inputId}-variable-name`}
                name={`${inputId}-variable-name`}
                aria-label="Variable name"
                className="min-w-0 flex-1 border-0 border-b border-chalkboard-50 bg-transparent focus:outline-none"
                placeholder="Variable name"
                value={newVariableName}
                autoFocus
                onChange={(e) => {
                  onChange({ source: 'edit', value: resolvedKclValue ?? value })
                  setHasEditedVariableName(true)
                  setNewVariableName(e.target.value)
                }}
                onKeyDown={(e) => {
                  if (
                    e.currentTarget.value === '' &&
                    e.key === 'Backspace' &&
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
