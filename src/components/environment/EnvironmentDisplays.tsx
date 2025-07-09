import { getEnvironment } from '@src/env'

export function EnvironmentChip() {
  const environment = getEnvironment()
  return (
    <div className="bg-energy-30 text-black text-center">
      <span className="">{environment?.name}</span>
    </div>
  )
}
