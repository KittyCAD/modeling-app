import { Combobox, Dialog } from '@headlessui/react'
import {
  Dispatch,
  SetStateAction,
  createContext,
  useContext,
  useState,
} from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { ActionIcon } from './ActionIcon'
import { faSearch } from '@fortawesome/free-solid-svg-icons'
import Fuse from 'fuse.js'
import { Command, SubCommand } from '../lib/commands'

export type SortedCommand = {
  item: Partial<Command | SubCommand> & { name: string }
}

export const CommandsContext = createContext(
  {} as {
    commands: Command[]
    setCommands: Dispatch<SetStateAction<Command[]>>
    commandBarOpen: boolean
    setCommandBarOpen: Dispatch<SetStateAction<boolean>>
  }
)

const CommandBar = () => {
  const { commands, commandBarOpen, setCommandBarOpen } =
    useContext(CommandsContext)
  useHotkeys('meta+k', () => setCommandBarOpen(!commandBarOpen))

  const [selectedCommand, setSelectedCommand] = useState<SortedCommand | null>(
    null
  )
  // keep track of the current subcommand index
  const [subCommandIndex, setSubCommandIndex] = useState<number>()
  const [subCommandData, setSubCommandData] = useState<{
    [key: string]: string
  }>({})

  // if the subcommand index is null, we're not in a subcommand
  const inSubCommand =
    selectedCommand &&
    'meta' in selectedCommand.item &&
    selectedCommand.item.meta?.args !== undefined &&
    subCommandIndex !== undefined
  const currentSubCommand =
    inSubCommand && 'meta' in selectedCommand.item
      ? selectedCommand.item.meta?.args[subCommandIndex]
      : undefined

  const [query, setQuery] = useState('')

  const availableCommands =
    inSubCommand && currentSubCommand
      ? currentSubCommand.type === 'string'
        ? query
          ? [{ name: query }]
          : currentSubCommand.options
        : currentSubCommand.options
      : commands

  const fuse = new Fuse(availableCommands || [], {
    keys: ['name', 'description'],
  })

  const filteredCommands = query
    ? fuse.search(query)
    : availableCommands?.map((c) => ({ item: c } as SortedCommand))

  function clearState() {
    setQuery('')
    setCommandBarOpen(false)
    setSelectedCommand(null)
    setSubCommandIndex(undefined)
    setSubCommandData({})
  }

  function handleCommandSelection(entry: SortedCommand) {
    // If we have subcommands and have not yet gathered all the
    // data required from them, set the selected command to the
    // current command and increment the subcommand index
    if (selectedCommand === null && 'meta' in entry.item && entry.item.meta) {
      setSelectedCommand(entry)
      setSubCommandIndex(0)
      setQuery('')
      return
    }

    const { item } = entry
    // If we have just selected a command with no subcommands, run it
    const isCommandWithoutSubcommands =
      'callback' in item && !('meta' in item && item.meta)
    if (isCommandWithoutSubcommands) {
      if (item.callback === undefined) return
      item.callback()
      clearState()
      return
    }

    // If we have subcommands and have not yet gathered all the
    // data required from them, set the selected command to the
    // current command and increment the subcommand index
    if (
      selectedCommand &&
      subCommandIndex !== undefined &&
      'meta' in selectedCommand.item
    ) {
      const subCommand = selectedCommand.item.meta?.args[subCommandIndex]

      if (subCommand) {
        const newSubCommandData = {
          ...subCommandData,
          [subCommand.name]: item.name,
        }
        const newSubCommandIndex = subCommandIndex + 1

        // If we have subcommands and have gathered all the data required
        // from them, run the command with the gathered data
        if (
          selectedCommand.item.callback &&
          selectedCommand.item.meta?.args.length === newSubCommandIndex
        ) {
          selectedCommand.item.callback(newSubCommandData)
          clearState()
        } else {
          // Otherwise, set the subcommand data and increment the subcommand index
          setSubCommandData(newSubCommandData)
          setSubCommandIndex(newSubCommandIndex)
          setQuery('')
        }
      }
    }
  }

  function getDisplayValue(command: Command) {
    if (command.meta?.displayValue === undefined || !command.meta.args)
      return command.name
    return command.meta?.displayValue(
      command.meta.args.map((c) =>
        subCommandData[c.name] ? subCommandData[c.name] : `<${c.name}>`
      )
    )
  }

  return (
    <Dialog
      open={
        commandBarOpen &&
        availableCommands?.length !== undefined &&
        availableCommands.length > 0
      }
      onClose={() => {
        setCommandBarOpen(false)
        clearState()
      }}
      className="relative z-50"
    >
      <Dialog.Backdrop className="fixed inset-0 bg-chalkboard-10/70 dark:bg-chalkboard-110/50" />
      <div className="fixed inset-0 flex items-center justify-center">
        <Dialog.Panel className="rounded-sm relative p-2 bg-chalkboard-10 dark:bg-chalkboard-100 border dark:border-chalkboard-70 max-w-xl w-full shadow-lg">
          <Combobox value={selectedCommand} onChange={handleCommandSelection}>
            <div className="flex gap-2 items-center">
              <ActionIcon icon={faSearch} size="xl" />
              <div>
                {inSubCommand && (
                  <p className="text-liquid-70 dark:text-liquid-30">
                    {selectedCommand.item &&
                      getDisplayValue(selectedCommand.item as Command)}
                  </p>
                )}
                <Combobox.Input
                  onChange={(event) => setQuery(event.target.value)}
                  className="bg-transparent focus:outline-none"
                  onKeyDown={(event) => {
                    if (event.metaKey && event.key === 'k')
                      setCommandBarOpen(false)
                    if (
                      inSubCommand &&
                      event.key === 'Backspace' &&
                      !event.currentTarget.value
                    ) {
                      setSubCommandIndex(subCommandIndex - 1)
                      setSelectedCommand(null)
                    }
                  }}
                  displayValue={(command: SortedCommand) =>
                    command !== null ? command.item.name : ''
                  }
                  placeholder={
                    inSubCommand
                      ? `Enter <${currentSubCommand?.name}>`
                      : 'Search for a command'
                  }
                  value={query}
                  autoCapitalize="off"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                />
              </div>
            </div>
            <Combobox.Options static className="max-h-96 overflow-y-auto">
              {filteredCommands?.map((commandResult) => (
                <Combobox.Option
                  key={commandResult.item.name}
                  value={commandResult}
                  className="first:mt-4 ui-active:bg-liquid-10 dark:ui-active:bg-liquid-90 py-1 px-2"
                >
                  <p>{commandResult.item.name}</p>
                  {(commandResult.item as SubCommand).description && (
                    <p className="mt-0.5 text-liquid-70 dark:text-liquid-30 text-sm">
                      {(commandResult.item as SubCommand).description}
                    </p>
                  )}
                </Combobox.Option>
              ))}
            </Combobox.Options>
          </Combobox>
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}

export default CommandBar
