import type { AppUrlService } from '@src/registry/contracts/appUrl'
import { useLayoutEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export function AppUrlServiceSync({ appUrl }: { appUrl: AppUrlService }) {
  const location = useLocation()
  const navigate = useNavigate()

  useLayoutEffect(() => appUrl.setNavigate(navigate), [appUrl, navigate])

  useLayoutEffect(() => {
    appUrl.setLocation(location)
  }, [appUrl, location])

  return null
}
