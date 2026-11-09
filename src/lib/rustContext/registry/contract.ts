import type RustContext from '@src/lib/rustContext'
import { contract, service } from 'plankton'
export type RustContextRegistryService = {
  readonly context: RustContext
}
export const rustContextContract = contract({
  rustContextService: service<RustContextRegistryService>(
    'rust-context.service'
  ),
})

export const { rustContextService } = rustContextContract
