import { isDesktop } from 'lib/isDesktop'
import { useEffect, useState } from 'react'

export type Platform = 'macos' | 'windows' | 'linux'

export default function usePlatform() {
  const [platformName, setPlatformName] = useState<Platform | ''>('')

  useEffect(() => {
    async function getPlatform() {
      setPlatformName(window.electron.platform)
    }

    if (isDesktop()) {
      void getPlatform()
    } else {
      if (navigator.userAgent.indexOf('Mac') !== -1) {
        setPlatformName('macos')
      } else if (navigator.userAgent.indexOf('Win') !== -1) {
        setPlatformName('windows')
      } else if (navigator.userAgent.indexOf('Linux') !== -1) {
        setPlatformName('linux')
      }
    }
  }, [setPlatformName])

  return platformName
}
