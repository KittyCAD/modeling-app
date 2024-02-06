import { Platform, platform } from '@tauri-apps/plugin-os'
import { isTauri } from 'lib/isTauri'
import { useEffect, useState } from 'react'

export default function usePlatform() {
  const [platformName, setPlatformName] = useState<Platform | ''>('')

  useEffect(() => {
    async function getPlatform() {
      setPlatformName(await platform())
    }

    if (isTauri()) {
      void getPlatform()
    } else {
      if (navigator.userAgent.indexOf('Mac') !== -1) {
        setPlatformName('darwin')
      } else if (navigator.userAgent.indexOf('Win') !== -1) {
        setPlatformName('win32')
      } else if (navigator.userAgent.indexOf('Linux') !== -1) {
        setPlatformName('linux')
      }
    }
  }, [setPlatformName])

  return platformName
}
