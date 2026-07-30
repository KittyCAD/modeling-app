import { signal } from '@preact/signals-core'
import type { DistanceMode } from './measurementUtils'

export const measurementToolService = {
  isOpen: signal(false),
  lastDistanceMode: signal<DistanceMode | null>(null),
  open() {
    measurementToolService.isOpen.value = true
  },
  close() {
    measurementToolService.isOpen.value = false
  },
  setDistanceMode(mode: DistanceMode) {
    measurementToolService.lastDistanceMode.value = mode
  },
}
