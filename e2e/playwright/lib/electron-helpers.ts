export const throwError = (message: string): never => {
  throw new Error(message)
}

export const throwTronAppMissing = () => {
  throwError('tronApp is missing')
}

export const throwAppOrApplicationMenuMissing = () => {
  throwError('app or app.applicationMenu is missing')
}

export const throwMissingMenuItemById = (message: string) => {
  throwError(message)
}
