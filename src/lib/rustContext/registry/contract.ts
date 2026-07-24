import { defineContract, defineService } from '@kittycad/registry'
import type RustContext from '@src/lib/rustContext'

export type RustContextRegistryService = {
  readonly context: RustContext
}

export const rustContextContract = defineContract({
  rustContextService: defineService<RustContextRegistryService>(
    'rust-context.service'
  ),
})

export const { rustContextService } = rustContextContract
