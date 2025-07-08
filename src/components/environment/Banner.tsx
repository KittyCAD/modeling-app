import { getEnvironment } from '@src/env'

export function EnvironmentBannerDevelopment() {
  const environment = getEnvironment()
  return (
    <div className="col-span-full bg-energy-30 text-black text-center">
      <h1 className="">{environment?.name}</h1>
    </div>
  )
}

export function EnvironmentChipDevelopment() {
  const environment = getEnvironment()
  return (
    <div className="bg-energy-30 text-black text-center">
      <span className="">{environment?.name}</span>
    </div>
  )
}
