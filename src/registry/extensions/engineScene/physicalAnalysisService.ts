import type {
  UnitArea,
  UnitDensity,
  UnitLength,
  UnitMass,
  UnitVolume,
} from '@kittycad/lib'
import { signal } from '@preact/signals-core'
import {
  isValidMaterialDensity,
  unitAreaOptions,
  unitDensityOptions,
  unitLengthOptions,
  unitMassOptions,
  unitVolumeOptions,
} from './physicalAnalysisUtils'

export const PHYSICAL_ANALYSIS_STORAGE_KEY = 'physicalAnalysis.preferences'

/**
 * A null unit means "follow the current file's length unit". Once the user
 * picks a unit explicitly it is persisted and pins, overriding the file.
 */
export interface PhysicalAnalysisPreferences {
  lengthUnit: UnitLength | null
  areaUnit: UnitArea | null
  volumeUnit: UnitVolume | null
  massUnit: UnitMass | null
  densityUnit: UnitDensity | null
  materialDensity: number | null
}

function createDefaultPreferences(): PhysicalAnalysisPreferences {
  return {
    lengthUnit: null,
    areaUnit: null,
    volumeUnit: null,
    massUnit: null,
    densityUnit: null,
    materialDensity: null,
  }
}

function pickUnit<T extends string>(
  value: unknown,
  options: readonly T[]
): T | null {
  return typeof value === 'string' &&
    (options as readonly string[]).includes(value)
    ? (value as T)
    : null
}

/**
 * Persisted preferences outlive type changes, so every field is validated
 * against its unit union before it can reach the engine.
 */
export function parsePhysicalAnalysisPreferences(
  value: unknown
): PhysicalAnalysisPreferences {
  if (typeof value !== 'object' || value === null) {
    return createDefaultPreferences()
  }

  const record = value as Record<string, unknown>
  return {
    lengthUnit: pickUnit(record.lengthUnit, unitLengthOptions),
    areaUnit: pickUnit(record.areaUnit, unitAreaOptions),
    volumeUnit: pickUnit(record.volumeUnit, unitVolumeOptions),
    massUnit: pickUnit(record.massUnit, unitMassOptions),
    densityUnit: pickUnit(record.densityUnit, unitDensityOptions),
    materialDensity: isValidMaterialDensity(record.materialDensity)
      ? record.materialDensity
      : null,
  }
}

function loadPreferences(): PhysicalAnalysisPreferences {
  if (!globalThis.localStorage) {
    return createDefaultPreferences()
  }

  const raw = globalThis.localStorage.getItem(PHYSICAL_ANALYSIS_STORAGE_KEY)
  if (!raw) {
    return createDefaultPreferences()
  }

  try {
    return parsePhysicalAnalysisPreferences(JSON.parse(raw))
  } catch {
    return createDefaultPreferences()
  }
}

function savePreferences(preferences: PhysicalAnalysisPreferences) {
  if (!globalThis.localStorage) {
    return
  }

  try {
    globalThis.localStorage.setItem(
      PHYSICAL_ANALYSIS_STORAGE_KEY,
      JSON.stringify(preferences)
    )
  } catch {
    // Persisting preferences is best effort. A blocked or full store must not
    // stop the tool from working for the rest of the session.
  }
}

export const physicalAnalysisService = {
  isOpen: signal(false),
  preferences: signal<PhysicalAnalysisPreferences>(loadPreferences()),
  open() {
    physicalAnalysisService.isOpen.value = true
  },
  close() {
    physicalAnalysisService.isOpen.value = false
  },
  setPreference<K extends keyof PhysicalAnalysisPreferences>(
    key: K,
    value: PhysicalAnalysisPreferences[K]
  ) {
    const next = { ...physicalAnalysisService.preferences.value, [key]: value }
    physicalAnalysisService.preferences.value = next
    savePreferences(next)
  },
  /** Re-reads localStorage. Exposed for tests. */
  reloadPreferences() {
    physicalAnalysisService.preferences.value = loadPreferences()
  },
}
