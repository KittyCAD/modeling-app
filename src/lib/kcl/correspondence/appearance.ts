import type {
  EntityStyle,
  EntityStyleColor,
} from '@src/lib/scene/entityStyling'

const styles = new WeakMap<object, EntityStyle>()
let nextHue = 205
/** View objects retain their hue across Code surface remounts without retaining closed views. */
export function correspondenceStyle(view: object): EntityStyle {
  let style = styles.get(view)
  if (!style) {
    style = {
      color: oklchToSrgb(0.7, 0.12, nextHue),
      fillOpacity: 0.09,
      outlineOpacity: 0.4,
      lineWidth: 1,
      priority: 10,
    }
    nextHue = (nextHue + 137.507764) % 360
    styles.set(view, style)
  }
  return style
}

/** Oklab inverse matrix and sRGB transfer function; see https://www.w3.org/TR/css-color-4/#color-conversion-code. */
export function oklchToSrgb(
  lightness: number,
  chroma: number,
  hue: number
): EntityStyleColor {
  const angle = (hue * Math.PI) / 180,
    a = chroma * Math.cos(angle),
    b = chroma * Math.sin(angle)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const encode = (linear: number) =>
    Math.max(
      0,
      Math.min(
        1,
        linear <= 0.0031308
          ? 12.92 * linear
          : 1.055 * linear ** (1 / 2.4) - 0.055
      )
    )
  return [
    encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}
