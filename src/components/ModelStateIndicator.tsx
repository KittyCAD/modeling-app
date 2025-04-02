import { CustomIcon } from '@src/components/CustomIcon'
import { useEngineCommands } from '@src/components/EngineCommands'
import { Spinner } from '@src/components/Spinner'

export const ModelStateIndicator = () => {
  const [commands] = useEngineCommands()
  const lastCommandType = commands[commands.length - 1]?.type

  let className = 'w-6 h-6 '
  let icon = <Spinner className={className} />
  let dataTestId = 'model-state-indicator'

  if (lastCommandType === 'receive-reliable') {
    className +=
      'bg-chalkboard-20 dark:bg-chalkboard-80 !group-disabled:bg-chalkboard-30 !dark:group-disabled:bg-chalkboard-80 rounded-sm bg-succeed-10/30 dark:bg-succeed'
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
  }

  return (
    <div className={className} data-testid="model-state-indicator">
      {icon}
    </div>
  )
}
