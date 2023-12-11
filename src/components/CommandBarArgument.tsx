import CommandArgOptionInput from './CommandArgOptionInput'
import CommandBarBasicInput from './CommandBarBasicInput'
import CommandBarSelectionInput from './CommandBarSelectionInput'
import { CommandArgument } from 'lib/commandTypes'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { CustomIcon } from './CustomIcon'

function CommandBarArgument() {
  const { commandBarState, commandBarSend } = useCommandsContext()
  const {
    context: { selectedCommand, currentArgument, argumentsToSubmit },
  } = commandBarState

  return (
    currentArgument && (
      <>
        <div className="px-4 text-sm flex flex-wrap gap-2">
          <p className="pr-4 flex gap-2 items-center">
            {selectedCommand &&
              'icon' in selectedCommand &&
              selectedCommand.icon && (
                <CustomIcon name={selectedCommand.icon} className="w-5 h-5" />
              )}
            {selectedCommand?.name}
          </p>
          {Object.entries(selectedCommand?.args || {}).map(
            ([argName, arg], i) => (
              <p
                key={argName}
                className={`w-fit px-2 py-1 rounded-sm flex gap-2 items-center border ${
                  argName === currentArgument.name
                    ? 'bg-energy-10/50 dark:bg-energy-10/20 border-energy-10 dark:border-energy-10'
                    : 'bg-chalkboard-20/50 dark:bg-chalkboard-80/50 border-chalkboard-20 dark:border-chalkboard-80'
                }`}
              >
                {argumentsToSubmit[argName] ? (
                  typeof argumentsToSubmit[argName] === 'object' ? (
                    JSON.stringify(argumentsToSubmit[argName])
                  ) : (
                    argumentsToSubmit[argName]
                  )
                ) : arg.payload ? (
                  typeof arg.payload === 'object' ? (
                    JSON.stringify(arg.payload)
                  ) : (
                    arg.payload
                  )
                ) : (
                  <em>{argName}</em>
                )}
              </p>
            )
          )}
        </div>
        <div className="block w-full my-2 h-[1px] bg-chalkboard-20 dark:bg-chalkboard-80" />
        <ArgumentInput
          arg={currentArgument}
          stepBack={() => commandBarSend({ type: 'Deselect command' })}
        />
      </>
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
