import { Combobox, Dialog, Popover, Transition } from '@headlessui/react'
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
import { useCommandsContext } from 'hooks/useCommandsContext'
import { CustomIcon } from './CustomIcon'
import { AllMachines } from 'hooks/useStateMachineCommands'
import CommandBarSelectionInput from './CommandBarSelectionInput'
import CommandBarBasicInput from './CommandBarBasicInput'
import { useMachine } from '@xstate/react'
import { commandBarMachine } from 'machines/commandBarMachine'
import { EventFrom, StateFrom } from 'xstate'
type CommandArgumentData = [string, any]

type CommandsContextType = {
  commandBarState: StateFrom<typeof commandBarMachine>
  commandBarSend: (event: EventFrom<typeof commandBarMachine>) => void
}

export const CommandsContext = createContext<CommandsContextType>({
  commandBarState: commandBarMachine.initialState,
  commandBarSend: () => {},
})

export const CommandBarProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const [commandBarState, commandBarSend] = useMachine(commandBarMachine, {
    guards: {
      'Arguments are ready': (context, _) => {
        return context.selectedCommand?.args
          ? context.argumentsToSubmit.length ===
              Object.keys(context.selectedCommand.args)?.length
          : false
      },
      'Command has no arguments': (
        _,
        event: EventFrom<typeof commandBarMachine>
      ) => {
        if (event.type !== 'Select command') return false
        return (
          !event.data.command.args ||
          Object.keys(event.data.command.args).length === 0
        )
      },
    },
    actions: {},
  })

  return (
    <CommandsContext.Provider
      value={{
        commandBarState,
        commandBarSend,
      }}
    >
      {children}
      <CommandBar />
    </CommandsContext.Provider>
  )
}

const CommandBar = () => {
  const { commandBarState, commandBarSend } = useCommandsContext()
  useHotkeys(['mod+k', 'mod+/'], () => {
    if (commands?.length === 0) return
    setCommandBarOpen(!commandBarOpen)
  })

  const [commandArguments, setCommandArguments] = useState<
    CommandArgument<AllMachines>[]
  >([])
  const [commandArgumentData, setCommandArgumentData] = useState<
    CommandArgumentData[]
  >([])
  const [commandArgumentIndex, setCommandArgumentIndex] = useState<number>(0)
  const isSelectionArgument =
    currentCommand?.args &&
    currentCommand.args[commandArgumentIndex]?.type === 'selection'
  const WrapperComponent = isSelectionArgument ? Popover : Dialog

  function clearState() {
    setCommandBarOpen(false)
    setCurrentCommand(undefined)
    setCommandArguments([])
    setCommandArgumentData([])
    setCommandArgumentIndex(0)
  }

  // TODO: This seems like a risky pattern, find a more reliable way.
  useEffect(() => {
    if (!currentCommand) return
    selectCommand(currentCommand)
  }, [currentCommand])

  function selectCommand(command: Command<AllMachines>) {
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
    console.log('appending data', data)
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

    if (!command?.keepCommandBarOpen) {
      setCommandBarOpen(false)
    }
  }

  function getDisplayValue(command: Command<AllMachines>) {
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
      <WrapperComponent
        onClose={() => {
          if (isSelectionArgument) return
          setCommandBarOpen(false)
        }}
        className={
          'fixed inset-0 z-40 overflow-y-auto pb-4 pt-1 ' +
          (isSelectionArgument ? 'pointer-events-none' : '')
        }
      >
        <Transition.Child
          enter="duration-100 ease-out"
          enterFrom="opacity-0 scale-95"
          enterTo="opacity-100 scale-100"
          leave="duration-75 ease-in"
          leaveFrom="opacity-100 scale-100"
          leaveTo="opacity-0 scale-95"
        >
          <WrapperComponent.Panel
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
                        typeof commandArgumentData[i][1] === 'object' ? (
                          JSON.stringify(commandArgumentData[i][1])
                        ) : (
                          commandArgumentData[i][1]
                        )
                      ) : arg.defaultValue ? (
                        typeof arg.defaultValue === 'object' ? (
                          JSON.stringify(arg.defaultValue)
                        ) : (
                          arg.defaultValue
                        )
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
          </WrapperComponent.Panel>
        </Transition.Child>
      </WrapperComponent>
    </Transition.Root>
  )
}

function Argument({
  arg,
  appendCommandArgumentData,
  stepBack,
}: {
  arg: CommandArgument<AllMachines>
  appendCommandArgumentData: Dispatch<SetStateAction<any>>
  stepBack: () => void
}) {
  switch (arg.type) {
    case 'select':
      return (
        <CommandComboBox
          options={arg.options}
          handleSelection={appendCommandArgumentData}
          stepBack={stepBack}
          placeholder="Select an option"
        />
      )
    case 'selection':
      return (
        <CommandBarSelectionInput
          arg={arg}
          appendCommandArgumentData={appendCommandArgumentData}
          stepBack={stepBack}
        />
      )
    default:
      return (
        <CommandBarBasicInput
          arg={arg}
          appendCommandArgumentData={appendCommandArgumentData}
          stepBack={stepBack}
        />
      )
  }
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
