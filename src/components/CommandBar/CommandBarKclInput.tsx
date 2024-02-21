import { Completion } from '@codemirror/autocomplete'
import { EditorState, useCodeMirror } from '@uiw/react-codemirror'
import { CustomIcon } from 'components/CustomIcon'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'
import { CommandArgument, KclCommandValue } from 'lib/commandTypes'
import { getSystemTheme } from 'lib/theme'
import { useCalculateKclExpression } from 'lib/useCalculateKclExpression'
import { roundOff } from 'lib/utils'
import { varMentions } from 'lib/varCompletionExtension'
import { useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import styles from './CommandBarKclInput.module.css'
import { createIdentifier, createVariableDeclaration } from 'lang/modifyAst'

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
  const { commandBarSend } = useCommandsContext()
  const { settings } = useGlobalStateContext()
  const defaultValue = (arg.defaultValue as string) || ''
  const [value, setValue] = useState(defaultValue || '')
  const [createNewVariable, setCreateNewVariable] = useState(false)
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
    initialVariableName: arg.name,
  })
  const varMentionData: Completion[] = prevVariables.map((v) => ({
    label: v.key,
    detail: String(roundOff(v.value as number)),
  }))

  const { setContainer } = useCodeMirror({
    container: editorRef.current,
    value,
    indentWithTab: false,
    basicSetup: false,
    autoFocus: true,
    selection: {
      anchor: 0,
      head: defaultValue.length,
    },
    accessKey: 'command-bar',
    theme:
      settings.context.theme === 'system'
        ? getSystemTheme()
        : settings.context.theme,
    extensions: [
      varMentions(varMentionData),
      EditorState.transactionFilter.of((tr) => {
        if (tr.newDoc.lines > 1) {
          handleSubmit()
          return []
        }
        return tr
      }),
    ],
    onChange: (newValue) => setValue(newValue),
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
            variableDeclarationAst: createVariableDeclaration(newVariableName, valueNode),
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
              : 'text-energy-60 dark:text-energy-20'
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
            className="flex-1 border-none bg-transparent"
            placeholder="Variable name"
            value={newVariableName}
            onChange={(e) => setNewVariableName(e.target.value)}
            onKeyDown={(e) => {
              if (e.currentTarget.value === '' && e.key === 'Backspace') {
                setCreateNewVariable(false)
              }
            }}
          />
          <span
            className={
              isNewVariableNameUnique
                ? 'text-energy-60 dark:text-energy-20'
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
