import { CommandLog } from 'lang/std/engineConnection'
import { engineCommandManager } from 'lib/singletons'
import { reportRejection } from 'lib/trap'
import { useEffect, useState } from 'react'

export function useEngineCommands(): [CommandLog[], () => void] {
  const [engineCommands, setEngineCommands] = useState<CommandLog[]>(
    engineCommandManager.commandLogs
  )

  useEffect(() => {
    engineCommandManager.registerCommandLogCallback((commands) =>
      setEngineCommands(commands)
    )
  }, [])

  return [engineCommands, () => engineCommandManager.clearCommandLogs()]
}

export const EngineCommands = () => {
  const [engineCommands, clearEngineCommands] = useEngineCommands()
  const [containsFilter, setContainsFilter] = useState('')
  const [customCmd, setCustomCmd] = useState('')
  return (
    <div>
      <input
        className="text-gray-800 bg-slate-300 px-2"
        data-testid="filter-input"
        type="text"
        value={containsFilter}
        onChange={(e) => setContainsFilter(e.target.value)}
        placeholder="Filter"
      />
      <div className="max-w-xl max-h-36 overflow-auto">
        {engineCommands.map((command, index) => {
          const stringer = JSON.stringify(command)
          if (containsFilter && !stringer.includes(containsFilter)) return null
          return (
            <pre className="text-xs" key={index}>
              <code
                key={index}
                data-message-type={command.type}
                data-command-type={
                  (command.type === 'send-modeling' ||
                    command.type === 'send-scene') &&
                  command.data.type === 'modeling_cmd_req'
                    ? command?.data?.cmd?.type
                    : ''
                }
                data-command-id={
                  (command.type === 'send-modeling' ||
                    command.type === 'send-scene') &&
                  command.data.type === 'modeling_cmd_req'
                    ? command.data.cmd_id
                    : ''
                }
                data-receive-command-type={
                  command.type === 'receive-reliable' ? command.cmd_type : ''
                }
              >
                {JSON.stringify(command, null, 2)}
              </code>
            </pre>
          )
        })}
      </div>
      <button
        data-testid="clear-commands"
        onClick={() => clearEngineCommands()}
      >
        Clear
      </button>
      <br />
      <input
        className="text-gray-800 bg-slate-300 px-2"
        type="text"
        value={customCmd}
        onChange={(e) => setCustomCmd(e.target.value)}
        placeholder="JSON command"
        data-testid="custom-cmd-input"
      />
      <button
        data-testid="custom-cmd-send-button"
        onClick={() => {
          engineCommandManager
            .sendSceneCommand(JSON.parse(customCmd))
            .catch(reportRejection)
        }}
      >
        Send custom command
      </button>
    </div>
  )
}
