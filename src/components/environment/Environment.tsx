import { ActionButton } from '@src/components/ActionButton'
import env from '@src/env'
import { commandBarActor } from '@src/lib/singletons'

export function EnvironmentChip() {
  let label = env().VITE_ZOO_BASE_DOMAIN
  const url = new URL(env().VITE_KITTYCAD_WEBSOCKET_URL || '')
  if (
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '0.0.0.0'
  ) {
    label = `${label} + local`
  } else if (url.search) {
    label = `${label} + ${url.search.substring(1)}`
  }
  return (
    <div className="flex items-center px-2 py-1 text-xs text-chalkboard-80 dark:text-chalkboard-30 rounded-none border-none hover:bg-chalkboard-30 dark:hover:bg-chalkboard-80 focus:bg-chalkboard-30 dark:focus:bg-chalkboard-80 hover:text-chalkboard-100 dark:hover:text-chalkboard-10 focus:text-chalkboard-100 dark:focus:text-chalkboard-10  focus:outline-none focus-visible:ring-2 focus:ring-primary focus:ring-opacity-50">
      <span className="">{label}</span>
    </div>
  )
}

export function EnvironmentDescription() {
  const fullEnvironmentName = env().VITE_ZOO_BASE_DOMAIN
  return (
    <div className="absolute left-2 bottom-full mb-1 flex-col gap-1 align-stretch bg-chalkboard-10 dark:bg-chalkboard-90 rounded shadow-lg border border-solid border-chalkboard-20/50 dark:border-chalkboard-80/50 text-sm">
      <div
        className={`flex flex-col p-2 mb-2 rounded-t-sm bg-chalkboard-20 text-chalkboard-100 dark:bg-chalkboard-80 dark:text-chalkboard-10`}
      >
        <p className="flex flex-row justify-between items-center">
          <h2 className="text-sm font-sans font-normal">Environment</h2>
          <p
            data-testid="environment"
            className="text-xs rounded-sm flex flex-row items-center"
          >
            <ActionButton
              Element="button"
              onClick={() => {
                const environment = env().VITE_ZOO_BASE_DOMAIN
                if (environment) {
                  commandBarActor.send({
                    type: 'Find and select command',
                    data: {
                      groupId: 'application',
                      name: 'switch-environments',
                      argDefaultValues: {
                        environment,
                      },
                    },
                  })
                }
              }}
              iconEnd={{ icon: 'sketch', bgClassName: '!bg-transparent' }}
              className="ml-1 py-0.5 pr-0.5"
            >
              {fullEnvironmentName}
            </ActionButton>
          </p>
        </p>
      </div>
      <ul>
        <li className="flex flex-col px-2 py-2 gap-1 last:mb-0 ">
          <p className="text-chalkboard-100 dark:text-chalkboard-10">Account</p>{' '}
          <p className="text-chalkboard-60 dark:text-chalkboard-40">
            {env().VITE_ZOO_API_BASE_URL}
          </p>
        </li>
        <li className="flex flex-col px-2 py-2 gap-1 last:mb-0 ">
          <p className="text-chalkboard-100 dark:text-chalkboard-10">Engine</p>{' '}
          <p className="text-chalkboard-60 dark:text-chalkboard-40 flex flex-row justify-between items-center">
            <span className="flex-1 min-w-0 truncate">
              {env().VITE_KITTYCAD_WEBSOCKET_URL}
            </span>
            <ActionButton
              Element="button"
              onClick={() => {
                commandBarActor.send({
                  type: 'Find and select command',
                  data: {
                    groupId: 'application',
                    name: 'override-engine',
                    argDefaultValues: {
                      url: env().VITE_KITTYCAD_WEBSOCKET_URL,
                    },
                  },
                })
              }}
              iconEnd={{ icon: 'sketch', bgClassName: '!bg-transparent' }}
              className="ml-3 p-0.5 pr-2 flex-shrink-0"
            />
          </p>
        </li>
        <li className="flex flex-col px-2 py-2 gap-1 last:mb-0 ">
          <p className="text-chalkboard-100 dark:text-chalkboard-10">
            Zookeeper
          </p>{' '}
          <p className="text-chalkboard-60 dark:text-chalkboard-40">
            {env().VITE_MLEPHANT_WEBSOCKET_URL}
          </p>
        </li>
      </ul>
    </div>
  )
}
