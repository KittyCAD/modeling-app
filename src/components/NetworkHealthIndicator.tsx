import { Popover } from '@headlessui/react'
import { useEffect, useState } from 'react'
import { ActionIcon, ActionIconProps } from './ActionIcon'
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
import Tooltip from './Tooltip'

enum State {
  Ok,
  Issue,
  Disconnected,
}

type IconColorConfig = {
  icon: string
  bg: string
}

const hasIssueToIcon: Record<
  string | number | symbol,
  ActionIconProps['icon']
> = {
  true: 'close',
  undefined: 'horizontalDash',
  false: 'checkmark',
}

const hasIssueToIconColors: Record<string | number | symbol, IconColorConfig> =
  {
    true: {
      icon: 'text-destroy-80 dark:text-destroy-10',
      bg: 'bg-destroy-10 dark:bg-destroy-80',
    },
    undefined: {
      icon: 'text-chalkboard-70 dark:text-chalkboard-30',
      bg: 'bg-chalkboard-30 dark:bg-chalkboard-70',
    },
    false: {
      icon: 'text-chalkboard-110 dark:!text-chalkboard-10',
      bg: 'bg-transparent dark:bg-transparent',
    },
  }

const overallConnectionStateColor: Record<State, IconColorConfig> = {
  [State.Ok]: {
    icon: 'text-energy-80 dark:text-energy-10',
    bg: 'bg-energy-10/30 dark:bg-energy-80/50',
  },
  [State.Issue]: {
    icon: 'text-destroy-80 dark:text-destroy-10',
    bg: 'bg-destroy-10 dark:bg-destroy-80',
  },
  [State.Disconnected]: {
    icon: 'text-destroy-80 dark:text-destroy-10',
    bg: 'bg-destroy-10 dark:bg-destroy-80',
  },
}

const overallConnectionStateIcon: Record<State, ActionIconProps['icon']> = {
  [State.Ok]: 'network',
  [State.Issue]: 'networkCrossedOut',
  [State.Disconnected]: 'networkCrossedOut',
}

export const NetworkHealthIndicator = () => {
  const [steps, setSteps] = useState(initialConnectingTypeGroupState)
  const [internetConnected, setInternetConnected] = useState<boolean>(true)
  const [overallState, setOverallState] = useState<State>(State.Ok)
  const [hasCopied, setHasCopied] = useState<boolean>(false)
  const [wasJustClosed, setWasJustClosed] = useState<boolean>(true)

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
            : 'focus-visible:outline-energy-80')
        }
        data-testid="network-toggle"
      >
        <span className="sr-only">Network Health</span>
        <ActionIcon
          icon={overallConnectionStateIcon[overallState]}
          className="p-1"
          iconClassName={overallConnectionStateColor[overallState].icon}
          bgClassName={
            'rounded-sm ' + overallConnectionStateColor[overallState].bg
          }
        />
        <Tooltip position="blockEnd" delay={750} className="ui-open:hidden">
          Network Health
        </Tooltip>
      </Popover.Button>
      <Popover.Panel className="absolute right-0 left-auto top-full mt-1 w-64 flex flex-col gap-1 align-stretch bg-chalkboard-10 dark:bg-chalkboard-90 rounded shadow-lg border border-solid border-chalkboard-20/50 dark:border-chalkboard-80/50 text-sm">
        <div
          className={`flex items-center justify-between p-2 rounded-t-sm ${overallConnectionStateColor[overallState].bg} ${overallConnectionStateColor[overallState].icon}`}
        >
          <h2 className="text-sm font-sans font-normal">Network health</h2>
          <p
            data-testid="network"
            className="font-bold text-xs uppercase px-2 py-1 rounded-sm"
          >
            {overallState === State.Issue
              ? 'Problem'
              : overallState === State.Ok
              ? 'Connected'
              : 'Offline'}
          </p>
        </div>
        <ul className="divide-y divide-chalkboard-20 dark:divide-chalkboard-80">
          {Object.keys(steps).map((name) => (
            <li
              key={name}
              className={'flex flex-col px-2 py-4 gap-1 last:mb-0 '}
            >
              <div className="flex items-center text-left gap-1">
                <p className="flex-1">{name}</p>
                {internetConnected ? (
                  <ActionIcon
                    size="lg"
                    icon={
                      hasIssueToIcon[
                        issues[name as ConnectingTypeGroup].toString()
                      ]
                    }
                    iconClassName={
                      hasIssueToIconColors[
                        issues[name as ConnectingTypeGroup].toString()
                      ].icon
                    }
                    bgClassName={
                      'rounded-sm ' +
                      hasIssueToIconColors[
                        issues[name as ConnectingTypeGroup].toString()
                      ].bg
                    }
                  />
                ) : (
                  <ActionIcon
                    icon={hasIssueToIcon.true}
                    bgClassName={hasIssueToIconColors.true.bg}
                    iconClassName={hasIssueToIconColors.true.icon}
                  />
                )}
              </div>
              {issues[name as ConnectingTypeGroup] && (
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(
                      JSON.stringify(error, null, 2) || ''
                    )
                    setHasCopied(true)
                    setTimeout(() => setHasCopied(false), 5000)
                  }}
                  className="flex w-fit gap-2 items-center bg-transparent text-sm p-1 py-0 my-0 -mx-1 text-destroy-80 dark:text-destroy-80 hover:!bg-transparent border-transparent hover:border-destroy-80"
                >
                  {hasCopied ? 'Copied' : 'Copy Error'}
                  <ActionIcon
                    size="lg"
                    icon={hasCopied ? 'clipboardCheckmark' : 'clipboardPlus'}
                    iconClassName="text-inherit dark:text-inherit"
                    bgClassName="!bg-transparent"
                  />
                </button>
              )}
            </li>
          ))}
        </ul>
      </Popover.Panel>
    </Popover>
  )
}
