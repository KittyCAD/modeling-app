import { Registry } from '@kittycad/registry'
import { codeChangesPreviewService } from '@src/registry/contracts/codeChangesPreview'
import { expect, it } from 'vitest'
import codeChangesPreview from '.'

it('defers session observation until after registry construction', () => {
  const registry = new Registry()
  try {
    registry.configure([codeChangesPreview])
    expect(registry.get(codeChangesPreviewService).current.value).toBeNull()
  } finally {
    registry[Symbol.dispose]()
  }
})
