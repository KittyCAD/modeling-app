import { signal } from '@preact/signals-core'
import type { DistanceMode } from './measurementUtils'

export const measurementToolService = {
  lastDistanceMode: signal<DistanceMode | null>(null),
  setDistanceMode(mode: DistanceMode) {
    measurementToolService.lastDistanceMode.value = mode
  },
}
