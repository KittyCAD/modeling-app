import type { IElectronAPI } from '@root/interface'
import { defineContract, defineService } from '@kittycad/registry'

export type TelemetryRegistryService = {
  maybeWriteToDisk: (electron: IElectronAPI) => Promise<void>
}

export const telemetryContract = defineContract({
  telemetryService:
    defineService<TelemetryRegistryService>('telemetry.service'),
})

export const { telemetryService } = telemetryContract
