import { Platform, platform } from '@tauri-apps/plugin-os'
import { isDesktop } from 'lib/isDesktop'
import { useEffect, useState } from 'react'

export default function usePlatform() {
  const [platformName, setPlatformName] = useState<Platform | ''>('')

  useEffect(() => {
    async function getPlatform() {
      setPlatformName(await platform())
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
