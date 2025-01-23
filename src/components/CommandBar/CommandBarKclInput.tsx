import {
  closeBrackets,
  closeBracketsKeymap,
  Completion,
  completionKeymap,
  completionStatus,
} from '@codemirror/autocomplete'
import { EditorView, keymap, ViewUpdate } from '@codemirror/view'
import { CustomIcon } from 'components/CustomIcon'
import { CommandArgument, KclCommandValue } from 'lib/commandTypes'
import { getSystemTheme } from 'lib/theme'
import { useCalculateKclExpression } from 'lib/useCalculateKclExpression'
import { roundOff } from 'lib/utils'
import { varMentions } from 'lib/varCompletionExtension'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import styles from './CommandBarKclInput.module.css'
import { createIdentifier, createVariableDeclaration } from 'lang/modifyAst'
import { useCodeMirror } from 'components/ModelingSidebar/ModelingPanes/CodeEditor'
import { useSelector } from '@xstate/react'
import { commandBarActor, useCommandBarState } from 'machines/commandBarMachine'
import { useSettings } from 'machines/appMachine'

const machineContextSelector = (snapshot?: {
  context: Record<string, unknown>
}) => snapshot?.context

function CommandBarKclInput({
  arg,
  stepBack,
  onSubmit,
}: {
  arg: CommandArgument<unknown> & {
    inputType: 'kcl'
    name: string
  }
  stepBack: () => void
  onSubmit: (event: unknown) => void
}) {
  const commandBarState = useCommandBarState()
  const previouslySetValue = commandBarState.context.argumentsToSubmit[
    arg.name
  ] as KclCommandValue | undefined
  const settings = useSettings()
  const argMachineContext = useSelector(
    arg.machineActor,
    machineContextSelector
  )
  const defaultValue = useMemo(
    () =>
      arg.defaultValue
        ? arg.defaultValue instanceof Function
          ? arg.defaultValue(commandBarState.context, argMachineContext)
          : arg.defaultValue
        : '',
    [arg.defaultValue, commandBarState.context, argMachineContext]
  )
  const initialVariableName = useMemo(() => {
    // Use the configured variable name if it exists
    if (arg.variableName !== undefined) {
      return arg.variableName instanceof Function
        ? arg.variableName(commandBarState.context, argMachineContext)
        : arg.variableName
    }
    // or derive it from the previously set value or the argument name
    return previouslySetValue && 'variableName' in previouslySetValue
      ? previouslySetValue.variableName
      : arg.name
  }, [
    arg.variableName,
    commandBarState.context,
    argMachineContext,
    arg.name,
    previouslySetValue,
  ])
  const [value, setValue] = useState(
    previouslySetValue?.valueText || defaultValue || ''
  )
  const [createNewVariable, setCreateNewVariable] = useState(
    (previouslySetValue && 'variableName' in previouslySetValue) ||
      arg.createVariableByDefault ||
      false
  )
  const [canSubmit, setCanSubmit] = useState(true)
  useHotkeys('mod + k, mod + /', () => commandBarActor.send({ type: 'Close' }))
  const editorRef = useRef<HTMLDivElement>(null)

  const {
    prevVariables,
    calcResult,
    newVariableInsertIndex,
    valueNode,
    newVariableName,
    setNewVariableName,
    isNewVariableNameUnique,
  } = useCalculateKclExpression({
    value,
    initialVariableName,
  })
  const varMentionData: Completion[] = prevVariables.map((v) => ({
    label: v.key,
    detail: String(roundOff(v.value as number)),
  }))
  const varMentionsExtension = varMentions(varMentionData)

  const { setContainer } = useCodeMirror({
    container: editorRef.current,
    initialDocValue: value,
    autoFocus: true,
    selection: {
      anchor: 0,
      head:
        previouslySetValue && 'valueText' in previouslySetValue
          ? previouslySetValue.valueText.length
          : defaultValue.length,
    },
    theme:
      settings.app.theme.current === 'system'
        ? getSystemTheme()
        : settings.app.theme.current,
    extensions: [
      varMentionsExtension,
      EditorView.updateListener.of((vu: ViewUpdate) => {
        if (vu.docChanged) {
          setValue(vu.state.doc.toString())
        }
      }),
      closeBrackets(),
      keymap.of([
        ...closeBracketsKeymap,
        ...completionKeymap,
        {
          key: 'Enter',
          run: (editor) => {
            // Only submit if there is no completion active
            if (completionStatus(editor.state) === null) {
              handleSubmit()
              return true
            } else {
              return false
            }
          },
        },
        {
          key: 'Backspace',
          run: (editor) => {
            // Only step back if the editor is empty
            if (editor.state.doc.toString() === '') {
              stepBack()
              return true
            }
            return false
          },
        },
      ]),
    ],
  })

  useEffect(() => {
    if (editorRef.current) {
      setContainer(editorRef.current)
    }
  }, [arg, editorRef])

  useEffect(() => {
    setCanSubmit(
      calcResult !== 'NAN' && (!createNewVariable || isNewVariableNameUnique)
    )
  }, [calcResult, createNewVariable, isNewVariableNameUnique])

  function handleSubmit(e?: React.FormEvent<HTMLFormElement>) {
    e?.preventDefault()
    if (!canSubmit || valueNode === null) return

    onSubmit(
      createNewVariable
        ? ({
            valueAst: valueNode,
            valueText: value,
            valueCalculated: calcResult,
            variableName: newVariableName,
            insertIndex: newVariableInsertIndex,
            variableIdentifierAst: createIdentifier(newVariableName),
            variableDeclarationAst: createVariableDeclaration(
              newVariableName,
              valueNode
            ),
          } satisfies KclCommandValue)
        : ({
            valueAst: valueNode,
            valueText: value,
            valueCalculated: calcResult,
          } satisfies KclCommandValue)
    )
  }

  return (
    <form id="arg-form" onSubmit={handleSubmit} data-can-submit={canSubmit}>
      <label className="flex gap-4 items-center mx-4 my-4 border-solid border-b border-chalkboard-50">
        <span
          data-testid="cmd-bar-arg-name"
          className="capitalize text-chalkboard-80 dark:text-chalkboard-20"
        >
          {arg.name}
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
          {calcResult === 'NAN'
            ? "Can't calculate"
            : roundOff(Number(calcResult), 4)}
        </span>
      </label>
      {createNewVariable ? (
        <div className="flex items-baseline gap-4 mx-4 border-solid border-0 border-b border-chalkboard-50">
          <label
            htmlFor="variable-name"
            className="text-base text-chalkboard-80 dark:text-chalkboard-20"
          >
            Variable name
          </label>
          <input
            type="text"
            id="variable-name"
            name="variable-name"
            className="flex-1 border-none bg-transparent focus:outline-none"
            placeholder="Variable name"
            value={newVariableName}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck="false"
            autoFocus
            onChange={(e) => setNewVariableName(e.target.value)}
            onKeyDown={(e) => {
              if (e.currentTarget.value === '' && e.key === 'Backspace') {
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
        </div>
      ) : (
        <div className="flex justify-between gap-2 px-4">
          <button
            onClick={() => setCreateNewVariable(true)}
            className="text-blue border-none bg-transparent font-sm flex gap-1 items-center pl-0 pr-1"
          >
            <CustomIcon name="plus" className="w-5 h-5" />
            Create new variable
          </button>
        </div>
      )}
    </form>
  )
}

export default CommandBarKclInput
