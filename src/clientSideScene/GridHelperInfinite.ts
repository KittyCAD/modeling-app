import type {Camera} from 'three';
import { GLSL3} from 'three'
import {
	BufferGeometry,
	RawShaderMaterial,
	Mesh,
} from 'three'

const vertexShader = `precision highp float;

uniform int lineCount;
uniform float spacing;
uniform vec2 offset;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

out float vLineType;

void main() {
	int lineIndex = gl_VertexID / 2;
	int vertIndex = gl_VertexID % 2;
	
	bool isVertical = lineIndex < (lineCount / 2);
	
	vec3 pos;
	if (isVertical) {
		int vLineIndex = lineIndex;
		float x = offset.x + float(vLineIndex) * spacing;
		float y = (vertIndex == 0) ? offset.y - 1000.0 : offset.y + 1000.0;
		pos = vec3(x, y, 0.0);
	} else {
		int hLineIndex = lineIndex - (lineCount / 2);
		float x = (vertIndex == 0) ? offset.x - 1000.0 : offset.x + 1000.0;
		float y = offset.y + float(hLineIndex) * spacing;
		pos = vec3(x, y, 0.0);
	}
	
	vLineType = mod(float(lineIndex), 4.0) == 0.0 ? 1.0 : 0.0;
	
	gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`

const fragmentShader = `precision highp float;

in float vLineType;
out vec4 fragColor;

void main() {
	vec3 majorColor = vec3(0.5, 0.5, 0.5);
	vec3 minorColor = vec3(0.3, 0.3, 0.3);
	
	float majorAlpha = 0.8;
	float minorAlpha = 0.4;
	
	vec3 color = vLineType > 0.5 ? majorColor : minorColor;
	float alpha = vLineType > 0.5 ? majorAlpha : minorAlpha;
	
	fragColor = vec4(color, alpha);
}`

export class GridHelperInfinite extends Mesh {
	constructor() {
		const geometry = new BufferGeometry()
		
		const material = new RawShaderMaterial({
			glslVersion: GLSL3,
			vertexShader,
			fragmentShader,
			uniforms: {
				lineCount: { value: 100 },
				spacing: { value: 1.0 },
				offset: { value: [0.0, 0.0] },
				modelViewMatrix: { value: null },
				projectionMatrix: { value: null },
			},
			transparent: true,
			depthTest: false,
			depthWrite: false,
		})

		super(geometry, material)
		
		this.renderOrder = -10
		this.frustumCulled = false
	}

	update(camera: Camera, majorSpacing: number, minorPerMajor: number) {
		const material = this.material as RawShaderMaterial
		
		const cameraPos = camera.position
		const zoom = 'zoom' in camera ? (camera as any).zoom : 1
		const worldSize = 50 / zoom
		
		const minorSpacing = majorSpacing / minorPerMajor
		
		const linesPerSide = Math.ceil(worldSize / minorSpacing) + 10
		const totalLines = linesPerSide * 2
		
		const offsetX = Math.floor(cameraPos.x / minorSpacing) * minorSpacing - (linesPerSide / 2) * minorSpacing
		const offsetY = Math.floor(cameraPos.y / minorSpacing) * minorSpacing - (linesPerSide / 2) * minorSpacing
		
		material.uniforms.lineCount.value = totalLines
		material.uniforms.spacing.value = minorSpacing
		material.uniforms.offset.value = [offsetX, offsetY]
		material.uniforms.modelViewMatrix.value = this.modelViewMatrix
		material.uniforms.projectionMatrix.value = camera.projectionMatrix
		
		this.geometry.setDrawRange(0, totalLines * 2)
	}
} 
