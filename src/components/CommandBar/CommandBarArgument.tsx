import CommandArgOptionInput from './CommandArgOptionInput'
import CommandBarBasicInput from './CommandBarBasicInput'
import CommandBarSelectionInput from './CommandBarSelectionInput'
import { CommandArgument } from 'lib/commandTypes'
import { useCommandsContext } from 'hooks/useCommandsContext'
import CommandBarHeader from './CommandBarHeader'

function CommandBarArgument() {
  const { commandBarState, commandBarSend } = useCommandsContext()
  const {
    context: { currentArgument, selectedCommand },
  } = commandBarState

  function onSubmit(data: unknown) {
    if (!currentArgument) return

    commandBarSend({
      type: 'Submit argument',
      data: {
        [currentArgument.name]:
          currentArgument.inputType === 'number'
            ? parseFloat((data as string) || '0')
            : data,
      },
    })
  }

  function stepBack() {
    if (!selectedCommand?.args || !currentArgument) {
      commandBarSend({ type: 'Deselect command' })
    } else {
      const entries = Object.entries(selectedCommand.args || {})
      const index = entries.findIndex(
        ([key, _]) => key === currentArgument.name
      )

      if (index === 0) {
        commandBarSend({ type: 'Deselect command' })
      } else {
        commandBarSend({
          type: 'Edit argument',
          data: { arg: { name: entries[index][0], ...entries[index][1] } },
        })
      }
    }
  }

  return (
    currentArgument && (
      <CommandBarHeader>
        <ArgumentInput
          arg={currentArgument}
          stepBack={stepBack}
          onSubmit={onSubmit}
        />
      </CommandBarHeader>
    )
  )
}

export default CommandBarArgument

function ArgumentInput({
  arg,
  stepBack,
  onSubmit,
}: {
  arg: CommandArgument<unknown> & { name: string }
  stepBack: () => void
  onSubmit: (event: any) => void
}) {
  switch (arg.inputType) {
    case 'options':
      return (
        <CommandArgOptionInput
          options={arg.options}
          argName={arg.name}
          stepBack={stepBack}
          onSubmit={onSubmit}
          placeholder="Select an option"
        />
      )
    case 'selection':
      return (
        <CommandBarSelectionInput
          arg={arg}
          stepBack={stepBack}
          onSubmit={onSubmit}
        />
      )
    default:
      return (
        <CommandBarBasicInput
          arg={arg}
          stepBack={stepBack}
          onSubmit={onSubmit}
        />
      )
  }
}
