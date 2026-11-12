/** Naming parts used to place a uniqueness suffix before the full extension. */
export interface FileNameParts {
  readonly stem: string
  readonly extension: string
}

/** Build the preferred filename or its numbered collision variant. */
export function fileNameCandidate(name: FileNameParts, suffix: number): string {
  return `${name.stem}${suffix === 0 ? '' : `-${suffix}`}${name.extension}`
}
