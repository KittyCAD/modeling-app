import type { KclVersion } from '@rust/kcl-lib/bindings/KclVersion'

export type KclVersionRange = {
  addedIn?: string | null
  removedIn?: string | null
}

/** Match Rust's version_ge: compare numeric components and ignore preview suffixes. */
export function kclVersionAtLeast(version: KclVersion, boundary: string) {
  const release = version.split('-')[0].split('.').map(Number)
  const minimum = boundary.split('.').map(Number)
  for (let i = 0; i < Math.min(release.length, minimum.length); i++) {
    if (release[i] !== minimum[i]) return release[i] > minimum[i]
  }
  return release.length >= minimum.length
}

export function isKclVersionAvailable(
  version: KclVersion | null,
  { addedIn, removedIn }: KclVersionRange
) {
  return (
    version !== null &&
    (!addedIn || kclVersionAtLeast(version, addedIn)) &&
    (!removedIn || !kclVersionAtLeast(version, removedIn))
  )
}
