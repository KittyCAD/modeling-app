import { isDesktop } from 'lib/isDesktop'
import { useEffect, useState } from 'react'

export type Platform = 'macos' | 'windows' | 'linux' | ''

export default function usePlatform() {
  const [platformName, setPlatformName] = useState<Platform>('')

  useEffect(() => {
    function getPlatform(): Platform {
      const platform = window.electron.platform ?? ''
      // https://nodejs.org/api/process.html#processplatform
      switch (platform) {
        case 'darwin':
          return 'macos'
        case 'win32':
          return 'windows'
        // We don't currently care to distinguish between these.
        case 'android':
        case 'freebsd':
        case 'linux':
        case 'openbsd':
        case 'sunos':
          return 'linux'
        default:
          console.error('Unknown platform:', platform)
          return ''
      }
    }

    if (isDesktop()) {
      setPlatformName(getPlatform())
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
