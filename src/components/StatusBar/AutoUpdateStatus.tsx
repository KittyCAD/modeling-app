import { useSignals } from '@preact/signals-react/runtime'
import { AutoUpdateDownloadStatus } from '@src/components/StatusBar/AutoUpdateDownloadStatus'
import { AutoUpdateReadyStatus } from '@src/components/StatusBar/AutoUpdateReadyStatus'
import {
  autoUpdateDownloadProgressSignal,
  autoUpdateReadySignal,
} from '@src/lib/autoUpdate'
import { isDesktop } from '@src/lib/isDesktop'
import { reportRejection } from '@src/lib/trap'
import type { CSSProperties } from 'react'

export function AutoUpdateStatus({ inline = false }: { inline?: boolean }) {
  useSignals()
  const progress = autoUpdateDownloadProgressSignal.value
  const update = autoUpdateReadySignal.value

  if (!isDesktop() || (!progress && !update)) return null

  const status = update ? (
    <AutoUpdateReadyStatus
      update={update}
      onRestart={() => {
        Promise.resolve(window.electron?.appRestart()).catch(reportRejection)
      }}
    />
  ) : progress ? (
    <AutoUpdateDownloadStatus progress={progress} showProgressBar={!inline} />
  ) : null

  if (inline) return status

  return (
    <footer
      aria-label="App update"
      className="shrink-0 flex justify-end bg-chalkboard-20 dark:bg-chalkboard-90 border-t border-chalkboard-30 dark:border-chalkboard-80"
      style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
    >
      {status}
    </footer>
  )
}
