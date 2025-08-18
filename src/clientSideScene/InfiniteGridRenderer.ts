import type { Camera } from 'three'
import { Vector3 } from 'three'
import { OrthographicCamera } from 'three'
import { GLSL3, LineSegments } from 'three'
import { BufferGeometry, RawShaderMaterial } from 'three'

const vertexShader = `precision highp float;

uniform int verticalLines;
uniform int horizontalLines;
uniform vec2 viewportPx; // (drawing buffer width, height) in pixels

uniform vec2 lineGapNDC;
uniform vec2 lineOffsetNDC;
uniform int minorsPerMajor;

out float vLineType;

float snapToPixel(float ndcCoord, float viewport)
{
	// NDC [-1,1] -> pixels [0, viewport]
	float px = (ndcCoord * 0.5 + 0.5) * viewport;

	// Snap to pixel *centers* for crisp 1px lines
	px = round(px - 0.5) + 0.5;

	// Back to NDC
	return (px / viewport - 0.5) * 2.0;
}

void main()
{
	int totalVerticalVerts = verticalLines * 2;
	bool isVertical = gl_VertexID < totalVerticalVerts;

	vec2 screenPos;

	if (isVertical)
	{
		int lineIndex = gl_VertexID / 2;
		int vertIndex = gl_VertexID % 2;

		float screenX = lineOffsetNDC.x + float(lineIndex) * lineGapNDC.x;
		float screenY = (vertIndex == 0) ? -1.0 : 1.0;
		screenX = snapToPixel(screenX, viewportPx.x);
		screenPos = vec2(screenX, screenY);

		vLineType = lineIndex % minorsPerMajor == 0 ? 1.0 : 0.0;
	}
	else
	{
		int lineIndex = (gl_VertexID - totalVerticalVerts) / 2;
		int vertIndex = (gl_VertexID - totalVerticalVerts) % 2;

		float screenX = (vertIndex == 0) ? -1.0 : 1.0;
		float screenY = lineOffsetNDC.y + float(lineIndex) * lineGapNDC.y;
		screenY = snapToPixel(screenY, viewportPx.y);
		screenPos = vec2(screenX, screenY);

		vLineType = lineIndex % minorsPerMajor == 0 ? 1.0 : 0.0;
	}

	gl_Position = vec4(screenPos, 0.0, 1.0);
}`

const fragmentShader = `precision highp float;

in float vLineType;
out vec4 fragColor;

uniform vec4 uMajorColor;
uniform vec4 uMinorColor;

void main()
{
	fragColor = vLineType > 0.5 ? uMajorColor : uMinorColor;
}`

export class InfiniteGridRenderer extends LineSegments<
  BufferGeometry,
  RawShaderMaterial
> {
  private minMinorGridPixelSpacing = 10
  private minMajorGridPixelSpacing = 10

  constructor() {
    const geometry = new BufferGeometry()
    geometry.name = 'InfiniteGridGeometry'

    const material = new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader,
      fragmentShader,
      uniforms: {
        verticalLines: { value: 50 },
        horizontalLines: { value: 50 },
        cameraPos: { value: [0.0, 0.0] },
        worldToScreenX: { value: 0.1 },
        worldToScreenY: { value: 0.1 },
        minorSpacing: { value: 1.0 },
        majorSpacing: { value: 4.0 },
        viewportPx: { value: [1.0, 1.0] },
        lineGapNDC: { value: [1.0, 1.0] },
        lineOffsetNDC: { value: [-1.0, -1.0] },
        minorsPerMajor: { value: 4 },
        uMajorColor: { value: [0.3, 0.3, 0.3, 1.0] },
        uMinorColor: { value: [0.2, 0.2, 0.2, 1.0] },
      },
      transparent: false,
      depthTest: false,
      depthWrite: false,
    })

    super(geometry, material)
    this.name = 'InfiniteGridRenderer'

    this.renderOrder = -10
    this.frustumCulled = false
    this.raycast = () => {
      // Disable raycasting: there are no vertices so it wouldn't work anyway, we also don't want to pick the grid
    }
  }

  update(
    camera: Camera,
    viewportSize: [number, number],
    pixelsPerBaseUnit: number,
    baseUnitMultiplier: number,
    options: {
      majorGridSpacing: number
      minorGridsPerMajor: number
      majorColor: [number, number, number, number]
      minorColor: [number, number, number, number]
      fixedSizeGrid: boolean
      majorPxRange: [number, number]
    }
  ) {
    if (!(camera instanceof OrthographicCamera)) {
      console.log(
        'Only orthographic cameras are supported for GridHelperInfinite'
      )
      return
    }

    // Needed for unproject to work correctly. Other option would be to use mesh.onBeforeRender
    camera.updateMatrixWorld()
    camera.updateProjectionMatrix()

    let effectiveMajorSpacing = options.majorGridSpacing
    let minorSpacing = effectiveMajorSpacing / options.minorGridsPerMajor

    const viewportWidthPx = viewportSize[0]
    const viewportHeightPx = viewportSize[1]

    if (!options.fixedSizeGrid) {
      // In non-fixed size mode, adjust major spacing based on current zoom level
      const desiredMin = options.majorPxRange[0]
      const desiredMax = options.majorPxRange[1]
      let majorPx = effectiveMajorSpacing * pixelsPerBaseUnit

      while (majorPx < desiredMin) {
        effectiveMajorSpacing *= 10
        majorPx *= 10
      }
      while (majorPx > desiredMax) {
        effectiveMajorSpacing /= 10
        majorPx /= 10
      }
      minorSpacing =
        effectiveMajorSpacing / Math.max(1, options.minorGridsPerMajor)
    }

    const majorSpacingPx = effectiveMajorSpacing * pixelsPerBaseUnit
    let minorSpacingPx = minorSpacing * pixelsPerBaseUnit

    let effectiveMinorSpacing = minorSpacing
    this.visible = true

    if (options.fixedSizeGrid) {
      // If major grid would be too dense on screen, hide the grid entirely
      if (majorSpacingPx < this.minMajorGridPixelSpacing) {
        this.visible = false
        return
      }

      // If minors are too small, collapse to majors only by using major spacing
      if (minorSpacingPx < this.minMinorGridPixelSpacing) {
        effectiveMinorSpacing = effectiveMajorSpacing
      }
    }

    const lineGap = effectiveMinorSpacing * pixelsPerBaseUnit
    const lineGapNDC = [
      (lineGap / viewportWidthPx) * 2 * window.devicePixelRatio,
      (lineGap / viewportHeightPx) * 2 * window.devicePixelRatio,
    ]

    const ndc = new Vector3(-1, -1, 0)
    ndc.unproject(camera)
    const leftEdge = ndc.y / baseUnitMultiplier
    const bottomEdge = ndc.z / baseUnitMultiplier

    const baseUnitToNDC = [
      (pixelsPerBaseUnit / viewportWidthPx) * 2 * window.devicePixelRatio,
      (pixelsPerBaseUnit / viewportHeightPx) * 2 * window.devicePixelRatio,
    ]
    const leftFractional = leftEdge - Math.floor(leftEdge)
    const bottomFractional = bottomEdge - Math.floor(bottomEdge)

    const lineOffsetNDC = [
      -1 - leftFractional * baseUnitToNDC[0],
      -1 - bottomFractional * baseUnitToNDC[1],
    ]

    // We need as many lines as to cover the whole screen
    const gridAreaSizeNDC = [
      (1 - lineOffsetNDC[0]) / lineGapNDC[0],
      (1 - lineOffsetNDC[1]) / lineGapNDC[1],
    ]
    const lineCount = [
      Math.ceil(gridAreaSizeNDC[0] / lineGapNDC[0]),
      Math.ceil(gridAreaSizeNDC[1] / lineGapNDC[1]),
    ]

    const material = this.material
    material.uniforms.verticalLines.value = lineCount[0]
    material.uniforms.horizontalLines.value = lineCount[1]
    material.uniforms.viewportPx.value = [viewportWidthPx, viewportHeightPx]
    material.uniforms.lineGapNDC.value = lineGapNDC
    material.uniforms.lineOffsetNDC.value = lineOffsetNDC
    material.uniforms.minorsPerMajor.value = 1 / effectiveMinorSpacing

    if (options?.majorColor) {
      material.uniforms.uMajorColor.value = options.majorColor
    }
    if (options?.minorColor) {
      material.uniforms.uMinorColor.value = options.minorColor
    }

    const totalVertices = lineCount[0] * 2 + lineCount[1] * 2
    this.geometry.setDrawRange(0, totalVertices)
  }
}
