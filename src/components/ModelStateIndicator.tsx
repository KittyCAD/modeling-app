import { engineStreamActor } from '@src/machines/appMachine'
import { EngineStreamState } from '@src/machines/engineStreamMachine'
import { useSelector } from '@xstate/react'

import { faPause, faPlay, faSpinner } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

export const ModelStateIndicator = () => {
  const engineStreamState = useSelector(engineStreamActor, (state) => state)

  let className = 'w-6 h-6 '
  let icon = <div className={className}></div>
  let dataTestId = 'model-state-indicator'

  if (engineStreamState.value === EngineStreamState.Paused) {
    className += 'text-secondary'
    icon = (
      <FontAwesomeIcon
        data-testid={dataTestId + '-paused'}
        icon={faPause}
        width="20"
        height="20"
      />
    )
  } else if (engineStreamState.value === EngineStreamState.Playing) {
    className += 'text-secondary'
    icon = (
      <FontAwesomeIcon
        data-testid={dataTestId + '-playing'}
        icon={faPlay}
        width="20"
        height="20"
      />
    )
  } else {
    className += 'text-secondary'
    icon = (
      <FontAwesomeIcon
        data-testid={dataTestId + '-resuming'}
        icon={faSpinner}
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
