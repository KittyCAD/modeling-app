import { signal } from '@preact/signals-core'

const projectLibraryRealizationsInvalidation = signal(0)

export function invalidateProjectLibraryRealizations() {
  projectLibraryRealizationsInvalidation.value += 1
}

export function readProjectLibraryRealizationsInvalidation() {
  return projectLibraryRealizationsInvalidation.value
}
