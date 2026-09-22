import { isStepFile, isStepFileExtension } from '@src/lib/fileExtensions'
import { describe, expect, it } from 'vitest'

describe('STEP file extensions', () => {
  it.each(['step', 'stp', 'STEP', 'StP'])(
    'recognizes the %s extension',
    (extension) => {
      expect(isStepFileExtension(extension)).toBe(true)
      expect(isStepFile(`part.${extension}`)).toBe(true)
    }
  )

  it.each(['kcl', 'stl', 'step.bak', '', null])(
    'rejects the %s extension or path',
    (extension) => {
      expect(
        isStepFile(extension === null ? extension : `part.${extension}`)
      ).toBe(false)
    }
  )
})
