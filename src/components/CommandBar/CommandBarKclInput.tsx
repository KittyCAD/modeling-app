import { Completion } from '@codemirror/autocomplete'
import {
  gutter,
  gutterLineClass,
  lineNumbers,
  useCodeMirror,
} from '@uiw/react-codemirror'
import { CustomIcon } from 'components/CustomIcon'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'
import { CommandArgument, KCLCommandValue } from 'lib/commandTypes'
import { getSystemTheme } from 'lib/theme'
import { useCalculateKclExpression } from 'lib/useCalculateKclExpression'
import { roundOff } from 'lib/utils'
import { varMentions } from 'lib/varCompletionExtension'
import { useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

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
  const defaultValue = (arg.defaultValue as KCLCommandValue) || { value: '' }
  const [value, setValue] = useState(defaultValue.value || '')
  useHotkeys('mod + k, mod + /', () => commandBarSend({ type: 'Close' }))
  const editorRef = useRef<HTMLInputElement>(null)

  const { prevVariables, calcResult } = useCalculateKclExpression({
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
      head: defaultValue.value.length,
    },
    accessKey: 'command-bar',
    theme:
      settings.context.theme === 'system'
        ? getSystemTheme()
        : settings.context.theme,
    extensions: [varMentions(varMentionData)],
    onChange: (newValue) => setValue(newValue),
  })

  useEffect(() => {
    if (editorRef.current) {
      setContainer(editorRef.current)
    }
  }, [arg, editorRef])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    onSubmit({
      key: '', // TODO: Allow user to specify a new variable name
      value,
    })
  }

  return (
    <form id="arg-form" onSubmit={handleSubmit}>
      <label className="flex items-center mx-4 my-4">
        <span className="capitalize px-2 py-0.5 rounded-l bg-chalkboard-100 dark:bg-chalkboard-80 text-chalkboard-10 border-b border-b-chalkboard-100 dark:border-b-chalkboard-80">
          {arg.name}
        </span>
        <div ref={editorRef} className="text-base flex-1" />
        <CustomIcon
          name="equal"
          className="w-5 h-5 text-chalkboard-70 dark:text-chalkboard-40"
        />
        <span
          className={
            calcResult === 'NAN' ? 'text-destroy-80 dark:text-destroy-40' : ''
          }
        >
          {calcResult}
        </span>
      </label>
    </form>
  )
}

export default CommandBarKclInput
