export const PUBLISH_DIRECTORY_DESTINATION_EXISTS =
  'ZDS_PUBLISH_DIRECTORY_DESTINATION_EXISTS'

export function isAlreadyExistsError(error: unknown) {
  if (typeof error === 'string') {
    return /\bEEXIST\b/.test(error)
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EEXIST'
  )
}

export function isPublishDirectoryDestinationExists(error: unknown) {
  if (error === PUBLISH_DIRECTORY_DESTINATION_EXISTS) {
    return true
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    error.message === PUBLISH_DIRECTORY_DESTINATION_EXISTS
  )
}
