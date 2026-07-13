import { CommandBar } from '@src/components/CommandBar/CommandBar'
import Loading from '@src/components/Loading'
import ModelingMachineProvider from '@src/components/ModelingMachineProvider'
import ModelingPageProvider from '@src/components/ModelingPageProvider'
import { OpenedProject } from '@src/components/OpenedProject'
import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'

export function FileRouteShell() {
  return (
    <ModelingPageProvider>
      <Suspense
        fallback={
          <div className="absolute inset-0 grid place-content-center">
            <Loading>Loading Design Studio...</Loading>
          </div>
        }
      >
        <ModelingMachineProvider>
          <Outlet />
          <OpenedProject />
          <CommandBar />
        </ModelingMachineProvider>
      </Suspense>
    </ModelingPageProvider>
  )
}
