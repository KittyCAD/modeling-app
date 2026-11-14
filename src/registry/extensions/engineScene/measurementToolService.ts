import { signal } from '@preact/signals-core'
import type { DistanceMode } from './measurementUtils'

export function createMeasurementToolService() {
  const service = {
    isOpen: signal(false),
    lastDistanceMode: signal<DistanceMode | null>(null),
    open() {
      service.isOpen.value = true
    },
    close() {
      service.isOpen.value = false
    },
    setDistanceMode(mode: DistanceMode) {
      service.lastDistanceMode.value = mode
    },
  }
  return service
}

export const measurementToolService = createMeasurementToolService()
