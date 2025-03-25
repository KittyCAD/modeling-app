import CommandArgOptionInput from '@src/components/CommandBar/CommandArgOptionInput'
import CommandBarBasicInput from '@src/components/CommandBar/CommandBarBasicInput'
import CommandBarHeader from '@src/components/CommandBar/CommandBarHeader'
import CommandBarKclInput from '@src/components/CommandBar/CommandBarKclInput'
import CommandBarSelectionInput from '@src/components/CommandBar/CommandBarSelectionInput'
import CommandBarSelectionMixedInput from '@src/components/CommandBar/CommandBarSelectionMixedInput'
import CommandBarTextareaInput from '@src/components/CommandBar/CommandBarTextareaInput'
import type { CommandArgument } from '@src/lib/commandTypes'
import {
  commandBarActor,
  useCommandBarState,
} from '@src/machines/commandBarMachine'

function CommandBarArgument({ stepBack }: { stepBack: () => void }) {
  const commandBarState = useCommandBarState()
  const {
    context: { currentArgument },
  } = commandBarState

  function onSubmit(data: unknown) {
    if (!currentArgument) return

    commandBarActor.send({
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
          arg={arg}
          argName={arg.displayName || arg.name}
          stepBack={stepBack}
          onSubmit={onSubmit}
          placeholder="Select an option"
        />
      )
    case 'boolean':
      return (
        <CommandArgOptionInput
          arg={{
            ...arg,
            inputType: 'options',
            options: [
              { name: 'On', value: true },
              { name: 'Off', value: false },
            ],
          }}
          argName={arg.displayName || arg.name}
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
    case 'selectionMixed':
      return (
        <CommandBarSelectionMixedInput
          arg={arg}
          stepBack={stepBack}
          onSubmit={onSubmit}
        />
      )
    case 'kcl':
      return (
        <CommandBarKclInput arg={arg} stepBack={stepBack} onSubmit={onSubmit} />
      )
    case 'text':
      return (
        <CommandBarTextareaInput
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
