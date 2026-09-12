export const throwError = (message: string): never => {
  throw new Error(message)
}

export function throwTronAppMissing(): never {
  return throwError(
    'tronApp is required for this desktop test. Run it without TARGET=web.'
  )
}
