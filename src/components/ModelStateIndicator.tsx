import { CustomIcon } from '@src/components/CustomIcon'
import { useEngineCommands } from '@src/components/EngineCommands'
import { Spinner } from '@src/components/Spinner'

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faPlay,
  faPause,
  faSpinner,
} from '@fortawesome/free-solid-svg-icons'

export const ModelStateIndicator = () => {
  const [commands] = useEngineCommands()
  const [isDone, setIsDone] = useState<boolean>(false)

  const engineStreamState = useSelector(engineStreamActor, (state) => state)

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
    icon = <FontAwesomeIcon
      data-testid={dataTestId + '-paused'}
      icon={faPause}
      width="20"
      height="20"
    />
  } else if (engineStreamState.value === EngineStreamState.Resuming) {
    className += 'text-secondary'
    icon = <FontAwesomeIcon
      data-testid={dataTestId + '-resuming'}
      icon={faSpinner}
      width="20"
      height="20"
    />
  } else if (isDone) {
    className += 'text-secondary'
    icon = (
        <FontAwesomeIcon
          data-testid={dataTestId + '-execution-done'}
          icon={faPlay}
          width="20"
          height="20"
        />
    )
  }

  return (
    <div className={className} data-testid="model-state-indicator">
      {icon}
    </div>
  )
}
