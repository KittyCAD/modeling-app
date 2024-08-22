import { Platform, platform } from 'lib/utils'
import { useEffect, useState } from 'react'

export default function usePlatform() {
  const [platformName, setPlatformName] = useState<Platform>('')

  useEffect(() => {
    setPlatformName(platform())
  }, [setPlatformName])

  return platformName
}
