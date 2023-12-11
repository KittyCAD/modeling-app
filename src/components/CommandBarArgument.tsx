import CommandArgOptionInput from './CommandArgOptionInput'
import CommandBarBasicInput from './CommandBarBasicInput'
import CommandBarSelectionInput from './CommandBarSelectionInput'
import { CommandArgument } from 'lib/commandTypes'
import { useCommandsContext } from 'hooks/useCommandsContext'
import CommandBarHeader from './CommandBarHeader'

function CommandBarArgument() {
  const { commandBarState, commandBarSend } = useCommandsContext()
  const {
    context: { currentArgument },
  } = commandBarState

  return (
    currentArgument && (
      <CommandBarHeader>
        <ArgumentInput
          arg={currentArgument}
          stepBack={() => commandBarSend({ type: 'Deselect command' })}
        />
      </CommandBarHeader>
    )
  )
}

export default CommandBarArgument

function ArgumentInput({
  arg,
  stepBack,
}: {
  arg: CommandArgument<unknown> & { name: string }
  stepBack: () => void
}) {
  switch (arg.inputType) {
    case 'options':
      return (
        <CommandArgOptionInput
          options={arg.options}
          argName={arg.name}
          stepBack={stepBack}
          placeholder="Select an option"
        />
      )
    case 'selection':
      return <CommandBarSelectionInput arg={arg} stepBack={stepBack} />
    default:
      return <CommandBarBasicInput arg={arg} stepBack={stepBack} />
  }
}
