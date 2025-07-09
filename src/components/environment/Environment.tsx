import { getEnvironment } from '@src/env'
export function EnvironmentChip() {
  const environment = getEnvironment()
  return (
    <div className="bg-energy-30 text-black text-center self-center text-xs rounded-sm p-1">
      <span className="">{environment?.name}</span>
    </div>
  )
}

export function EnvironmentDescription() {
  const environment = getEnvironment()
  return (
    <div className="absolute left-2 bottom-full mb-1 flex-col gap-1 align-stretch bg-chalkboard-10 dark:bg-chalkboard-90 rounded shadow-lg border border-solid border-chalkboard-20/50 dark:border-chalkboard-80/50 text-sm">
      <div
        className={`flex items-center justify-between p-2 rounded-t-sm bg-energy-40 text-energy-90`}
      >
        <h2 className="text-sm font-sans font-normal">Environment</h2>
        <p
          data-testid="environment"
          className="font-bold text-xs uppercase px-2 py-1 rounded-sm"
        >
          {environment?.name}
        </p>
      </div>
      <ul>
        <li className="flex flex-col px-2 py-4 gap-1 last:mb-0 ">
          <p className="font-bold">API</p> <p>{environment?.API_URL}</p>
        </li>
        <li className="flex flex-col px-2 py-4 gap-1 last:mb-0 ">
          <p className="font-bold">Site</p> <p>{environment?.SITE_URL}</p>
        </li>
        <li className="flex flex-col px-2 py-4 gap-1 last:mb-0 ">
          <p className="font-bold">Websocket</p>{' '}
          <p>{environment?.WEBSOCKET_URL}</p>
        </li>
      </ul>
    </div>
  )
}
