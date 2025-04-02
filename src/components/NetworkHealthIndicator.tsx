import { Popover } from '@headlessui/react'

import type { ActionIconProps } from '@src/components/ActionIcon'
import { ActionIcon } from '@src/components/ActionIcon'
import Tooltip from '@src/components/Tooltip'
import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import type { ConnectingTypeGroup } from '@src/lang/std/engineConnection'
import { reportRejection } from '@src/lib/trap'
import { toSync } from '@src/lib/utils'

export const NETWORK_HEALTH_TEXT: Record<NetworkHealthState, string> = {
  [NetworkHealthState.Ok]: 'Connected',
  [NetworkHealthState.Weak]: 'Weak',
  [NetworkHealthState.Issue]: 'Problem',
  [NetworkHealthState.Disconnected]: 'Offline',
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
      icon: '!text-chalkboard-110 dark:!text-chalkboard-10',
      bg: 'bg-transparent dark:bg-transparent',
    },
  }

const overallConnectionStateColor: Record<NetworkHealthState, IconColorConfig> =
  {
    [NetworkHealthState.Ok]: {
      icon: 'text-succeed-80 dark:text-succeed-10',
      bg: 'bg-succeed-10/30 dark:bg-succeed-80/50',
    },
    [NetworkHealthState.Weak]: {
      icon: 'text-warn-80 dark:text-warn-10',
      bg: 'bg-warn-10 dark:bg-warn-80/80',
    },
    [NetworkHealthState.Issue]: {
      icon: 'text-destroy-80 dark:text-destroy-10',
      bg: 'bg-destroy-10 dark:bg-destroy-80/80',
    },
    [NetworkHealthState.Disconnected]: {
      icon: 'text-destroy-80 dark:text-destroy-10',
      bg: 'bg-destroy-10 dark:bg-destroy-80',
    },
  }

const overallConnectionStateIcon: Record<
  NetworkHealthState,
  ActionIconProps['icon']
> = {
  [NetworkHealthState.Ok]: 'network',
  [NetworkHealthState.Weak]: 'network',
  [NetworkHealthState.Issue]: 'networkCrossedOut',
  [NetworkHealthState.Disconnected]: 'networkCrossedOut',
}

export const NetworkHealthIndicator = () => {
  const {
    hasIssues,
    overallState,
    internetConnected,
    steps,
    issues,
    error,
    setHasCopied,
    hasCopied,
  } = useNetworkContext()

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
        <ActionIcon
          icon={overallConnectionStateIcon[overallState]}
          data-testid={`network-toggle-${
            overallState == NetworkHealthState.Ok ? 'ok' : 'other'
          }`}
          className="p-1"
          iconClassName={overallConnectionStateColor[overallState].icon}
          bgClassName={
            'rounded-sm ' + overallConnectionStateColor[overallState].bg
          }
        />
        <Tooltip position="top-right" wrapperClassName="ui-open:hidden">
          Network health ({NETWORK_HEALTH_TEXT[overallState]})
        </Tooltip>
      </Popover.Button>
      <Popover.Panel
        className="absolute right-0 left-auto bottom-full mb-1 w-64 flex flex-col gap-1 align-stretch bg-chalkboard-10 dark:bg-chalkboard-90 rounded shadow-lg border border-solid border-chalkboard-20/50 dark:border-chalkboard-80/50 text-sm"
        data-testid="network-popover"
      >
        <div
          className={`flex items-center justify-between p-2 rounded-t-sm ${overallConnectionStateColor[overallState].bg} ${overallConnectionStateColor[overallState].icon}`}
        >
          <h2 className="text-sm font-sans font-normal">Network health</h2>
          <p
            data-testid="network"
            className="font-bold text-xs uppercase px-2 py-1 rounded-sm"
          >
            {NETWORK_HEALTH_TEXT[overallState]}
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
                        String(issues[name as ConnectingTypeGroup])
                      ]
                    }
                    iconClassName={
                      hasIssueToIconColors[
                        String(issues[name as ConnectingTypeGroup])
                      ].icon
                    }
                    bgClassName={
                      'rounded-sm ' +
                      hasIssueToIconColors[
                        String(issues[name as ConnectingTypeGroup])
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
                  onClick={toSync(async () => {
                    await navigator.clipboard.writeText(
                      JSON.stringify(error, null, 2) || ''
                    )
                    setHasCopied(true)
                    setTimeout(() => setHasCopied(false), 5000)
                  }, reportRejection)}
                  className="flex w-fit gap-2 items-center bg-transparent text-sm p-1 py-0 my-0 -mx-1 text-destroy-80 dark:text-destroy-10 hover:bg-transparent border-transparent dark:border-transparent hover:border-destroy-80 dark:hover:border-destroy-80 dark:hover:bg-destroy-80"
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
