import CommandArgOptionInput from './CommandArgOptionInput'
import CommandBarBasicInput from './CommandBarBasicInput'
import CommandBarSelectionInput from './CommandBarSelectionInput'
import { CommandArgument } from 'lib/commandTypes'
import { useCommandsContext } from 'hooks/useCommandsContext'
import CommandBarHeader from './CommandBarHeader'
import CommandBarKclInput from './CommandBarKclInput'

function CommandBarArgument({ stepBack }: { stepBack: () => void }) {
  const { commandBarState, commandBarSend } = useCommandsContext()
  const {
    context: { currentArgument },
  } = commandBarState

  function onSubmit(data: unknown) {
    if (!currentArgument) return

    commandBarSend({
      type: 'Submit argument',
      data: {
        [currentArgument.name]: data,
      },
    })
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
    case 'kcl':
      return (
        <CommandBarKclInput arg={arg} stepBack={stepBack} onSubmit={onSubmit} />
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
