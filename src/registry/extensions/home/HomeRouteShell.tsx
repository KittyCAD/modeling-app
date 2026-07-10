import { CommandBar } from '@src/components/CommandBar/CommandBar'
import Home from '@src/routes/Home'
import { Outlet } from 'react-router-dom'

export function HomeRouteShell() {
  return (
    <>
      <Outlet />
      <Home />
      <CommandBar />
    </>
  )
}

export function EmptyHomeRoute() {
  return null
}
