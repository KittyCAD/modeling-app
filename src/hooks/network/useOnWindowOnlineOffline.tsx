import { EngineDebugger } from '@src/lib/debugger'
import { useCallback, useEffect } from 'react'

export const useOnWindowOnlineOffline = ({
  close,
  connect,
}: { close: () => void; connect: () => void }) => {
  const handleOffline = useCallback(
    (event: Event) => {
      EngineDebugger.addLog({
        label: 'useOnWindowOnlineOffline',
        message: 'handleOffline',
        metadata: { event },
      })
      if (event.type === 'offline') {
        close()
      } else {
        console.error('event is not offline', event)
      }
    },
    [close]
  )

  const handleOnline = useCallback(
    (event: Event) => {
      EngineDebugger.addLog({
        label: 'useOnWindowOnlineOffline',
        message: 'handleOnline',
        metadata: { event },
      })
      if (event.type === 'online') {
        connect()
      } else {
        console.error('event is not online', event)
      }
    },
    [connect]
  )
  useEffect(() => {
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [handleOffline, handleOnline])
}
