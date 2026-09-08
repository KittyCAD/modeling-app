import type { RouterRegistryService } from '@src/registry/contracts/router'
import { useLayoutEffect } from 'react'
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
