import { useCommandsContext } from 'hooks/useCommandsContext'
import CommandBarHeader from './CommandBarHeader'
import { useHotkeys } from 'react-hotkeys-hook'
import { ActionButton } from 'components/ActionButton'

function CommandBarReview({ stepBack }: { stepBack: () => void }) {
  const { commandBarState, commandBarSend } = useCommandsContext()
  const {
    context: { argumentsToSubmit, selectedCommand },
  } = commandBarState
  const optionalArgsNotAdded = Object.entries(
    selectedCommand?.args || {}
  ).filter(
    ([key, val]) =>
      selectedCommand?.args &&
      !selectedCommand.args[key].required &&
      !argumentsToSubmit[key]
  )

  useHotkeys('backspace', stepBack, {
    enableOnFormTags: true,
    enableOnContentEditable: true,
  })

  useHotkeys(
    '1, 2, 3, 4, 5, 6, 7, 8, 9, 0',
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
      <p className="px-4 py-1">Confirm {selectedCommand?.name}</p>
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
      {optionalArgsNotAdded.length > 0 && (
        <>
          <div className="block w-full my-2 h-[1px] bg-chalkboard-20 dark:bg-chalkboard-80" />
          <div className="flex flex-wrap px-4 gap-2 items-center">
            {optionalArgsNotAdded.map(([key, _]) => {
              const arg = selectedCommand?.args
                ? selectedCommand?.args[key]
                : undefined
              if (!arg) return null

              return (
                <ActionButton
                  Element="button"
                  key={key}
                  className="text-xs [&:not(:hover)]:border-transparent gap-0.5"
                  onClick={() => {
                    commandBarSend({
                      type: 'Edit argument',
                      data: { arg: { ...arg, name: key } },
                    })
                  }}
                  icon={{
                    icon: 'plus',
                    bgClassName: '!bg-transparent',
                    iconClassName:
                      'text-chalkboard-10 dark:text-chalkboard-100',
                  }}
                >
                  {key}
                </ActionButton>
              )
            })}
          </div>
        </>
      )}
    </CommandBarHeader>
  )
}

export default CommandBarReview
