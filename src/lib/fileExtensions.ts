export const getEXTNoPeriod = (filePath: string) => {
  const extension = filePath.split('.').pop() || null
  return extension
}

/**
 * These extensions are expected to be included in `import_file_extensions()`.
 * We cannot derive their literal types from it because the generated WASM
 * binding exposes the extensions as `string[]`.
 */
export const STEP_FILE_EXTENSIONS = ['step', 'stp'] as const
export type StepFileExtension = (typeof STEP_FILE_EXTENSIONS)[number]

export function isStepFileExtension(
  extension: string
): extension is StepFileExtension {
  const normalizedExtension = extension.toLowerCase()
  return STEP_FILE_EXTENSIONS.some(
    (stepExtension) => stepExtension === normalizedExtension
  )
}

export function isStepFile(filePath: unknown): filePath is string {
  if (typeof filePath !== 'string') {
    return false
  }

  const extension = getEXTNoPeriod(filePath)
  return extension !== null && isStepFileExtension(extension)
}
