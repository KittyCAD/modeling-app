import { useEffect, useState } from 'react'

import type { Platform } from '@src/lib/utils'
import { platform } from '@src/lib/utils'

export default function usePlatform() {
  const [platformName, setPlatformName] = useState<Platform>('')

  useEffect(() => {
    setPlatformName(platform())
  }, [setPlatformName])

  return platformName
}
