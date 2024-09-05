import { useEngineCommands } from './EngineCommands'
import { Spinner } from './Spinner'
import { CustomIcon } from './CustomIcon'

export const ModelStateIndicator = () => {
  const [commands] = useEngineCommands()

  const lastCommand = commands[commands.length - 1]
  const lastCommandType = lastCommand?.type

  let className = 'w-6 h-6 '
  let icon = <Spinner className={className} />
  let dataTestId = 'model-state-indicator'

  if (lastCommandType === 'receive-reliable') {
    className +=
      'border-6 border border-solid border-chalkboard-60 dark:border-chalkboard-80 bg-chalkboard-20 dark:bg-chalkboard-80 !group-disabled:bg-chalkboard-30 !dark:group-disabled:bg-chalkboard-80 rounded-sm bg-succeed-10/30 dark:bg-succeed'
    icon = (
      <CustomIcon
        data-testid={dataTestId + '-receive-reliable'}
        name="checkmark"
      />
    )
  } else if (lastCommandType === 'execution-done') {
    className +=
      'border-6 border border-solid border-chalkboard-60 dark:border-chalkboard-80 bg-chalkboard-20 dark:bg-chalkboard-80 !group-disabled:bg-chalkboard-30 !dark:group-disabled:bg-chalkboard-80 rounded-sm bg-succeed-10/30 dark:bg-succeed'
    icon = (
      <CustomIcon
        data-testid={dataTestId + '-execution-done'}
        name="checkmark"
      />
    )
  } else if (lastCommandType === 'export-done') {
    className +=
      'border-6 border border-solid border-chalkboard-60 dark:border-chalkboard-80 bg-chalkboard-20 dark:bg-chalkboard-80 !group-disabled:bg-chalkboard-30 !dark:group-disabled:bg-chalkboard-80 rounded-sm bg-succeed-10/30 dark:bg-succeed'
    icon = (
      <CustomIcon data-testid={dataTestId + '-export-done'} name="checkmark" />
    )
  } else if (
    lastCommand?.type === 'send-scene' &&
    lastCommand.data.type === 'modeling_cmd_req' &&
    (lastCommand.data.cmd.type === 'camera_drag_start' ||
      lastCommand.data.cmd.type === 'camera_drag_end' ||
      lastCommand.data.cmd.type === 'default_camera_zoom')
  ) {
    className +=
      'border-6 border border-solid border-chalkboard-60 dark:border-chalkboard-80 bg-chalkboard-20 dark:bg-chalkboard-80 !group-disabled:bg-chalkboard-30 !dark:group-disabled:bg-chalkboard-80 rounded-sm bg-succeed-10/30 dark:bg-succeed'
    icon = (
      <CustomIcon data-testid={dataTestId + '-export-done'} name="checkmark" />
    )
  }

  return (
    <div className={className} data-testid="model-state-indicator">
      {icon}
    </div>
  )
}
