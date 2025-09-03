import type { ActionIconProps } from '@src/components/ActionIcon'
import { ActionIcon } from '@src/components/ActionIcon'
import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import { reportRejection } from '@src/lib/trap'
import { toSync } from '@src/lib/utils'
import type { StatusBarItemType } from '@src/components/StatusBar/statusBarTypes'
import type { ConnectingTypeGroup } from '@src/network/utils'

export const NETWORK_HEALTH_TEXT: Record<NetworkHealthState, string> = {
  [NetworkHealthState.Ok]: 'Strong',
  [NetworkHealthState.Weak]: 'Ok',
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
      icon: 'text-succeed-50 dark:text-succeed-30',
      bg: 'bg-lime-300/70 dark:bg-lime-300/30',
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

const overallConnectionStateIcon = {
  [NetworkHealthState.Ok]: 'network',
  [NetworkHealthState.Weak]: 'network',
  [NetworkHealthState.Issue]: 'networkCrossedOut',
  [NetworkHealthState.Disconnected]: 'networkCrossedOut',
} as const

export const useNetworkHealthStatus = (): StatusBarItemType => {
  const { overallState } = useNetworkContext()

  return {
    id: 'network-health',
    'data-testid': `network-toggle-${
      overallState === NetworkHealthState.Ok ? 'ok' : 'other'
    }`,
    label: `Network health (${NETWORK_HEALTH_TEXT[overallState]})`,
    hideLabel: true,
    element: 'popover',
    className: overallConnectionStateColor[overallState].icon,
    icon: overallConnectionStateIcon[overallState],
    popoverContent: <NetworkHealthPopoverContent />,
  }
}

function NetworkHealthPopoverContent() {
  const {
    overallState,
    internetConnected,
    steps,
    issues,
    error,
    ping,
    setHasCopied,
    hasCopied,
  } = useNetworkContext()

  return (
    <div
      className="absolute left-2 bottom-full mb-1 w-64 flex flex-col gap-1 align-stretch bg-chalkboard-10 dark:bg-chalkboard-90 rounded shadow-lg border border-solid border-chalkboard-20/50 dark:border-chalkboard-80/50 text-sm"
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
      <div className="flex items-center justify-between p-2 rounded-t-sm">
        <h2
          className={`text-xs font-sans font-normal ${overallConnectionStateColor[overallState].icon}`}
        >
          Ping
        </h2>
        <p
          data-testid="network"
          className={`font-bold text-xs uppercase px-2 py-1 rounded-sm ${overallConnectionStateColor[overallState].icon}`}
        >
          {ping ?? 'N/A'}
        </p>
      </div>
      <ul className="divide-y divide-chalkboard-20 dark:divide-chalkboard-80">
        {Object.keys(steps).map((name) => (
          <li key={name} className={'flex flex-col px-2 py-4 gap-1 last:mb-0 '}>
            <div className="flex items-center text-left gap-1">
              <p className="flex-1">{name}</p>
              {internetConnected ? (
                <ActionIcon
                  size="lg"
                  icon={
                    hasIssueToIcon[String(issues[name as ConnectingTypeGroup])]
                  }
                  iconClassName={
                    hasIssueToIconColors[
                      String(issues[name as ConnectingTypeGroup])
                    ].icon
                  }
                  bgClassName={`rounded-sm ${
                    hasIssueToIconColors[
                      String(issues[name as ConnectingTypeGroup])
                    ].bg
                  }`}
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
                type="button"
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
    </div>
  )
}
