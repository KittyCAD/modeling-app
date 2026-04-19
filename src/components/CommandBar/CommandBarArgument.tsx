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
import { useApp } from '@src/lib/boot'

function CommandBarArgument({ stepBack }: { stepBack: () => void }) {
  const { commands } = useApp()
  const commandBarState = commands.useState()
  const {
    context: { currentArgument },
  } = commandBarState

  function onSubmit(data: unknown) {
    if (!currentArgument) return

    commands.send({
      type: 'Submit argument',
      data: {
        [currentArgument.name]: data,
      },
    })
  }

  function clear() {
    if (!currentArgument) return

    commands.send({
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

function NoExecutingEditorWarning() {
  return (
    <p className="text-destroy-80">
      No executing editor, this command input cannot be used.
    </p>
  )
}

function ArgumentInput({
  arg,
  stepBack,
  onSubmit,
}: {
  arg: CommandArgument<unknown> & { name: string }
  stepBack: () => void
  onSubmit: (event: any) => void
}) {
  const app = useApp()
  const executingEditor = app.project?.executingEditor.value
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
      return executingEditor ? (
        <CommandBarSelectionInput
          arg={arg}
          stepBack={stepBack}
          onSubmit={onSubmit}
          executingEditor={executingEditor}
        />
      ) : (
        <NoExecutingEditorWarning />
      )

    case 'selectionMixed':
      return executingEditor ? (
        <CommandBarSelectionMixedInput
          arg={arg}
          stepBack={stepBack}
          onSubmit={onSubmit}
          executingEditor={executingEditor}
        />
      ) : (
        <NoExecutingEditorWarning />
      )

    case 'kcl':
      return executingEditor ? (
        <CommandBarKclInput
          arg={arg}
          stepBack={stepBack}
          onSubmit={onSubmit}
          executingEditor={executingEditor}
        />
      ) : (
        <NoExecutingEditorWarning />
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
      return executingEditor ? (
        <CommandBarVector3DInput
          arg={arg}
          stepBack={stepBack}
          onSubmit={onSubmit}
          executingEditor={executingEditor}
        />
      ) : (
        <NoExecutingEditorWarning />
      )
    case 'vector2d':
      return executingEditor ? (
        <CommandBarVector2DInput
          arg={arg}
          stepBack={stepBack}
          onSubmit={onSubmit}
          executingEditor={executingEditor}
        />
      ) : (
        <NoExecutingEditorWarning />
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
