/** Millimeters become CSS pixels before the canvas transform is applied. */
export const PIXELS_PER_MM = 96 / 25.4
export const RULER_SIZE = 24

/** Visible ticks keep labels roughly 60 pixels apart at every zoom level. */
export function rulerTicks(
  length: number,
  origin: number,
  pixelsPerMm: number
) {
  const target = 60 / pixelsPerMm
  const magnitude = 10 ** Math.floor(Math.log10(target))
  const step =
    (target / magnitude <= 1
      ? 1
      : target / magnitude <= 2
        ? 2
        : target / magnitude <= 5
          ? 5
          : 10) * magnitude
  const minorStep = step / 5
  const first = Math.ceil(-origin / pixelsPerMm / minorStep)
  const last = Math.floor((length - origin) / pixelsPerMm / minorStep)
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => {
    const tick = first + index
    return {
      position: origin + tick * minorStep * pixelsPerMm,
      value: Number((tick * minorStep).toPrecision(10)),
      major: tick % 5 === 0,
    }
  })
}
