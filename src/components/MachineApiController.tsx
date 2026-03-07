import { useEffect } from 'react'

import { useApp } from '@src/lib/boot'
import { reportRejection } from '@src/lib/trap'

export function MachineApiController() {
  const { machineManager, settings } = useApp()
  const machineApiEnabled = settings.useSettings().app.machineApi.current

  useEffect(() => {
    const electron = window.electron
    if (!electron) {
      return
    }

    let cancelled = false

    const syncMachineApiState = async () => {
      const isRunning = await electron.getMachineApiRunning()
      if (cancelled) {
        return
      }

      if (machineApiEnabled !== isRunning) {
        await electron.setMachineApiState(machineApiEnabled ? 'on' : 'off')
      }

      if (cancelled) {
        return
      }

      if (machineApiEnabled) {
        await machineManager.start()
      } else {
        machineManager.stop()
      }
    }

    syncMachineApiState().catch(reportRejection)

    return () => {
      cancelled = true
    }
  }, [machineApiEnabled, machineManager])

  return null
}
