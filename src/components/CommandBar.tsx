import { Combobox, Dialog, Transition } from '@headlessui/react'
import {
  Dispatch,
  Fragment,
  SetStateAction,
  createContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import Fuse from 'fuse.js'
import {
  CMD_BAR_STOP_EVENT_PREFIX,
  Command,
  CommandArgument,
  CommandArgumentOption,
} from '../lib/commands'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { CustomIcon } from './CustomIcon'

type ComboboxOption = Command | CommandArgumentOption
type CommandArgumentData = [string, any]

export const CommandsContext = createContext(
  {} as {
    commands: Command[]
    addCommands: (commands: Command[]) => void
    removeCommands: (commands: Command[]) => void
    commandBarOpen: boolean
    setCommandBarOpen: Dispatch<SetStateAction<boolean>>
    currentCommand?: Command
    setCurrentCommand: Dispatch<SetStateAction<Command | undefined>>
  }
)

export const CommandBarProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const [commands, internalSetCommands] = useState([] as Command[])
  const [commandBarOpen, setCommandBarOpen] = useState(false)
  const [currentCommand, setCurrentCommand] = useState<Command>()

  function sortCommands(a: Command, b: Command) {
    if (b.owner === 'auth') return -1
    if (a.owner === 'auth') return 1
    return a.name.localeCompare(b.name)
  }

  useEffect(() => {
    // If we are in a command bar stop state,
    // and set the current command to it
    // to gather up the necessary data for to execture the command.
    const foundCommandBarStopState = commands.find((c) =>
      c.name.includes(CMD_BAR_STOP_EVENT_PREFIX)
    )
    if (!foundCommandBarStopState) return

    console.log('command to be selected', foundCommandBarStopState)
    setCommandBarOpen(true)
    setCurrentCommand(foundCommandBarStopState)
  }, [commands])

  const addCommands = (newCommands: Command[]) => {
    internalSetCommands((prevCommands) =>
      [...newCommands, ...prevCommands].sort(sortCommands)
    )
  }
  const removeCommands = (newCommands: Command[]) => {
    internalSetCommands((prevCommands) =>
      prevCommands
        .filter((command) => !newCommands.includes(command))
        .sort(sortCommands)
    )
  }

  return (
    <CommandsContext.Provider
      value={{
        commands,
        addCommands,
        removeCommands,
        commandBarOpen,
        setCommandBarOpen,
        currentCommand,
        setCurrentCommand,
      }}
    >
      {children}
      <CommandBar />
    </CommandsContext.Provider>
  )
}

const CommandBar = () => {
  const {
    commands,
    commandBarOpen,
    setCommandBarOpen,
    currentCommand,
    setCurrentCommand,
  } = useCommandsContext()
  useHotkeys(['meta+k', 'meta+/'], () => {
    if (commands?.length === 0) return
    setCommandBarOpen(!commandBarOpen)
  })

  const [commandArguments, setCommandArguments] = useState<CommandArgument[]>(
    []
  )
  const [commandArgumentData, setCommandArgumentData] = useState<
    CommandArgumentData[]
  >([])
  const [commandArgumentIndex, setCommandArgumentIndex] = useState<number>(0)

  function clearState() {
    setCommandBarOpen(false)
    setCurrentCommand(undefined)
    setCommandArguments([])
    setCommandArgumentData([])
    setCommandArgumentIndex(0)
  }

  useEffect(() => {
    if (!currentCommand) return
    selectCommand(currentCommand)
  }, [currentCommand])

  function selectCommand(command: Command) {
    console.log('selecting command', command)
    if (!('args' in command && command.args?.length)) {
      submitCommand({ command })
    } else {
      setCommandArguments(command.args)
      setCurrentCommand(command)
    }
  }

  function stepBack() {
    if (!currentCommand) {
      clearState()
    } else {
      if (commandArgumentIndex === 0) {
        if (currentCommand.cancelCallback) currentCommand.cancelCallback()
        setCurrentCommand(undefined)
      } else {
        setCommandArgumentIndex((prevIndex) => Math.max(0, prevIndex - 1))
      }
      if (commandArgumentData.length > 0) {
        setCommandArgumentData((prevData) => prevData.slice(0, -1))
      }
    }
  }

  function appendCommandArgumentData(data: { name: any }) {
    const transformedData = [
      commandArguments[commandArgumentIndex].name,
      data.name,
    ]
    if (commandArgumentIndex + 1 === commandArguments.length) {
      submitCommand({
        dataArr: [
          ...commandArgumentData,
          transformedData,
        ] as CommandArgumentData[],
      })
    } else {
      setCommandArgumentData(
        (prevData) => [...prevData, transformedData] as CommandArgumentData[]
      )
      setCommandArgumentIndex((prevIndex) => prevIndex + 1)
    }
  }

  function submitCommand({
    command = currentCommand,
    dataArr = commandArgumentData,
  }) {
    console.log('submitting command', command, dataArr)
    if (dataArr.length === 0) {
      command?.callback()
    } else {
      const data = Object.fromEntries(dataArr)
      console.log('submitting data', data)
      command?.callback(data)
    }
    setCommandBarOpen(false)
  }

  function getDisplayValue(command: Command) {
    if (
      'args' in command &&
      command.args &&
      command.args?.length > 0 &&
      'formatFunction' in command &&
      command.formatFunction
    ) {
      command.formatFunction(
        command.args.map((c, i) =>
          commandArgumentData[i] ? commandArgumentData[i][0] : `<${c.name}>`
        )
      )
    }

    return command.name.replace(CMD_BAR_STOP_EVENT_PREFIX, '')
  }

  return (
    <Transition.Root
      show={commandBarOpen || false}
      afterLeave={() => {
        if (currentCommand?.cancelCallback) currentCommand.cancelCallback()
        clearState()
      }}
      as={Fragment}
    >
      <Dialog
        onClose={() => {
          setCommandBarOpen(false)
        }}
        className="fixed inset-0 z-40 overflow-y-auto pb-4 pt-1"
      >
        <Transition.Child
          enter="duration-100 ease-out"
          enterFrom="opacity-0 scale-95"
          enterTo="opacity-100 scale-100"
          leave="duration-75 ease-in"
          leaveFrom="opacity-100 scale-100"
          leaveTo="opacity-0 scale-95"
        >
          <Dialog.Panel
            className="relative w-full max-w-xl py-2 mx-auto border rounded shadow-lg bg-chalkboard-10 dark:bg-chalkboard-100 dark:border-chalkboard-70"
            as="div"
          >
            {!(
              commandArguments &&
              commandArguments.length &&
              currentCommand
            ) ? (
              <CommandComboBox
                options={commands}
                handleSelection={selectCommand}
                stepBack={stepBack}
              />
            ) : (
              <>
                <div className="px-4 text-sm flex flex-wrap gap-2">
                  <p className="pr-4 flex gap-2 items-center">
                    {currentCommand &&
                      'icon' in currentCommand &&
                      currentCommand.icon && (
                        <CustomIcon
                          name={currentCommand.icon}
                          className="w-5 h-5"
                        />
                      )}
                    {getDisplayValue(currentCommand)}
                  </p>
                  {commandArguments.map((arg, i) => (
                    <p
                      key={arg.name}
                      className={`w-fit px-2 py-1 rounded-sm flex gap-2 items-center border ${
                        i === commandArgumentIndex
                          ? 'bg-energy-10/50 dark:bg-energy-10/20 border-energy-10 dark:border-energy-10'
                          : 'bg-chalkboard-20/50 dark:bg-chalkboard-80/50 border-chalkboard-20 dark:border-chalkboard-80'
                      }`}
                    >
                      {commandArgumentIndex >= i && commandArgumentData[i] ? (
                        commandArgumentData[i][1]
                      ) : arg.defaultValue ? (
                        arg.defaultValue
                      ) : (
                        <em>{arg.name}</em>
                      )}
                    </p>
                  ))}
                </div>
                <div className="block w-full my-2 h-[1px] bg-chalkboard-20 dark:bg-chalkboard-80" />
                <Argument
                  arg={commandArguments[commandArgumentIndex]}
                  appendCommandArgumentData={appendCommandArgumentData}
                  stepBack={stepBack}
                />
              </>
            )}
          </Dialog.Panel>
        </Transition.Child>
      </Dialog>
    </Transition.Root>
  )
}

function Argument({
  arg,
  appendCommandArgumentData,
  stepBack,
}: {
  arg: CommandArgument
  appendCommandArgumentData: Dispatch<SetStateAction<any>>
  stepBack: () => void
}) {
  const { setCommandBarOpen } = useCommandsContext()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [arg, inputRef])

  return arg.type === 'select' ? (
    <CommandComboBox
      options={arg.options}
      handleSelection={appendCommandArgumentData}
      stepBack={stepBack}
      placeholder="Select an option"
    />
  ) : (
    <form
      onSubmit={(event) => {
        event.preventDefault()

        appendCommandArgumentData({ name: inputRef.current?.value })
      }}
    >
      <label className="flex items-center mx-4 my-4">
        <span className="px-2 py-1 rounded-l bg-chalkboard-100 dark:bg-chalkboard-80 text-chalkboard-10 border-b border-b-chalkboard-100 dark:border-b-chalkboard-80">
          {arg.name}
        </span>
        <input
          ref={inputRef}
          className="flex-grow px-2 py-1 border-b border-b-chalkboard-100 dark:border-b-chalkboard-80 !bg-transparent focus:outline-none"
          placeholder="Enter a value"
          defaultValue={arg.defaultValue}
          onKeyDown={(event) => {
            if (event.metaKey && event.key === 'k') setCommandBarOpen(false)
            if (event.key === 'Backspace' && !event.currentTarget.value) {
              stepBack()
            }
          }}
          autoFocus
        />
      </label>
    </form>
  )
}

export default CommandBarProvider

function CommandComboBox({
  options,
  handleSelection,
  stepBack,
  placeholder,
}: {
  options: ComboboxOption[]
  handleSelection: Dispatch<SetStateAction<any>>
  stepBack: () => void
  placeholder?: string
}) {
  const { setCommandBarOpen } = useCommandsContext()
  const [query, setQuery] = useState('')
  const [filteredOptions, setFilteredOptions] = useState<ComboboxOption[]>()

  const defaultOption =
    options.find((o) => 'isCurrent' in o && o.isCurrent) || null

  const fuse = new Fuse(options, {
    keys: ['name', 'description'],
    threshold: 0.3,
  })

  useEffect(() => {
    const results = fuse.search(query).map((result) => result.item)
    setFilteredOptions(query.length > 0 ? results : options)
  }, [query])

  return (
    <Combobox defaultValue={defaultOption} onChange={handleSelection}>
      <div className="flex items-center gap-2 px-4 pb-2 border-solid border-0 border-b border-b-chalkboard-20 dark:border-b-chalkboard-80">
        <CustomIcon
          name="search"
          className="w-5 h-5 bg-energy-10/50 dark:bg-chalkboard-90 dark:text-energy-10"
        />
        <Combobox.Input
          onChange={(event) => setQuery(event.target.value)}
          className="w-full bg-transparent focus:outline-none selection:bg-energy-10/50 dark:selection:bg-energy-10/20 dark:focus:outline-none"
          onKeyDown={(event) => {
            if (event.metaKey && event.key === 'k') setCommandBarOpen(false)
            if (event.key === 'Backspace' && !event.currentTarget.value) {
              stepBack()
            }
          }}
          placeholder={
            (defaultOption && defaultOption.name) ||
            placeholder ||
            'Search commands'
          }
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck="false"
          autoFocus
        />
      </div>
      <Combobox.Options
        static
        className="overflow-y-auto max-h-96 cursor-pointer"
      >
        {filteredOptions?.map((option) => (
          <Combobox.Option
            key={option.name}
            value={option}
            className="flex items-center gap-2 px-4 py-1 first:mt-2 last:mb-2 ui-active:bg-energy-10/50 dark:ui-active:bg-chalkboard-90"
          >
            {'icon' in option && option.icon && (
              <CustomIcon
                name={option.icon}
                className="w-5 h-5 dark:text-energy-10"
              />
            )}
            <p className="flex-grow">{option.name} </p>
            {'isCurrent' in option && option.isCurrent && (
              <small className="text-chalkboard-70 dark:text-chalkboard-50">
                current
              </small>
            )}
          </Combobox.Option>
        ))}
      </Combobox.Options>
    </Combobox>
  )
}
