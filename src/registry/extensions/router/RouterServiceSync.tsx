import type { RouterRegistryService } from '@src/registry/contracts/router'
import { useLayoutEffect } from 'react'
// eslint-disable-next-line zds/no-react-router-hooks -- URL-state migration: React Router adapter seeds the current router service (useLocation, useNavigate).
import { useLocation, useNavigate } from 'react-router-dom'

export function RouterServiceSync({
  router,
}: {
  router: RouterRegistryService
}) {
  const location = useLocation()
  const navigate = useNavigate()

  useLayoutEffect(() => router.setNavigate(navigate), [router, navigate])

  useLayoutEffect(() => {
    router.setLocation(location)
  }, [router, location])

  return null
}
