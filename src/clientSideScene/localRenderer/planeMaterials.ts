import { Color, DoubleSide } from 'three'
import { Line2NodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'

// Palette colors are sRGB, while Three.js materials store linear colors.
export function createPlaneMaterials(color: Color, opacity: number) {
  const fillMaterial = new MeshBasicNodeMaterial({
    color: color.clone().convertSRGBToLinear(),
    opacity,
    transparent: true,
    side: DoubleSide,
    forceSinglePass: true,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  })
  // Desaturate the colored borders; gray offset-plane borders stay gray.
  const brightness = Math.max(color.r, color.g, color.b)
  const borderColor = color
    .clone()
    .lerp(new Color(brightness, brightness, brightness), 1 / 3)
    .convertSRGBToLinear()
  const borderMaterial = new Line2NodeMaterial({
    color: borderColor,
    linewidth: 2,
    worldUnits: false,
    toneMapped: false,
  })
  return { fillMaterial, borderMaterial }
}
