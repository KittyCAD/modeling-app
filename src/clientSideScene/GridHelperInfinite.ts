import { Camera, OrthographicCamera } from 'three'
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

out float vLineType;

void main() {
	int totalVerticalVerts = verticalLines * 2;
	bool isVertical = gl_VertexID < totalVerticalVerts;
	
	vec2 screenPos;
	
	if (isVertical) {
		int lineIndex = gl_VertexID / 2;
		int vertIndex = gl_VertexID % 2;
		
		// Calculate world X position for this vertical line
		float startWorldX = floor(cameraPos.x / minorSpacing) * minorSpacing - float(verticalLines / 2) * minorSpacing;
		float worldX = startWorldX + float(lineIndex) * minorSpacing;
		
		// Convert to screen space
		float screenX = (worldX - cameraPos.x) * worldToScreenX;
		float screenY = (vertIndex == 0) ? -1.0 : 1.0;
		
		screenPos = vec2(screenX, screenY);
		
		// Check if this is a major line (every majorSpacing/minorSpacing lines)
		float majorInterval = majorSpacing / minorSpacing;
		vLineType = mod(abs(worldX), majorSpacing) < 0.001 ? 1.0 : 0.0;
		
	} else {
		int lineIndex = (gl_VertexID - totalVerticalVerts) / 2;
		int vertIndex = (gl_VertexID - totalVerticalVerts) % 2;
		
		// Calculate world Y position for this horizontal line  
		float startWorldY = floor(cameraPos.y / minorSpacing) * minorSpacing - float(horizontalLines / 2) * minorSpacing;
		float worldY = startWorldY + float(lineIndex) * minorSpacing;
		
		// Convert to screen space
		float screenX = (vertIndex == 0) ? -1.0 : 1.0;
		float screenY = (worldY - cameraPos.y) * worldToScreenY;
		
		screenPos = vec2(screenX, screenY);
		
		// Check if this is a major line
		vLineType = mod(abs(worldY), majorSpacing) < 0.001 ? 1.0 : 0.0;
	}
	
	gl_Position = vec4(screenPos, 0.0, 1.0);
}`

const fragmentShader = `precision highp float;

in float vLineType;
out vec4 fragColor;

void main() {
	vec3 majorColor = vec3(0.9, 0.9, 0.9);
	vec3 minorColor = vec3(0.3, 0.3, 0.3);
	
	float majorAlpha = 0.8;
	float minorAlpha = 0.4;
	
	vec3 color = vLineType > 0.5 ? majorColor : minorColor;
	float alpha = vLineType > 0.5 ? majorAlpha : minorAlpha;
	
	fragColor = vec4(color, alpha);
}`

export class GridHelperInfinite extends LineSegments {
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
      },
      transparent: false,
      depthTest: false,
      depthWrite: false,
    })

    super(geometry, material)

    this.renderOrder = -10
    this.frustumCulled = false
  }

  update(camera: Camera, majorSpacing: number, minorPerMajor: number) {
    if (!(camera instanceof OrthographicCamera)) {
      console.log(
        'Only orthographic cameras are supported for GridHelperInfinite'
      )
      return
    }
    const material = this.material as RawShaderMaterial

    const cameraPos = camera.position
    const zoom = camera.zoom

    const minorSpacing = majorSpacing / minorPerMajor

    // Calculate world viewport size
    const worldViewportWidth = (camera.right - camera.left) / zoom
    const worldViewportHeight = (camera.top - camera.bottom) / zoom

    // Calculate world-to-screen conversion separately for X and Y
    const worldToScreenX = 2 / worldViewportWidth
    const worldToScreenY = 2 / worldViewportHeight

    // Calculate how many lines we need to fill the screen (with padding)
    const verticalLines = Math.ceil(worldViewportWidth / minorSpacing) + 4
    const horizontalLines = Math.ceil(worldViewportHeight / minorSpacing) + 4

    // Update uniforms
    material.uniforms.verticalLines.value = verticalLines
    material.uniforms.horizontalLines.value = horizontalLines
    material.uniforms.cameraPos.value = [cameraPos.x, cameraPos.y]
    material.uniforms.worldToScreenX.value = worldToScreenX
    material.uniforms.worldToScreenY.value = worldToScreenY
    material.uniforms.minorSpacing.value = minorSpacing
    material.uniforms.majorSpacing.value = majorSpacing

    // Set draw range for total vertices needed
    const totalVertices = verticalLines * 2 + horizontalLines * 2
    this.geometry.setDrawRange(0, totalVertices)
  }
}
