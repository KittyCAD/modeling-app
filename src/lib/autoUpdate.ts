import { signal } from '@preact/signals-core'

export type AutoUpdateDownloadProgress = {
  bytesPerSecond: number
  delta: number
  percent: number
  total: number
  transferred: number
}

export type AutoUpdateReady = {
  version: string
  releaseNotes?: string
}

export type AutoUpdateAvailable = AutoUpdateReady

export const autoUpdateDownloadProgressSignal =
  signal<AutoUpdateDownloadProgress | null>(null)
export const autoUpdateAvailableSignal = signal<AutoUpdateAvailable | null>(
  null
)
export const autoUpdateReadySignal = signal<AutoUpdateReady | null>(null)

export const setAutoUpdateDownloadProgress = (
  progress: AutoUpdateDownloadProgress
) => {
  autoUpdateDownloadProgressSignal.value = progress
}

export const clearAutoUpdateDownloadProgress = () => {
  autoUpdateDownloadProgressSignal.value = null
}

export const setAutoUpdateAvailable = (update: AutoUpdateAvailable) => {
  autoUpdateAvailableSignal.value = update
}

export const clearAutoUpdateAvailable = () => {
  autoUpdateAvailableSignal.value = null
}

export const setAutoUpdateReady = (update: AutoUpdateReady) => {
  autoUpdateReadySignal.value = update
}

export const clearAutoUpdateReady = () => {
  autoUpdateReadySignal.value = null
}
