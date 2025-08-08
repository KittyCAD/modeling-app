import type { Camera } from 'three'
import { OrthographicCamera } from 'three'
import { GLSL3, LineSegments } from 'three'
import { BufferGeometry, RawShaderMaterial } from 'three'

const vertexShader = `precision highp float;

uniform int verticalLines;
uniform int horizontalLines;
uniform vec2 cameraPos;
uniform float worldToScreenX;
uniform float worldToScreenY;
uniform float minorSpacing;
uniform float majorSpacing;
uniform vec2 viewportPx; // (drawing buffer width, height) in pixels

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

		float startWorldX = floor(cameraPos.x / minorSpacing) * minorSpacing - float(verticalLines / 2) * minorSpacing;
		float worldX = startWorldX + float(lineIndex) * minorSpacing;

		float screenX = (worldX - cameraPos.x) * worldToScreenX;
		float screenY = (vertIndex == 0) ? -1.0 : 1.0;

		// Snap X to integer pixels
		screenX = snapToPixel(screenX, viewportPx.x);

		screenPos = vec2(screenX, screenY);

		vLineType = mod(abs(worldX), majorSpacing) < 0.001 ? 1.0 : 0.0;
	}
	else
	{
		int lineIndex = (gl_VertexID - totalVerticalVerts) / 2;
		int vertIndex = (gl_VertexID - totalVerticalVerts) % 2;

		float startWorldY = floor(cameraPos.y / minorSpacing) * minorSpacing - float(horizontalLines / 2) * minorSpacing;
		float worldY = startWorldY + float(lineIndex) * minorSpacing;

		float screenX = (vertIndex == 0) ? -1.0 : 1.0;
		float screenY = (worldY - cameraPos.y) * worldToScreenY;

		// Snap Y to integer pixels
		screenY = snapToPixel(screenY, viewportPx.y);

		screenPos = vec2(screenX, screenY);

		vLineType = mod(abs(worldY), majorSpacing) < 0.001 ? 1.0 : 0.0;
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

export class InfiniteGridRenderer extends LineSegments {
  private minMinorGridPixelSpacing = 10
  private minMajorGridPixelSpacing = 10

  constructor() {
    const geometry = new BufferGeometry()

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
        viewportPx: { value: [1.0, 1.0] }, // set real size in update()
        uMajorColor: { value: [0.3, 0.3, 0.3, 1.0] },
        uMinorColor: { value: [0.2, 0.2, 0.2, 1.0] },
      },
      transparent: false,
      depthTest: false,
      depthWrite: false,
    })

    super(geometry, material)

    this.renderOrder = -10
    this.frustumCulled = false
  }

  update(
    camera: Camera,
    majorSpacing: number,
    minorPerMajor: number,
    viewportWidthPx: number,
    viewportHeightPx: number,
    options?: {
      majorColor?: [number, number, number, number]
      minorColor?: [number, number, number, number]
    }
  ) {
    if (!(camera instanceof OrthographicCamera)) {
      console.log(
        'Only orthographic cameras are supported for GridHelperInfinite'
      )
      return
    }

    const material = this.material as RawShaderMaterial

    const zoom = camera.zoom
    const minorSpacing = majorSpacing / Math.max(1, minorPerMajor)

    const worldViewportWidth = (camera.right - camera.left) / zoom
    const worldViewportHeight = (camera.top - camera.bottom) / zoom

    const worldToScreenX = 2 / worldViewportWidth
    const worldToScreenY = 2 / worldViewportHeight

    const pxPerWorldX = viewportWidthPx / worldViewportWidth
    const pxPerWorldY = viewportHeightPx / worldViewportHeight
    const minorSpacingPx = Math.min(
      minorSpacing * pxPerWorldX,
      minorSpacing * pxPerWorldY
    )
    const majorSpacingPx = Math.min(
      majorSpacing * pxPerWorldX,
      majorSpacing * pxPerWorldY
    )

    // If major grid would be too dense on screen, hide the grid entirely
    if (majorSpacingPx < this.minMajorGridPixelSpacing) {
      this.visible = false
      return
    }
    this.visible = true

    // If minors are too small, collapse to majors only by using major spacing
    const effectiveMinorSpacing =
      minorSpacingPx < this.minMinorGridPixelSpacing
        ? majorSpacing
        : minorSpacing

    const verticalLines =
      Math.ceil(worldViewportWidth / effectiveMinorSpacing) + 2
    const horizontalLines =
      Math.ceil(worldViewportHeight / effectiveMinorSpacing) + 2

    material.uniforms.verticalLines.value = verticalLines
    material.uniforms.horizontalLines.value = horizontalLines
    material.uniforms.cameraPos.value = [camera.position.y, camera.position.z]
    material.uniforms.worldToScreenX.value = worldToScreenX
    material.uniforms.worldToScreenY.value = worldToScreenY
    material.uniforms.minorSpacing.value = effectiveMinorSpacing
    material.uniforms.majorSpacing.value = majorSpacing
    material.uniforms.viewportPx.value = [viewportWidthPx, viewportHeightPx]

    // Optional theme-based colors
    if (options?.majorColor)
      material.uniforms.uMajorColor.value = options.majorColor
    if (options?.minorColor)
      material.uniforms.uMinorColor.value = options.minorColor

    const totalVertices = verticalLines * 2 + horizontalLines * 2
    this.geometry.setDrawRange(0, totalVertices)
  }
}
