import {
  DUPLICATE_IN_PROGRESS_FILE_NAME,
  DUPLICATE_STAGING_NAME_REGEXP,
} from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import {
  getDuplicateReservationFileName,
  parseDuplicateOwnershipEvidence,
} from '@src/lib/fs-zds/duplicateReservations'

async function readEvidence(path: string) {
  try {
    return parseDuplicateOwnershipEvidence(await fsZds.readFile(path))
  } catch {
    return undefined
  }
}

function collisionKey(name: string) {
  return name.normalize('NFC').toLowerCase().normalize('NFC')
}

async function hasMatchingReservation(projectPath: string) {
  const targetName = fsZds.basename(projectPath)
  const reservation = await readEvidence(
    fsZds.join(
      fsZds.dirname(projectPath),
      getDuplicateReservationFileName(targetName)
    )
  )
  return Boolean(
    reservation?.kind === 'reservation' &&
      collisionKey(reservation.targetName) === collisionKey(targetName)
  )
}

/**
 * Protects incomplete duplicate targets from every project-opening path, not
 * only the home listing. Invalid user files with the marker name are ignored.
 */
export async function isProjectDirectoryQuarantined(projectPath: string) {
  if (DUPLICATE_STAGING_NAME_REGEXP.test(fsZds.basename(projectPath))) {
    return true
  }

  // Reservation creation is the publication linearization point and precedes
  // target mkdir, so it must be checked before touching the target path.
  if (await hasMatchingReservation(projectPath)) {
    return true
  }

  let entries: string[]
  try {
    entries = await fsZds.readdir(projectPath)
    if (entries.includes(DUPLICATE_IN_PROGRESS_FILE_NAME)) {
      const marker = await readEvidence(
        fsZds.join(projectPath, DUPLICATE_IN_PROGRESS_FILE_NAME)
      )
      if (marker?.kind === 'target' || marker?.kind === 'stage') {
        return true
      }
    }
  } catch {
    // The target may not exist yet while its reservation already does.
  }

  // Close both reservation→mkdir and readdir→marker races.
  return hasMatchingReservation(projectPath)
}
