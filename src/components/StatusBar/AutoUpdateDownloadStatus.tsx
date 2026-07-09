import { ActionIcon } from '@src/components/ActionIcon'
import type { AutoUpdateDownloadProgress } from '@src/lib/autoUpdate'

const clampProgress = (progress: number) => {
  return Math.max(0, Math.min(100, progress))
}

const bytesToMegabytes = (bytes: number) => {
  return bytes / (1024 * 1024)
}

export function AutoUpdateDownloadStatus({
  progress,
}: {
  progress: AutoUpdateDownloadProgress
}) {
  const percent = clampProgress(Math.round(progress.percent))
  const transferredMb = bytesToMegabytes(progress.transferred).toFixed(1)
  const totalMb = bytesToMegabytes(progress.total).toFixed(1)

  return (
    <div
      className="relative flex items-center gap-2 px-2 py-1 text-xs text-chalkboard-80 dark:text-chalkboard-30 whitespace-nowrap"
      data-testid="auto-update-download-status"
      title={`Downloading update: ${transferredMb} MB / ${totalMb} MB`}
    >
      <div className="absolute inset-x-0 top-0 h-[2px] bg-chalkboard-30 dark:bg-chalkboard-80">
        <div
          className="h-full bg-primary transition-all duration-150 ease-linear"
          data-testid="auto-update-download-progress-bar"
          style={{ width: `${percent}%` }}
        />
      </div>
      <ActionIcon
        icon="loading"
        size="sm"
        iconClassName="animate-spin text-primary dark:text-primary"
        bgClassName="!bg-transparent"
      />
      <span>{`Update ${percent}%`}</span>
    </div>
  )
}
