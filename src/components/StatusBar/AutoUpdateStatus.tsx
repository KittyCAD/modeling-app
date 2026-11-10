import { useSignals } from '@preact/signals-react/runtime'
import { AutoUpdateDownloadStatus } from '@src/components/StatusBar/AutoUpdateDownloadStatus'
import { AutoUpdateReadyStatus } from '@src/components/StatusBar/AutoUpdateReadyStatus'
import {
  autoUpdateDownloadProgressSignal,
  autoUpdateReadySignal,
} from '@src/lib/autoUpdate'
import { isDesktop } from '@src/lib/isDesktop'
import { reportRejection } from '@src/lib/trap'

export function AutoUpdateStatus() {
  useSignals()
  const progress = autoUpdateDownloadProgressSignal.value
  const update = autoUpdateReadySignal.value

  if (!isDesktop()) return null

  return update ? (
    <AutoUpdateReadyStatus
      update={update}
      onRestart={() => {
        Promise.resolve(window.electron?.appRestart()).catch(reportRejection)
      }}
    />
  ) : progress ? (
    <AutoUpdateDownloadStatus progress={progress} showProgressBar={false} />
  ) : null
}
