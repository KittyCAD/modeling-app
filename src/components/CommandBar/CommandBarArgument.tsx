import CommandArgOptionInput from '@src/components/CommandBar/CommandArgOptionInput'
import CommandBarBasicInput from '@src/components/CommandBar/CommandBarBasicInput'
import CommandBarDivider from '@src/components/CommandBar/CommandBarDivider'
import CommandBarHeaderFooter from '@src/components/CommandBar/CommandBarHeaderFooter'
import CommandBarKclInput from '@src/components/CommandBar/CommandBarKclInput'
import CommandBarPathInput from '@src/components/CommandBar/CommandBarPathInput'
import CommandBarSelectionInput from '@src/components/CommandBar/CommandBarSelectionInput'
import CommandBarSelectionMixedInput from '@src/components/CommandBar/CommandBarSelectionMixedInput'
import CommandBarTextareaInput from '@src/components/CommandBar/CommandBarTextareaInput'
import CommandBarVector3DInput from '@src/components/CommandBar/CommandBarVector3DInput'
import CommandBarVector2DInput from '@src/components/CommandBar/CommandBarVector2DInput'
import type { CommandArgument } from '@src/lib/commandTypes'
import { commandBarActor, useCommandBarState } from '@src/lib/singletons'

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

  function clear() {
    if (!currentArgument) return

    commandBarActor.send({
      type: 'Submit argument',
      data: {
        [currentArgument.name]: undefined,
      },
    })
  }

  return (
    currentArgument && (
      <CommandBarHeaderFooter stepBack={stepBack} clear={clear}>
        <ArgumentInput
          arg={currentArgument}
          stepBack={stepBack}
          onSubmit={onSubmit}
        />
        <CommandBarDivider />
      </CommandBarHeaderFooter>
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
  // @ts-ignore
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
    case 'path':
      return (
        <CommandBarPathInput
          arg={arg}
          stepBack={stepBack}
          onSubmit={onSubmit}
        />
      )
    case 'vector3d':
      return (
        <CommandBarVector3DInput
          arg={arg}
          stepBack={stepBack}
          onSubmit={onSubmit}
        />
      )
    case 'vector2d':
      return (
        <CommandBarVector2DInput
          arg={arg}
          stepBack={stepBack}
          onSubmit={onSubmit}
        />
      )
    case 'number':
      console.error("'number' input is not implemented for CommandBar yet")
      return (
        <CommandBarBasicInput
          arg={arg as any}
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
