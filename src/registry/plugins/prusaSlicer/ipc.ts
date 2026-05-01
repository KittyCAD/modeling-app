export const PRUSA_SLICER_OPEN_STL_CHANNEL = 'plugin:prusa-slicer.open-stl'

export type OpenStlInPrusaSlicerResult =
  | { ok: true; executablePath: string }
  | { ok: false; error: string }
