import { GridHelper, LineBasicMaterial } from 'three'

export function createGridHelper({
  size,
  divisions,
}: {
  size: number
  divisions: number
}) {
  const gridHelperMaterial = new LineBasicMaterial({
    color: 0xaaaaaa,
    transparent: true,
    opacity: 0.5,
  })
  const gridHelper = new GridHelper(size, divisions, 0x0000ff, 0xffffff)
  gridHelper.material = gridHelperMaterial
  gridHelper.rotation.x = Math.PI / 2
  return gridHelper
}
