import { useSignals } from '@preact/signals-react/runtime'
import { AutoUpdateDownloadStatus } from '@src/components/StatusBar/AutoUpdateDownloadStatus'
import { AutoUpdateReadyStatus } from '@src/components/StatusBar/AutoUpdateReadyStatus'
import type { TooltipProps } from '@src/components/Tooltip'
import {
  autoUpdateDownloadProgressSignal,
  autoUpdateReadySignal,
} from '@src/lib/autoUpdate'
import { isDesktop } from '@src/lib/isDesktop'
import { reportRejection } from '@src/lib/trap'

export function AutoUpdateStatus({
  tooltipPosition,
}: {
  tooltipPosition?: TooltipProps['position']
}) {
  useSignals()
  const progress = autoUpdateDownloadProgressSignal.value
  const update = autoUpdateReadySignal.value

  if (!isDesktop()) return null

  return update ? (
    <AutoUpdateReadyStatus
      update={update}
      tooltipPosition={tooltipPosition}
      onRestart={() => {
        Promise.resolve(window.electron?.appRestart()).catch(reportRejection)
      }}
    />
  ) : progress ? (
    <AutoUpdateDownloadStatus progress={progress} showProgressBar={false} />
  ) : null
}
