import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'

type RectangleUIOptions = {
  fillColor?: number | null
  fillOpacity?: number
  strokeColor: number
  strokeWidth: number
}

export class RectangleUI {
  public readonly container: Group

  private readonly _fillMesh: Mesh<PlaneGeometry, MeshBasicMaterial>
  private readonly _lines: Line2[]

  private _width = 1
  private _height = 1

  constructor({
    fillColor = null,
    fillOpacity = 1,
    strokeColor,
    strokeWidth,
  }: RectangleUIOptions) {
    this.container = new Group()

    const fillMaterial = new MeshBasicMaterial({
      color: fillColor ?? 0xffffff,
      transparent: true,
      opacity: fillColor === null ? 0 : fillOpacity,
      depthTest: false,
      depthWrite: false,
    })
    this._fillMesh = new Mesh(new PlaneGeometry(1, 1), fillMaterial)
    this._fillMesh.raycast = () => {}
    this.container.add(this._fillMesh)

    this._lines = [
      this.createLine(strokeColor, strokeWidth),
      this.createLine(strokeColor, strokeWidth),
      this.createLine(strokeColor, strokeWidth),
      this.createLine(strokeColor, strokeWidth),
    ]
    this._lines.forEach((line) => {
      line.raycast = () => {}
    })
    this._lines.forEach((line) => this.container.add(line))
    this.setSize(this._width, this._height)
  }

  public setSize(width: number, height: number) {
    this._width = width
    this._height = height

    const halfWidth = width * 0.5
    const halfHeight = height * 0.5

    this.setLinePositions(
      this._lines[0],
      -halfWidth,
      -halfHeight,
      halfWidth,
      -halfHeight
    )
    this.setLinePositions(
      this._lines[1],
      halfWidth,
      -halfHeight,
      halfWidth,
      halfHeight
    )
    this.setLinePositions(
      this._lines[2],
      halfWidth,
      halfHeight,
      -halfWidth,
      halfHeight
    )
    this.setLinePositions(
      this._lines[3],
      -halfWidth,
      halfHeight,
      -halfWidth,
      -halfHeight
    )

    this._fillMesh.scale.set(width, height, 1)
  }

  public setResolution(width: number, height: number) {
    this._lines.forEach((line) => {
      const material = line.material
      material.resolution.set(width, height)
    })
  }

  public setStroke(strokeColor: number, strokeWidth: number) {
    const linewidth = strokeWidth * window.devicePixelRatio
    this._lines.forEach((line) => {
      const material = line.material
      material.color.set(strokeColor)
      material.linewidth = linewidth
    })
  }

  public setFill(fillColor: number | null, fillOpacity = 1) {
    const material = this._fillMesh.material
    material.color.set(fillColor ?? 0xffffff)
    material.opacity = fillColor === null ? 0 : fillOpacity
    material.transparent = true
  }

  public setRenderOrder(order: number) {
    this._fillMesh.renderOrder = order
    this._lines.forEach((line) => {
      line.renderOrder = order + 1
    })
  }

  private createLine(strokeColor: number, strokeWidth: number): Line2 {
    const geometry = new LineGeometry()
    geometry.setPositions([0, 0, 0, 1, 0, 0])
    const material = new LineMaterial({
      color: strokeColor,
      linewidth: strokeWidth * window.devicePixelRatio,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    return new Line2(geometry, material)
  }

  private setLinePositions(
    line: Line2,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ) {
    line.geometry.setPositions([x1, y1, 0, x2, y2, 0])
    line.geometry.computeBoundingSphere()
  }
}
