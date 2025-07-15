import { getEnvironmentName } from '@src/env'
import { capitaliseFC } from '@src/lib/utils'
import { ActionButton } from '@src/components/ActionButton'
import env from '@src/env'

export function environmentNameDisplay() {
  return env().NODE_ENV === 'development' ? '.env' : getEnvironmentName()
}

export function EnvironmentChip() {
  const environmentName = environmentNameDisplay()
  const pool = env().POOL
  return (
    <div className="flex items-center px-2 py-1 text-xs text-chalkboard-80 dark:text-chalkboard-30 rounded-none border-none hover:bg-chalkboard-30 dark:hover:bg-chalkboard-80 focus:bg-chalkboard-30 dark:focus:bg-chalkboard-80 hover:text-chalkboard-100 dark:hover:text-chalkboard-10 focus:text-chalkboard-100 dark:focus:text-chalkboard-10  focus:outline-none focus-visible:ring-2 focus:ring-primary focus:ring-opacity-50'">
      <span className="">
        {environmentName} {pool ? `+ Pool` : ''}
      </span>
    </div>
  )
}

export function EnvironmentDescription() {
  const environmentName = environmentNameDisplay()
  return (
    <div className="absolute left-2 bottom-full mb-1 flex-col gap-1 align-stretch bg-chalkboard-10 dark:bg-chalkboard-90 rounded shadow-lg border border-solid border-chalkboard-20/50 dark:border-chalkboard-80/50 text-sm">
      <div
        className={`flex items-center justify-between p-2 mb-2 rounded-t-sm bg-chalkboard-20 text-chalkboard-100`}
      >
        <h2 className="text-sm font-sans font-normal">Environment</h2>
        <p
          data-testid="environment"
          className="text-xs rounded-sm flex flex-row items-center"
        >
          {capitaliseFC(environmentName || '')}
          <ActionButton
            Element="button"
            iconStart={{ icon: 'sketch', bgClassName: '!bg-transparent' }}
            className="ml-1 pr-0"
          ></ActionButton>
        </p>
      </div>
      <ul>
        <li className="flex flex-col px-2 py-2 gap-1 last:mb-0 ">
          <p className="text-chalkboard-100">API</p>{' '}
          <p className="text-chalkboard-60">
            {env().VITE_KITTYCAD_API_BASE_URL}
          </p>
        </li>
        <li className="flex flex-col px-2 py-2 gap-1 last:mb-0 ">
          <p className="text-chalkboard-100">Site</p>{' '}
          <p className="text-chalkboard-60">
            {env().VITE_KITTYCAD_SITE_BASE_URL}
          </p>
        </li>
        <li className="flex flex-col px-2 py-2 gap-1 last:mb-0 ">
          <p className="text-chalkboard-100">Websocket</p>{' '}
          <p className="text-chalkboard-60">
            {env().VITE_KITTYCAD_API_WEBSOCKET_URL}
          </p>
        </li>
        <li className="flex flex-col px-2 py-2 gap-1 last:mb-0 ">
          <p className="text-chalkboard-100">Pool</p>{' '}
          <p className="text-chalkboard-60 flex flex-row justify-between">
            <span>{env().POOL || 'No pool configured'}</span>
            <div className="flex flex-row gap-1">
              <ActionButton Element="button">
                <span className="py-2 lg:py-0">Edit</span>
              </ActionButton>
              <ActionButton Element="button">
                <span className="py-2 lg:py-0">Clear</span>
              </ActionButton>
            </div>
          </p>
        </li>
      </ul>
    </div>
  )
}
