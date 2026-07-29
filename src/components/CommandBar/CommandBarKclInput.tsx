import type { Completion } from '@codemirror/autocomplete'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { Compartment, EditorState } from '@codemirror/state'
import type { ViewUpdate } from '@codemirror/view'
import { EditorView, keymap } from '@codemirror/view'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import {
  createCommandBarKclInputKeymap,
  createCommandBarKclInputPendingEnterExtension,
} from '@src/components/CommandBar/commandBarKclInputKeymap'
import { CustomIcon } from '@src/components/CustomIcon'
import { Spinner } from '@src/components/Spinner'
import { editorTheme } from '@src/editor/plugins/theme'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { createLocalName, createVariableDeclaration } from '@src/lang/create'
import type { KclManager } from '@src/lang/KclManager'
import { getNodeFromPath } from '@src/lang/queryAst'
import type { SourceRange, VariableDeclarator } from '@src/lang/wasm'
import { formatNumberValue, isPathToNode } from '@src/lang/wasm'
import {
  noAutofillFormProps,
  noAutofillInputProps,
  setNoAutofillAttributes,
} from '@src/lib/autofill'
import { useApp } from '@src/lib/boot'
import type { CommandArgument, KclCommandValue } from '@src/lib/commandTypes'
import useHotkeyWrapper from '@src/lib/hotkeyWrapper'
import { getResolvedTheme } from '@src/lib/theme'
import { err } from '@src/lib/trap'
import { useCalculateKclExpression } from '@src/lib/useCalculateKclExpression'
import { roundOff, roundOffWithUnits } from '@src/lib/utils'
import { varMentions } from '@src/lib/varCompletionExtension'
import { useSelector } from '@xstate/react'
import { use, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import type { AnyStateMachine, SnapshotFrom } from 'xstate'
import styles from './CommandBarKclInput.module.css'

// TODO: remove the need for this selector once we decouple all actors from React
const machineContextSelector = (snapshot?: SnapshotFrom<AnyStateMachine>) =>
  snapshot?.context

function CommandBarKclInput({
  arg,
  stepBack,
  onSubmit,
  executingEditor: kclManager,
}: {
  arg: CommandArgument<unknown> & {
    inputType: 'kcl'
    name: string
  }
  stepBack: () => void
  onSubmit: (event: unknown) => void
  executingEditor: KclManager
}) {
  const { commands, settings, wasmPromise } = useApp()
  const wasmInstance = use(wasmPromise)
  const commandBarState = commands.useState()
  const previouslySetValue = commandBarState.context.argumentsToSubmit[
    arg.name
  ] as KclCommandValue | undefined
  const settingsValues = settings.useSettings()
  const {
    context: { selectionRanges },
  } = useModelingContext()
  const argMachineContext = useSelector(
    arg.machineActor,
    machineContextSelector
  )
  const sourceRangeForPrevVariables = useMemo<SourceRange | undefined>(() => {
    const nodeToEdit = commandBarState.context.argumentsToSubmit.nodeToEdit
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [kclManager.ast, commandBarState.context.argumentsToSubmit.nodeToEdit])
  const defaultValue = useMemo(
    () =>
      arg.defaultValue
        ? arg.defaultValue instanceof Function
          ? arg.defaultValue(
              commandBarState.context,
              argMachineContext,
              wasmInstance
            )
          : arg.defaultValue
        : '',
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    [
      arg.defaultValue,
      commandBarState.context,
      argMachineContext,
      argMachineContext,
      wasmInstance,
    ]
  )
  const initialVariableName = useMemo(() => {
    // Use the configured variable name if it exists
    if (arg.variableName !== undefined) {
      return arg.variableName instanceof Function
        ? arg.variableName(commandBarState.context, argMachineContext)
        : arg.variableName
    }
    // or derive it from the previously set value or the argument name
    return typeof previouslySetValue === 'object' &&
      'variableName' in previouslySetValue
      ? previouslySetValue.variableName
      : arg.name
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [
    arg.variableName,
    commandBarState.context,
    argMachineContext,
    arg.name,
    previouslySetValue,
  ])
  const initialValue = useMemo(() => {
    const kclValue = previouslySetValue?.valueText || defaultValue || ''
    return arg.kclValueToInput ? arg.kclValueToInput(kclValue) : kclValue
  }, [arg, previouslySetValue, defaultValue])
  const [value, setValue] = useState(initialValue)
  const kclValue = useMemo(
    () => (arg.inputToKclValue ? arg.inputToKclValue(value) : value),
    [arg, value]
  )
  const [createNewVariable, setCreateNewVariable] = useState(
    (typeof previouslySetValue === 'object' &&
      'variableName' in previouslySetValue) ||
      arg.createVariable === 'byDefault' ||
      arg.createVariable === 'force' ||
      false
  )
  const [canSubmit, setCanSubmit] = useState(true)
  useHotkeyWrapper(
    ['esc'],
    () => commands.send({ type: 'Close' }),
    kclManager,
    { enableOnFormTags: true, enableOnContentEditable: true }
  )
  const editorRef = useRef<HTMLDivElement>(null)
  const miniEditorRef = useRef<EditorView | null>(null)
  const handleSubmitRef = useRef(handleSubmit)
  handleSubmitRef.current = handleSubmit
  const editorCompartments = useMemo(
    () => ({
      keymap: new Compartment(),
      theme: new Compartment(),
      varMentions: new Compartment(),
    }),
    []
  )

  const allowArrays = arg.allowArrays ?? false
  const allowStringArrays = arg.allowStringArrays ?? false
  const options = useMemo(
    () => ({ allowArrays, allowStringArrays }),
    [allowArrays, allowStringArrays]
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
    sourceRange: sourceRangeForPrevVariables,
    selectionRanges,
    rustContext: kclManager.rustContext,
    code: kclManager.codeSignal.value,
    ast: kclManager.astSignal.value,
    variables: kclManager.variablesSignal.value,
    options,
  })

  const varMentionData = useMemo<Completion[]>(
    () =>
      prevVariables.map((v) => {
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
      }),
    [prevVariables, wasmInstance]
  )
  const varMentionsExtension = useMemo(
    () =>
      varMentions(varMentionData, {
        activateOnTypingDelay: 0,
        interactionDelay: 0,
      }),
    [varMentionData]
  )

  useEffect(() => {
    if (!editorRef.current) return
    const miniEditor = new EditorView({
      state: EditorState.create({
        extensions: [
          editorCompartments.theme.of([]),
          editorCompartments.varMentions.of([]),
          closeBrackets(),
          keymap.of(closeBracketsKeymap),
          editorCompartments.keymap.of([]),
          createCommandBarKclInputPendingEnterExtension({
            onSubmit: () => handleSubmitRef.current(),
          }),
          EditorView.updateListener.of((vu: ViewUpdate) => {
            if (vu.docChanged) {
              setValue(vu.state.doc.toString())
            }
          }),
        ],
      }),
      parent: editorRef.current,
    })
    miniEditorRef.current = miniEditor
    setNoAutofillAttributes(editorRef.current)
    setNoAutofillAttributes(miniEditor.dom)
    setNoAutofillAttributes(miniEditor.contentDOM)

    return () => {
      miniEditor.destroy()
      miniEditorRef.current = null
    }
  }, [editorCompartments])

  useEffect(() => {
    const miniEditor = miniEditorRef.current
    if (!miniEditor) return
    miniEditor.dispatch({
      effects: [
        editorCompartments.keymap.reconfigure(
          keymap.of(
            createCommandBarKclInputKeymap({
              onSubmit: handleSubmit,
              stepBack,
            })
          )
        ),
      ],
    })
  })

  useEffect(() => {
    const miniEditor = miniEditorRef.current
    if (!miniEditor) return
    miniEditor.dispatch({
      effects: [
        editorCompartments.varMentions.reconfigure(varMentionsExtension),
      ],
    })
  }, [editorCompartments.varMentions, varMentionsExtension])

  useEffect(() => {
    const miniEditor = miniEditorRef.current
    if (!miniEditor) return
    miniEditor.dispatch({
      effects: editorCompartments.theme.reconfigure(
        editorTheme[getResolvedTheme(settingsValues.app.theme.current)]
      ),
    })
  }, [editorCompartments.theme, settingsValues.app.theme])

  useEffect(() => {
    const miniEditor = miniEditorRef.current
    if (!miniEditor) return
    miniEditor.dispatch({
      changes: {
        from: 0,
        to: miniEditor.state.doc.length,
        insert: initialValue,
      },
      selection: {
        anchor: 0,
        head: initialValue.length,
      },
    })
    miniEditor.focus()
  }, [arg, initialValue])

  useEffect(() => {
    const canUseUncalculatedValue =
      Boolean(arg.allowUncalculated) && valueNode !== null
    setCanSubmit(
      (calcResult !== 'NAN' || canUseUncalculatedValue) &&
        (!createNewVariable || isNewVariableNameUnique) &&
        !isExecuting
    )
  }, [
    arg.allowUncalculated,
    calcResult,
    createNewVariable,
    isNewVariableNameUnique,
    isExecuting,
    valueNode,
  ])

  function handleSubmit(e?: React.FormEvent<HTMLFormElement>) {
    e?.preventDefault()
    if (!canSubmit || valueNode === null) {
      // Gotcha: Our application can attempt to submit a command value before the command bar kcl input is ready. Notify the scene and user.
      if (!canSubmit) {
        toast.error('Unable to submit command.')
      } else if (valueNode === null) {
        toast.error('Unable to submit undefined command value.')
      }
      return
    }

    onSubmit(
      createNewVariable
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
    )
  }

  return (
    <form
      {...noAutofillFormProps}
      id="arg-form"
      className="mb-2"
      onSubmit={handleSubmit}
      data-can-submit={canSubmit}
    >
      <label className="flex gap-4 items-center mx-4 my-4 border-solid border-b border-chalkboard-50">
        <span
          data-testid="cmd-bar-arg-name"
          className="capitalize text-chalkboard-80 dark:text-chalkboard-20"
        >
          {arg.displayName || arg.name}
        </span>
        <div
          data-testid="cmd-bar-arg-value"
          ref={editorRef}
          className={styles.editor}
        />
        <CustomIcon
          name="equal"
          className="w-5 h-5 text-chalkboard-70 dark:text-chalkboard-40"
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
            arg.valueSummary({
              valueAst: valueNode,
              valueText: kclValue,
              valueCalculated: calcResult,
            })
          ) : calcResult === 'NAN' ? (
            "Can't calculate"
          ) : (
            roundOffWithUnits(calcResult, 4)
          )}
        </span>
      </label>
      {arg.createVariable !== 'disallow' && (
        <div className="flex items-baseline gap-4 mx-4">
          <input
            type="checkbox"
            id="variable-checkbox"
            data-testid="cmd-bar-variable-checkbox"
            checked={createNewVariable}
            onChange={(e) => {
              setCreateNewVariable(e.target.checked)
            }}
            className="bg-chalkboard-10 dark:bg-chalkboard-80"
          />
          <label
            htmlFor="variable-checkbox"
            className="text-blue border-none bg-transparent font-sm flex gap-1 items-center pl-0 pr-1"
          >
            Create new variable
          </label>
          {createNewVariable && (
            <>
              <input
                {...noAutofillInputProps}
                type="text"
                id="variable-name"
                name="variable-name"
                className="flex-1  border-solid border-0 border-b border-chalkboard-50 bg-transparent focus:outline-none"
                placeholder="Variable name"
                value={newVariableName}
                autoFocus
                onChange={(e) => setNewVariableName(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.currentTarget.value === '' &&
                    e.key === 'Backspace' &&
                    arg.createVariable !== 'force'
                  ) {
                    setCreateNewVariable(false)
                  }
                }}
                onKeyUp={(e) => {
                  if (e.key === 'Enter' && canSubmit) {
                    handleSubmit()
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
    </form>
  )
}

export default CommandBarKclInput
