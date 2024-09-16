import { useEngineCommands } from './EngineCommands'
import { CustomIcon } from './CustomIcon'
import useEngineStreamContext, { EngineStreamState } from 'hooks/useEngineStreamContext'

export const ModelStateIndicator = () => {
  const [commands] = useEngineCommands()

  const engineStreamActor = useEngineStreamContext.useActorRef()
  const engineStreamState = engineStreamActor.getSnapshot()

  const lastCommandType = commands[commands.length - 1]?.type

  let className = 'w-6 h-6 '
  let icon = <div className={className}></div>
  let dataTestId = 'model-state-indicator'

  if (engineStreamState.value === EngineStreamState.Paused) {
    className +=
      'text-secondary'
    icon = (
      <CustomIcon
        data-testid={dataTestId + '-paused'}
        name="parallel"
      />
    )
  } else if (engineStreamState.value === EngineStreamState.Resuming) {
    className +=
      'text-secondary'
    icon = (
      <CustomIcon
        data-testid={dataTestId + '-resuming'}
        name="parallel"
      />
    )
  } else if (lastCommandType === 'execution-done') {
    className +=
      'text-secondary'
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
