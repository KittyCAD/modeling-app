export const throwError = (message: string): never => {
  throw new Error(message)
}

export const throwTronAppMissing = () => {
  throwError('tronApp is missing')
}
