import { useEffect, useState } from 'react'
import { useEngineCommands } from './EngineCommands'
import { CustomIcon } from './CustomIcon'
import useEngineStreamContext, {
  EngineStreamState,
} from 'hooks/useEngineStreamContext'
import { CommandLogType } from 'lang/std/engineConnection'

export const ModelStateIndicator = () => {
  const [commands] = useEngineCommands()
  const [isDone, setIsDone] = useState<boolean>(false)

  const engineStreamActor = useEngineStreamContext.useActorRef()
  const engineStreamState = engineStreamActor.getSnapshot()

  const lastCommandType = commands[commands.length - 1]?.type

  useEffect(() => {
    if (lastCommandType === CommandLogType.SetDefaultSystemProperties) {
      setIsDone(false)
    }
    if (lastCommandType === CommandLogType.ExecutionDone) {
      setIsDone(true)
    }
  }, [lastCommandType])

  let className = 'w-6 h-6 '
  let icon = <div className={className}></div>
  let dataTestId = 'model-state-indicator'

  if (engineStreamState.value === EngineStreamState.Paused) {
    className += 'text-secondary'
    icon = <CustomIcon data-testid={dataTestId + '-paused'} name="parallel" />
  } else if (engineStreamState.value === EngineStreamState.Resuming) {
    className += 'text-secondary'
    icon = <CustomIcon data-testid={dataTestId + '-resuming'} name="parallel" />
  } else if (isDone) {
    className += 'text-secondary'
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
