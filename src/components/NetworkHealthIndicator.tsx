import {
  faCheck,
  faExclamation,
  faWifi,
} from '@fortawesome/free-solid-svg-icons'
import { Popover } from '@headlessui/react'
import { useEffect, useState } from 'react'
import { ActionIcon } from './ActionIcon'

export const NETWORK_CONTENT = {
  good: 'Network health is good',
  bad: 'Network issue',
}

const NETWORK_MESSAGES = {
  offline: 'You are offline',
}

export const NetworkHealthIndicator = () => {
  const [networkIssues, setNetworkIssues] = useState<string[]>([])
  const hasIssues = [...networkIssues.values()].length > 0

  useEffect(() => {
    const offlineListener = () =>
      setNetworkIssues((issues) => {
        return [
          ...issues.filter((issue) => issue !== NETWORK_MESSAGES.offline),
          NETWORK_MESSAGES.offline,
        ]
      })
    window.addEventListener('offline', offlineListener)

    const onlineListener = () =>
      setNetworkIssues((issues) => {
        return [...issues.filter((issue) => issue !== NETWORK_MESSAGES.offline)]
      })
    window.addEventListener('online', onlineListener)

    return () => {
      window.removeEventListener('offline', offlineListener)
      window.removeEventListener('online', onlineListener)
    }
  }, [])

  return (
    <Popover className="relative">
      <Popover.Button
        className={
          'p-0 border-none relative ' +
          (hasIssues
            ? 'focus-visible:outline-destroy-80'
            : 'focus-visible:outline-succeed-80')
        }
        data-testid="network-toggle"
      >
        <span className="sr-only">Network Health</span>
        <ActionIcon
          icon={faWifi}
          className='p-1'
          iconClassName={
            hasIssues
              ? 'text-destroy-80 dark:text-destroy-30'
              : 'text-succeed-80 dark:text-succeed-30'
          }
          bgClassName={
            'bg-transparent ' +
            (hasIssues
              ? 'hover:bg-destroy-10/50 hover:dark:bg-destroy-80/50 rounded'
              : 'hover:bg-succeed-10/50 hover:dark:bg-succeed-80/50 rounded')
          }
        />
      </Popover.Button>
      <Popover.Panel className="absolute right-0 left-auto top-full mt-1 w-56 flex flex-col gap-1 divide-y divide-chalkboard-20 dark:divide-chalkboard-70 align-stretch py-2 bg-chalkboard-10 dark:bg-chalkboard-90 rounded shadow-lg border border-solid border-chalkboard-20/50 dark:border-chalkboard-80/50 text-sm">
        {!hasIssues ? (
          <span
            className="flex items-center justify-center gap-1 px-4"
            data-testid="network-good"
          >
            <ActionIcon
              icon={faCheck}
              bgClassName={'bg-succeed-10/50 dark:bg-succeed-80/50 rounded'}
              iconClassName={'text-succeed-80 dark:text-succeed-30'}
            />
            {NETWORK_CONTENT.good}
          </span>
        ) : (
          <ul className="divide-y divide-chalkboard-20 dark:divide-chalkboard-80">
            <span
              className="font-bold text-xs uppercase text-destroy-60 dark:text-destroy-50 px-4"
              data-testid="network-bad"
            >
              {NETWORK_CONTENT.bad}
              {networkIssues.length > 1 ? 's' : ''}
            </span>
            {networkIssues.map((issue) => (
              <li
                key={issue}
                className="flex items-center gap-1 py-2 my-2 last:mb-0"
              >
                <ActionIcon
                  icon={faExclamation}
                  bgClassName={'bg-destroy-10/50 dark:bg-destroy-80/50 rounded'}
                  iconClassName={'text-destroy-80 dark:text-destroy-30'}
                  className="ml-4"
                />
                <p className="flex-1 mr-4">{issue}</p>
              </li>
            ))}
          </ul>
        )}
      </Popover.Panel>
    </Popover>
  )
}
