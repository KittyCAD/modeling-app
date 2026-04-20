import { signal } from '@preact/signals-core'

export type AutoUpdateDownloadProgress = {
  bytesPerSecond: number
  delta: number
  percent: number
  total: number
  transferred: number
}

export const autoUpdateDownloadProgressSignal =
  signal<AutoUpdateDownloadProgress | null>(null)

export const setAutoUpdateDownloadProgress = (
  progress: AutoUpdateDownloadProgress
) => {
  autoUpdateDownloadProgressSignal.value = progress
}

export const clearAutoUpdateDownloadProgress = () => {
  autoUpdateDownloadProgressSignal.value = null
}
