import type {
  loadFactoryOptions,
  FactoryShippingForm,
} from '@src/lib/factory/api'
import type {
  FactoryDelivery,
  FactoryJobRequests,
  FactorySnapshot,
} from '@src/lib/factory/jobs'

export type FactoryCatalog = Awaited<ReturnType<typeof loadFactoryOptions>>

/** Live app adapters supply a form with operations captured for its account and project. */
export interface FactoryFormContext {
  signedIn: boolean
  ready: boolean
  local: boolean
  isCurrent: () => boolean
  load: () => Promise<{ catalog: FactoryCatalog; paths: string[] }>
  capture: (isActive: () => boolean) => Promise<FactorySnapshot>
  saveDelivery: (shipping: FactoryShippingForm) => Promise<FactoryDelivery>
  requests: FactoryJobRequests
}
