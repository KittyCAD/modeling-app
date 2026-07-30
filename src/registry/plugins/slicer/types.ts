export type SlicerLaunchResult =
  | { ok: true; executablePath: string }
  | { ok: false; error: string }
