import { defineContract, defineService } from '@kittycad/registry'

export interface DebugRegistryService {
  clear(key: string, value: unknown): void
  set(key: string, value: unknown): void
}

export const debugContract = defineContract({
  debugService: defineService<DebugRegistryService>('debug'),
})

export const { debugService } = debugContract
