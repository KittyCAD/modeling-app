import { getEnvironmentName } from '@src/env'
import { SUPPORTED_ENVIRONMENTS } from '@src/lib/constants'
import env from '@src/env'

export function environmentNameDisplay() {
  return env().NODE_ENV === 'development' ? '.env' : getEnvironmentName()
}

export function shouldRender(environmentName: string | null) {
  // No environment, do not render a chip it wouldn't have any information
  if (!environmentName) {
    return false
  }

  // If the application is connection to the production environment show nothing.
  if (environmentName === SUPPORTED_ENVIRONMENTS.production.name) {
    return false
  }

  return true
}

export function EnvironmentChip() {
  const environmentName = environmentNameDisplay()
  return (
    shouldRender(environmentName) && (
      <div className="bg-energy-40 text-black text-center self-center text-xs rounded-sm p-1 text-energy-90">
        <span className="">{environmentName}</span>
      </div>
    )
  )
}

export function EnvironmentDescription() {
  const environmentName = environmentNameDisplay()
  return (
    shouldRender(environmentName) && (
      <div className="absolute left-2 bottom-full mb-1 flex-col gap-1 align-stretch bg-chalkboard-10 dark:bg-chalkboard-90 rounded shadow-lg border border-solid border-chalkboard-20/50 dark:border-chalkboard-80/50 text-sm">
        <div
          className={`flex items-center justify-between p-2 rounded-t-sm bg-energy-40 text-energy-90`}
        >
          <h2 className="text-sm font-sans font-normal">Environment</h2>
          <p
            data-testid="environment"
            className="font-bold text-xs uppercase px-2 py-1 rounded-sm"
          >
            {environmentName}
          </p>
        </div>
        <ul>
          <li className="flex flex-col px-2 py-4 gap-1 last:mb-0 ">
            <p className="font-bold">API</p>{' '}
            <p>{env().VITE_KITTYCAD_API_BASE_URL}</p>
          </li>
          <li className="flex flex-col px-2 py-4 gap-1 last:mb-0 ">
            <p className="font-bold">Site</p>{' '}
            <p>{env().VITE_KITTYCAD_SITE_BASE_URL}</p>
          </li>
          <li className="flex flex-col px-2 py-4 gap-1 last:mb-0 ">
            <p className="font-bold">Websocket</p>{' '}
            <p>{env().VITE_KITTYCAD_API_WEBSOCKET_URL}</p>
          </li>
        </ul>
      </div>
    )
  )
}
