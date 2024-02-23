import { useCommandsContext } from 'hooks/useCommandsContext'
import CommandBarHeader from './CommandBarHeader'
import { useHotkeys } from 'react-hotkeys-hook'

function CommandBarReview({ stepBack }: { stepBack: () => void }) {
  const { commandBarState, commandBarSend } = useCommandsContext()
  const {
    context: { argumentsToSubmit, selectedCommand },
  } = commandBarState

  useHotkeys('backspace', stepBack, {
    enableOnFormTags: true,
    enableOnContentEditable: true,
  })

  useHotkeys(
    [
      'alt+1',
      'alt+2',
      'alt+3',
      'alt+4',
      'alt+5',
      'alt+6',
      'alt+7',
      'alt+8',
      'alt+9',
      'alt+0',
    ],
    (_, b) => {
      if (b.keys && !Number.isNaN(parseInt(b.keys[0], 10))) {
        if (!selectedCommand?.args) return
        const argName = Object.keys(selectedCommand.args)[
          parseInt(b.keys[0], 10) - 1
        ]
        const arg = selectedCommand?.args[argName]
        commandBarSend({
          type: 'Edit argument',
          data: { arg: { ...arg, name: argName } },
        })
      }
    },
    { keyup: true, enableOnFormTags: true, enableOnContentEditable: true },
    [argumentsToSubmit, selectedCommand]
  )

  Object.keys(argumentsToSubmit).forEach((key, i) => {
    const arg = selectedCommand?.args ? selectedCommand?.args[key] : undefined
    if (!arg) return
  })

  function submitCommand() {
    commandBarSend({
      type: 'Submit command',
      data: argumentsToSubmit,
    })
  }

  return (
    <CommandBarHeader>
      <p className="px-4">Confirm {selectedCommand?.name}</p>
      <form
        id="review-form"
        className="absolute opacity-0 inset-0 pointer-events-none"
        onSubmit={submitCommand}
      >
        {Object.entries(argumentsToSubmit).map(([key, value], i) => {
          const arg = selectedCommand?.args
            ? selectedCommand?.args[key]
            : undefined
          if (!arg) return null

          return (
            <input
              id={key}
              name={key}
              key={key}
              type="text"
              defaultValue={
                typeof value === 'object'
                  ? JSON.stringify(value)
                  : (value as string)
              }
              hidden
            />
          )
        })}
      </form>
    </CommandBarHeader>
  )
}

export default CommandBarReview
