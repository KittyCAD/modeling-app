import { useSignals } from '@preact/signals-react/runtime'
import { ActionButton } from '@src/components/ActionButton'
import { AutoUpdateDownloadStatus } from '@src/components/StatusBar/AutoUpdateDownloadStatus'
import { AutoUpdateReadyStatus } from '@src/components/StatusBar/AutoUpdateReadyStatus'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'
import {
  autoUpdateDownloadProgressSignal,
  autoUpdateReadySignal,
} from '@src/lib/autoUpdate'
import { isDesktop } from '@src/lib/isDesktop'
import { reportRejection } from '@src/lib/trap'
import { APP_VERSION, getReleaseUrl } from '@src/routes/utils'
import type { CSSProperties } from 'react'

export function AutoUpdateStatus({ inline = false }: { inline?: boolean }) {
  useSignals()
  const progress = autoUpdateDownloadProgressSignal.value
  const update = autoUpdateReadySignal.value

  if (!isDesktop()) return null

  const status = update ? (
    <AutoUpdateReadyStatus
      update={update}
      onRestart={() => {
        Promise.resolve(window.electron?.appRestart()).catch(reportRejection)
      }}
    />
  ) : progress ? (
    <AutoUpdateDownloadStatus progress={progress} showProgressBar={false} />
  ) : null

  if (inline) return status

  return (
    <div
      role="group"
      aria-label="App update"
      className="flex items-center self-start"
      style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
    >
      <ActionButton
        Element="externalLink"
        to={getReleaseUrl(APP_VERSION)}
        className={defaultStatusBarItemClassNames}
        title="View this version on GitHub"
      >
        v{APP_VERSION}
      </ActionButton>
      {status}
    </div>
  )
}
