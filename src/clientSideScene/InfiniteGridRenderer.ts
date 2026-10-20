import type { OrthographicCamera } from 'three'
import {
  BufferGeometry,
  GLSL3,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  RawShaderMaterial,
  Vector3,
} from 'three'

type GridCamera = OrthographicCamera | PerspectiveCamera

const vertexShader = `precision highp float;

out vec2 vNdc;

void main()
{
	vec2 positions[3] = vec2[](
		vec2(-1.0, -1.0),
		vec2(3.0, -1.0),
		vec2(-1.0, 3.0)
	);

	vNdc = positions[gl_VertexID];
	gl_Position = vec4(vNdc, 0.0, 1.0);
}`

const fragmentShader = `precision highp float;

in vec2 vNdc;
out vec4 fragColor;

uniform mat4 uClipToGrid;
uniform bool uPerspective;
uniform float uMinorSpacing;
uniform float uMajorSpacing;
uniform vec4 uMajorColor;
uniform vec4 uMinorColor;
uniform bool uFadeDenseGrid;
uniform bool uShowAxes;
uniform float uPixelRatio;
uniform vec4 uXAxisColor;
uniform vec4 uYAxisColor;

vec3 clipToGrid(float ndcZ)
{
	vec4 point = uClipToGrid * vec4(vNdc, ndcZ, 1.0);
	return point.xyz / point.w;
}

float gridCoverage(vec2 point, float spacing)
{
	vec2 coordinate = point / spacing;
	vec2 distanceToLine = abs(fract(coordinate + 0.5) - 0.5);
	vec2 derivative = max(fwidth(coordinate), vec2(1e-6));
	vec2 coverage = 1.0 - smoothstep(vec2(0.0), derivative, distanceToLine);

	vec2 spacingPixels = 1.0 / derivative;
	if (uFadeDenseGrid)
	{
		// Fade the entire layer when either side of a cell becomes crowded.
		// Fading each line family separately leaves bright stripes at the horizon.
		float cellSpacing = min(spacingPixels.x, spacingPixels.y) / uPixelRatio;
		coverage *= smoothstep(3.0, 12.0, cellSpacing);
	}
	else
	{
		coverage *= smoothstep(vec2(1.0), vec2(2.0), spacingPixels);
	}

	return max(coverage.x, coverage.y);
}

void main()
{
	// Unproject two points on this fragment's camera ray into grid-local space.
	vec3 rayStart = clipToGrid(-1.0);
	vec3 rayPoint = clipToGrid(0.0);
	vec3 rayDirection = rayPoint - rayStart;

	// The grid plane is local z = 0.
	if (abs(rayDirection.z) < 1e-7)
	{
		discard;
	}

	float distanceAlongRay = -rayStart.z / rayDirection.z;
	// Perspective rays must not draw the plane behind the camera. Orthographic
	// rays may intersect before the near clip when the plane is tilted; the grid
	// is an overlay, so those intersections should still be rendered.
	if (uPerspective && distanceAlongRay < 0.0)
	{
		discard;
	}

	vec3 gridPoint = rayStart + distanceAlongRay * rayDirection;
	float minorCoverage = gridCoverage(gridPoint.xy, uMinorSpacing);
	float majorCoverage = gridCoverage(gridPoint.xy, uMajorSpacing);
	vec4 color = mix(uMinorColor, uMajorColor, majorCoverage);
	float alpha = color.a * max(minorCoverage, majorCoverage);
	if (uFadeDenseGrid)
	{
		alpha = max(uMinorColor.a * minorCoverage, uMajorColor.a * majorCoverage);
	}

	if (uShowAxes)
	{
		// These are single world-space lines, independent of the grid's spacing.
		vec2 pixelWidth = max(fwidth(gridPoint.xy), vec2(1e-6));
		vec2 distancePixels = abs(gridPoint.xy) / pixelWidth;
		vec2 axes = 1.0 - smoothstep(vec2(0.5), vec2(1.5), distancePixels / uPixelRatio);
		float xAlpha = axes.y * uXAxisColor.a;
		float yAlpha = axes.x * uYAxisColor.a;
		float axisAlpha = max(xAlpha, yAlpha);
		if (axisAlpha > 0.0)
		{
			vec3 axisColor = xAlpha > yAlpha ? uXAxisColor.rgb : uYAxisColor.rgb;
			color.rgb = mix(color.rgb, axisColor, axisAlpha / max(alpha, axisAlpha));
			alpha = max(alpha, axisAlpha);
		}
	}

	if (uFadeDenseGrid)
	{
		// Ray angle is evaluated per fragment, so distant cells fade before the
		// camera itself reaches a grazing angle. This also fades the axes.
		alpha *= smoothstep(0.035, 0.2, abs(normalize(rayDirection).z));
	}
	if (alpha <= 0.001)
	{
		discard;
	}
	fragColor = vec4(color.rgb, alpha);
}`

/**
 * Renders an infinite grid by intersecting each fragment's camera ray with the
 * object's local z = 0 plane. Grid lines are evaluated in local x/y coordinates,
 * so parent translation and rotation are reflected in the rendered grid.
 */
export class InfiniteGridRenderer extends Mesh<
  BufferGeometry,
  RawShaderMaterial
> {
  private minMinorGridPixelSpacing = 10
  private minMajorGridPixelSpacing = 10

  constructor(options: { fadeDenseGrid?: boolean; showAxes?: boolean } = {}) {
    const geometry = new BufferGeometry()
    geometry.name = 'InfiniteGridGeometry'
    geometry.setDrawRange(0, 3)

    const material = new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader,
      fragmentShader,
      uniforms: {
        uClipToGrid: { value: new Matrix4() },
        uPerspective: { value: false },
        uMinorSpacing: { value: 1.0 },
        uMajorSpacing: { value: 4.0 },
        uMajorColor: { value: [0.3, 0.3, 0.3, 1.0] },
        uMinorColor: { value: [0.2, 0.2, 0.2, 1.0] },
        uFadeDenseGrid: { value: options.fadeDenseGrid ?? false },
        uShowAxes: { value: options.showAxes ?? false },
        uPixelRatio: { value: 1 },
        uXAxisColor: { value: [220 / 255, 2 / 255, 31 / 255, 0.9] },
        uYAxisColor: { value: [22 / 255, 202 / 255, 51 / 255, 0.9] },
      },
      transparent: false,
      alphaToCoverage: true,
      depthTest: false,
      depthWrite: false,
    })

    super(geometry, material)
    this.name = 'InfiniteGridRenderer'

    this.renderOrder = -10
    this.frustumCulled = false
    this.raycast = () => {
      // The full-screen triangle is only a rendering implementation detail and
      // should not become a sketch pick target.
    }
  }

  /**
   * Returns the projected size of one grid-local unit in logical/CSS pixels.
   * The larger grid basis projection keeps adaptive spacing stable when one
   * basis direction is strongly foreshortened by camera rotation.
   */
  getPixelsPerBaseUnit(
    camera: GridCamera,
    viewportSize: [number, number]
  ): number {
    camera.updateMatrixWorld()
    camera.updateProjectionMatrix()
    this.updateWorldMatrix(true, false)

    const origin = this.localToWorld(new Vector3()).project(camera)
    const xUnit = this.localToWorld(new Vector3(1, 0, 0)).project(camera)
    const yUnit = this.localToWorld(new Vector3(0, 1, 0)).project(camera)
    const logicalViewportWidth = viewportSize[0] / window.devicePixelRatio
    const logicalViewportHeight = viewportSize[1] / window.devicePixelRatio

    const projectedLength = (point: Vector3) =>
      Math.hypot(
        ((point.x - origin.x) * logicalViewportWidth) / 2,
        ((point.y - origin.y) * logicalViewportHeight) / 2
      )

    const pixelsPerBaseUnit = Math.max(
      projectedLength(xUnit),
      projectedLength(yUnit)
    )

    return Number.isFinite(pixelsPerBaseUnit) ? pixelsPerBaseUnit : 1
  }

  update(
    camera: GridCamera,
    pixelsPerBaseUnit: number,
    gridScaleFactor: number,
    options: {
      majorGridSpacing: number
      minorGridsPerMajor: number
      majorColor: [number, number, number, number]
      minorColor: [number, number, number, number]
      fixedSizeGrid: boolean
    }
  ) {
    camera.updateMatrixWorld()
    camera.updateProjectionMatrix()
    this.updateWorldMatrix(true, false)

    let effectiveMajorSpacing = options.majorGridSpacing
    let effectiveMinorGridsPerMajor = options.minorGridsPerMajor
    let minorSpacing = effectiveMajorSpacing / options.minorGridsPerMajor

    if (!options.fixedSizeGrid) {
      effectiveMajorSpacing *= gridScaleFactor
      minorSpacing = effectiveMajorSpacing / options.minorGridsPerMajor
    }

    const majorSpacingPx = effectiveMajorSpacing * pixelsPerBaseUnit
    const minorSpacingPx = minorSpacing * pixelsPerBaseUnit

    let effectiveMinorSpacing = minorSpacing
    this.visible = true

    if (options.fixedSizeGrid && !this.material.uniforms.uFadeDenseGrid.value) {
      // If major grid would be too dense on screen, hide the grid entirely.
      if (majorSpacingPx < this.minMajorGridPixelSpacing) {
        this.visible = false
        return
      }

      // If minors are too small, collapse to majors only by using major spacing.
      if (minorSpacingPx < this.minMinorGridPixelSpacing) {
        effectiveMinorSpacing = effectiveMajorSpacing
        effectiveMinorGridsPerMajor = 1
      }
    }

    const material = this.material
    const clipToGrid = material.uniforms.uClipToGrid.value as Matrix4
    clipToGrid
      .copy(this.matrixWorld)
      .invert()
      .multiply(camera.matrixWorld)
      .multiply(camera.projectionMatrixInverse)

    material.uniforms.uMinorSpacing.value = effectiveMinorSpacing
    material.uniforms.uMajorSpacing.value = effectiveMajorSpacing
    material.uniforms.uPerspective.value = camera instanceof PerspectiveCamera
    material.uniforms.uPixelRatio.value = window.devicePixelRatio

    if (effectiveMinorGridsPerMajor === 1) {
      material.uniforms.uMinorColor.value = options.majorColor
    } else {
      material.uniforms.uMinorColor.value = options.minorColor
    }
    material.uniforms.uMajorColor.value = options.majorColor
  }
}
