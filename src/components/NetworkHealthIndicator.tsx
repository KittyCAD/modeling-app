import {
  faExclamation,
  faWifi,
  faCheck,
  faMinus,
} from '@fortawesome/free-solid-svg-icons'
import { Popover } from '@headlessui/react'
import { useEffect, useState } from 'react'
import { ActionIcon } from './ActionIcon'
import {
  ConnectingType,
  ConnectingTypeGroup,
  DisconnectingType,
  engineCommandManager,
  EngineConnectionState,
  EngineConnectionStateType,
  ErrorType,
  initialConnectingTypeGroupState,
} from '../lang/std/engineConnection'

enum State {
  Ok,
  Issue,
  Disconnected,
}

const booleanToColor: Record<string | number | symbol, any> = {
  true: 'text-cyan-500',
  undefined: 'text-amber-400',
  false: 'text-red-500',
}

const booleanToIcon: Record<string | number | symbol, any> = {
  true: faCheck,
  undefined: faMinus,
  false: faExclamation,
}

// TODO: Change these as needed @Frank
const overallConnectionStateColor: Record<State, string> = {
  [State.Ok]: 'text-cyan-500',
  [State.Issue]: 'text-amber-400',
  [State.Disconnected]: 'text-red-500',
}

const overallConnectionStateIcon = {
  [State.Ok]: faCheck,
  [State.Issue]: faExclamation,
  [State.Disconnected]: faMinus,
}

export const NetworkHealthIndicator = () => {
  const [steps, setSteps] = useState(initialConnectingTypeGroupState)
  const [internetConnected, setInternetConnected] = useState<boolean>(true)
  const [overallState, setOverallState] = useState<State>(State.Ok)

  const [error, setError] = useState<ErrorType | undefined>(undefined)

  const issues: Record<ConnectingTypeGroup, boolean> = {
    [ConnectingTypeGroup.WebSocket]: steps[ConnectingTypeGroup.WebSocket].some(
      (a: [ConnectingType, boolean | undefined]) => a[1] === false
    ),
    [ConnectingTypeGroup.ICE]: steps[ConnectingTypeGroup.ICE].some(
      (a: [ConnectingType, boolean | undefined]) => a[1] === false
    ),
    [ConnectingTypeGroup.WebRTC]: steps[ConnectingTypeGroup.WebRTC].some(
      (a: [ConnectingType, boolean | undefined]) => a[1] === false
    ),
  }

  const hasIssues: boolean =
    issues[ConnectingTypeGroup.WebSocket] ||
    issues[ConnectingTypeGroup.ICE] ||
    issues[ConnectingTypeGroup.WebRTC]

  useEffect(() => {
    setOverallState(
      !internetConnected
        ? State.Disconnected
        : hasIssues
        ? State.Issue
        : State.Ok
    )
  }, [hasIssues, internetConnected])

  useEffect(() => {
    const cb1 = () => {
      setSteps(initialConnectingTypeGroupState)
      setInternetConnected(true)
    }
    const cb2 = () => {
      setInternetConnected(false)
    }
    window.addEventListener('online', cb1)
    window.addEventListener('offline', cb2)
    return () => {
      window.removeEventListener('online', cb1)
      window.removeEventListener('offline', cb2)
    }
  }, [])

  useEffect(() => {
    engineCommandManager.onConnectionStateChange(
      (engineConnectionState: EngineConnectionState) => {
        let hasSetAStep = false

        if (
          engineConnectionState.type === EngineConnectionStateType.Connecting
        ) {
          const groups = Object.values(steps)
          for (let group of groups) {
            for (let step of group) {
              if (step[0] !== engineConnectionState.value.type) continue
              step[1] = true
              hasSetAStep = true
            }
          }
        }

        if (
          engineConnectionState.type === EngineConnectionStateType.Disconnecting
        ) {
          const groups = Object.values(steps)
          for (let group of groups) {
            for (let step of group) {
              if (
                engineConnectionState.value.type === DisconnectingType.Error
              ) {
                if (
                  engineConnectionState.value.value.lastConnectingValue
                    ?.type === step[0]
                ) {
                  step[1] = false
                  hasSetAStep = true
                }
              }
            }

            if (engineConnectionState.value.type === DisconnectingType.Error) {
              setError(engineConnectionState.value.value)
            }
          }
        }

        if (hasSetAStep) {
          setSteps(steps)
        }
      }
    )
  }, [])

  return (
    <Popover className="relative">
      <Popover.Button
        className={
          'p-0 border-none bg-transparent dark:bg-transparent relative ' +
          (hasIssues
            ? 'focus-visible:outline-destroy-80'
            : 'focus-visible:outline-succeed-80')
        }
        data-testid="network-toggle"
      >
        <span className="sr-only">Network Health</span>
        <ActionIcon
          icon={faWifi}
          className="p-1"
          iconClassName={overallConnectionStateColor[overallState]}
          bgClassName={'fill-me-in'}
        />
      </Popover.Button>
      <Popover.Panel className="absolute right-0 left-auto top-full mt-1 w-56 flex flex-col gap-1 divide-y divide-chalkboard-20 dark:divide-chalkboard-70 align-stretch py-2 bg-chalkboard-10 dark:bg-chalkboard-90 rounded shadow-lg border border-solid border-chalkboard-20/50 dark:border-chalkboard-80/50 text-sm">
        <ul className="divide-y divide-chalkboard-20 dark:divide-chalkboard-80">
          <div
            className="flex justify-between font-bold text-xs uppercase px-4"
            data-testid="network"
          >
            <p className="flex-1 mr-4">
              {overallState === State.Issue
                ? 'Problem'
                : overallState === State.Ok
                ? 'Connected'
                : 'Offline'}
            </p>
            <ActionIcon
              icon={overallConnectionStateIcon[overallState]}
              bgClassName={'fill-me-in'}
              iconClassName={overallConnectionStateColor[overallState]}
              className="ml-4"
            />
          </div>
          {Object.keys(steps).map((name) => (
            <li
              key={name}
              className="flex mr-4 ml-4 items-center gap-1 py-2 my-2 last:mb-0"
            >
              <p className="flex-1 mr-4">{name}</p>
              {internetConnected ? (
                <ActionIcon
                  icon={
                    booleanToIcon[
                      (!issues[name as ConnectingTypeGroup]).toString()
                    ]
                  }
                  bgClassName={'fill-me-in'}
                  iconClassName={'fill-me-in'}
                  className="ml-4"
                />
              ) : (
                <ActionIcon
                  icon={faMinus}
                  bgClassName={'fill-me-in'}
                  iconClassName={'fill-me-in'}
                  className="ml-4"
                />
              )}
            </li>
          ))}
        </ul>
      </Popover.Panel>
    </Popover>
  )
}
