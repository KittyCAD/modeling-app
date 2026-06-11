import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'

export type ProjectHandle = {
  readonly path: string
}

export type SystemIOService = {
  projectHandles: ReadonlySignal<readonly ProjectHandle[]>
  refreshProjectHandles: () => Promise<readonly ProjectHandle[]>
}

export const systemIOContract = defineContract({
  systemIOService: defineService<SystemIOService>('system-io.service'),
})

export const { systemIOService } = systemIOContract
