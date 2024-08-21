import { Completion } from '@codemirror/autocomplete'
import { EditorView, ViewUpdate } from '@codemirror/view'
import { CustomIcon } from 'components/CustomIcon'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { CommandArgument, KclCommandValue } from 'lib/commandTypes'
import { getSystemTheme } from 'lib/theme'
import { useCalculateKclExpression } from 'lib/useCalculateKclExpression'
import { roundOff } from 'lib/utils'
import { varMentions } from 'lib/varCompletionExtension'
import { useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import styles from './CommandBarKclInput.module.css'
import { createIdentifier, createVariableDeclaration } from 'lang/modifyAst'
import { useCodeMirror } from 'components/ModelingSidebar/ModelingPanes/CodeEditor'

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
  const { commandBarSend, commandBarState } = useCommandsContext()
  const previouslySetValue = commandBarState.context.argumentsToSubmit[
    arg.name
  ] as KclCommandValue | undefined
  const { settings } = useSettingsAuthContext()
  const defaultValue = (arg.defaultValue as string) || ''
  const [value, setValue] = useState(
    previouslySetValue?.valueText || defaultValue || ''
  )
  const [createNewVariable, setCreateNewVariable] = useState(
    previouslySetValue && 'variableName' in previouslySetValue
  )
  const [canSubmit, setCanSubmit] = useState(true)
  useHotkeys('mod + k, mod + /', () => commandBarSend({ type: 'Close' }))
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
    initialVariableName:
      previouslySetValue && 'variableName' in previouslySetValue
        ? previouslySetValue.variableName
        : arg.name,
  })
  const varMentionData: Completion[] = prevVariables.map((v) => ({
    label: v.key,
    detail: String(roundOff(v.value as number)),
  }))

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
      settings.context.app.theme.current === 'system'
        ? getSystemTheme()
        : settings.context.app.theme.current,
    extensions: [
      EditorView.domEventHandlers({
        keydown: (event) => {
          if (event.key === 'Backspace' && value === '') {
            event.preventDefault()
            stepBack()
          } else if (event.key === 'Enter') {
            event.preventDefault()
            handleSubmit()
          }
        },
      }),
      varMentions(varMentionData),
      EditorView.updateListener.of((vu: ViewUpdate) => {
        if (vu.docChanged) {
          setValue(vu.state.doc.toString())
        }
      }),
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
        <span className="capitalize text-chalkboard-80 dark:text-chalkboard-20">
          {arg.name}
        </span>
        <div ref={editorRef} className={styles.editor} />
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
              if (e.key === 'Enter') {
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
