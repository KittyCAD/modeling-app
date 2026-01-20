import type { Vector3 } from 'three'
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'

/**
 * Sets up a custom screen-space dot-dash shader for arc construction geometry.
 * This calculates distance along the arc curve using a constant centerline radius,
 * preventing skew that occurs when using per-fragment radius calculations.
 *
 * The key insight is that using a constant radius (from center to start point)
 * ensures all fragments at the same angular position use the same distance value,
 * preventing dash boundaries from shearing across the stroke width.
 */
export function setupConstructionArcDashShader(
  material: LineMaterial,
  arcCenter: Vector3,
  arcStart: Vector3,
  startAngle: number,
  endAngle: number,
  cacheKey: string
): void {
  // Set a unique cache key so each material gets its own shader program
  material.customProgramCacheKey = () => cacheKey

  material.onBeforeCompile = (shader) => {
    // Add uniforms for arc center and start point (used to calculate constant radius)
    shader.uniforms.uArcCenter = { value: arcCenter }
    shader.uniforms.uArcStart = { value: arcStart }
    shader.uniforms.uArcStartAngle = { value: startAngle }
    shader.uniforms.uArcEndAngle = { value: endAngle }

    // Add uniform declarations to vertex shader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `
#include <common>
uniform vec3 uArcCenter;
uniform vec3 uArcStart;
uniform float uArcStartAngle;
uniform float uArcEndAngle;
      `
    )

    // Add varying declarations to vertex shader
    const lastIncludeMatch = shader.vertexShader.match(
      /(#include\s+<[\w]+>[\s\S]*?)$/m
    )
    if (lastIncludeMatch) {
      shader.vertexShader = shader.vertexShader.replace(
        lastIncludeMatch[0],
        lastIncludeMatch[0] +
          `
varying vec2 vScreenArcCenter;
varying vec2 vScreenArcStart;
        `
      )
    } else {
      shader.vertexShader = shader.vertexShader.replace(
        'void main() {',
        `
varying vec2 vScreenArcCenter;
varying vec2 vScreenArcStart;

void main() {
        `
      )
    }

    // Calculate screen-space positions in vertex shader
    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      `
void main() {
  // Calculate screen-space positions for arc center and start
  vec4 uArcCenterClip = projectionMatrix * modelViewMatrix * vec4(uArcCenter, 1.0);
  vec4 uArcStartClip = projectionMatrix * modelViewMatrix * vec4(uArcStart, 1.0);
  vec2 uArcCenterNDC = uArcCenterClip.xy / uArcCenterClip.w;
  vec2 uArcStartNDC = uArcStartClip.xy / uArcStartClip.w;
  vScreenArcCenter = (uArcCenterNDC * 0.5 + 0.5) * resolution;
  vScreenArcStart = (uArcStartNDC * 0.5 + 0.5) * resolution;
        `
    )

    // Add uniform and varying declarations to fragment shader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `
#include <common>
uniform float uArcStartAngle;
uniform float uArcEndAngle;
      `
    )

    const fragLastIncludeMatch = shader.fragmentShader.match(
      /(#include\s+<[\w]+>[\s\S]*?)$/m
    )
    if (fragLastIncludeMatch) {
      shader.fragmentShader = shader.fragmentShader.replace(
        fragLastIncludeMatch[0],
        fragLastIncludeMatch[0] +
          `
varying vec2 vScreenArcCenter;
varying vec2 vScreenArcStart;
        `
      )
    } else {
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        `
varying vec2 vScreenArcCenter;
varying vec2 vScreenArcStart;

void main() {
        `
      )
    }

    // Replace the dashing logic with screen-space dot-dash pattern for arcs
    // Uses constant centerline radius to prevent skew across stroke width
    const dashPattern =
      /if\s*\(\s*mod\s*\(\s*vLineDistance[\s\S]*?\)\s*>\s*dashSize\s*\)\s*discard\s*;/
    if (dashPattern.test(shader.fragmentShader)) {
      shader.fragmentShader = shader.fragmentShader.replace(
        dashPattern,
        `
  // Screen-space dot-dash pattern for arcs: uses constant centerline radius
  vec2 screenCenter = vScreenArcCenter;
  vec2 screenStart = vScreenArcStart;
  vec2 screenPos = gl_FragCoord.xy;
  
  // Calculate constant screen-space radius from center to start point
  float R = length(screenStart - screenCenter);
  
  // Calculate angle from center to current fragment
  vec2 toFragment = screenPos - screenCenter;
  float fragmentAngle = atan(toFragment.y, toFragment.x);
  
  // Normalize angle to arc range and calculate arc length using constant radius
  float angleFromStart = fragmentAngle - uArcStartAngle;
  // Handle angle wrapping
  if (angleFromStart > 3.14159) angleFromStart -= 6.28318;
  if (angleFromStart < -3.14159) angleFromStart += 6.28318;
  
  // Calculate distance along arc using constant radius (prevents skew)
  float screenDistance = R * abs(angleFromStart);
  
  // Pattern definition (in screen pixels)
  float longDash = 8.0;
  float shortDash = 2.0;
  float gap = 6.0;
  float patternLength = longDash + gap + shortDash + gap;
  
  // Find position within pattern cycle
  float patternOffset = mod(screenDistance, patternLength);
  
  // Determine if we're in a dash or gap
  bool inDash = false;
  if (patternOffset < longDash) {
    inDash = true;
  } else if (patternOffset < longDash + gap) {
    inDash = false;
  } else if (patternOffset < longDash + gap + shortDash) {
    inDash = true;
  } else {
    inDash = false;
  }
  
  if (!inDash) discard;
        `
      )
    } else {
      // Fallback: replace the entire USE_DASH block
      shader.fragmentShader = shader.fragmentShader.replace(
        /#ifdef\s+USE_DASH[\s\S]*?#endif/,
        `
#ifdef USE_DASH
  // Screen-space dot-dash pattern for arcs: uses constant centerline radius
  vec2 screenCenter = vScreenArcCenter;
  vec2 screenStart = vScreenArcStart;
  vec2 screenPos = gl_FragCoord.xy;
  
  float R = length(screenStart - screenCenter);
  vec2 toFragment = screenPos - screenCenter;
  float fragmentAngle = atan(toFragment.y, toFragment.x);
  float angleFromStart = fragmentAngle - uArcStartAngle;
  if (angleFromStart > 3.14159) angleFromStart -= 6.28318;
  if (angleFromStart < -3.14159) angleFromStart += 6.28318;
  float screenDistance = R * abs(angleFromStart);
  
  float longDash = 8.0;
  float shortDash = 2.0;
  float gap = 6.0;
  float patternLength = longDash + gap + shortDash + gap;
  float patternOffset = mod(screenDistance, patternLength);
  bool inDash = false;
  if (patternOffset < longDash) {
    inDash = true;
  } else if (patternOffset < longDash + gap) {
    inDash = false;
  } else if (patternOffset < longDash + gap + shortDash) {
    inDash = true;
  } else {
    inDash = false;
  }
  
  if (!inDash) discard;
#endif
        `
      )
    }
  }
}

/**
 * Sets up a custom screen-space dot-dash shader for construction geometry.
 * This function injects shader code that calculates dash patterns in screen pixels,
 * ensuring dashes stay constant size regardless of zoom level.
 *
 * Works for straight segments (lines) that can be approximated by start and end points.
 */
export function setupConstructionDashShader(
  material: LineMaterial,
  segmentStart: Vector3,
  segmentEnd: Vector3,
  cacheKey: string
): void {
  // Set a unique cache key so each material gets its own shader program
  material.customProgramCacheKey = () => cacheKey

  material.onBeforeCompile = (shader) => {
    // Add uniforms for segment start/end positions in world space
    shader.uniforms.uSegmentStart = { value: segmentStart }
    shader.uniforms.uSegmentEnd = { value: segmentEnd }

    // Add uniform declarations to vertex shader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `
#include <common>
uniform vec3 uSegmentStart;
uniform vec3 uSegmentEnd;
      `
    )

    // Add varying declarations to vertex shader (must be at top level, before main)
    const lastIncludeMatch = shader.vertexShader.match(
      /(#include\s+<[\w]+>[\s\S]*?)$/m
    )
    if (lastIncludeMatch) {
      shader.vertexShader = shader.vertexShader.replace(
        lastIncludeMatch[0],
        lastIncludeMatch[0] +
          `
varying vec2 vScreenSegmentStart;
varying vec2 vScreenSegmentEnd;
        `
      )
    } else {
      // Fallback: add before main()
      shader.vertexShader = shader.vertexShader.replace(
        'void main() {',
        `
varying vec2 vScreenSegmentStart;
varying vec2 vScreenSegmentEnd;

void main() {
        `
      )
    }

    // Calculate screen-space positions in vertex shader
    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      `
void main() {
  // Calculate screen-space positions for segment start/end
  vec4 uSegmentStartClip = projectionMatrix * modelViewMatrix * vec4(uSegmentStart, 1.0);
  vec4 uSegmentEndClip = projectionMatrix * modelViewMatrix * vec4(uSegmentEnd, 1.0);
  vec2 uSegmentStartNDC = uSegmentStartClip.xy / uSegmentStartClip.w;
  vec2 uSegmentEndNDC = uSegmentEndClip.xy / uSegmentEndClip.w;
  vScreenSegmentStart = (uSegmentStartNDC * 0.5 + 0.5) * resolution;
  vScreenSegmentEnd = (uSegmentEndNDC * 0.5 + 0.5) * resolution;
        `
    )

    // Add varying declarations to fragment shader (must match vertex shader)
    const fragLastIncludeMatch = shader.fragmentShader.match(
      /(#include\s+<[\w]+>[\s\S]*?)$/m
    )
    if (fragLastIncludeMatch) {
      shader.fragmentShader = shader.fragmentShader.replace(
        fragLastIncludeMatch[0],
        fragLastIncludeMatch[0] +
          `
varying vec2 vScreenSegmentStart;
varying vec2 vScreenSegmentEnd;
        `
      )
    } else {
      // Fallback: add before main()
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        `
varying vec2 vScreenSegmentStart;
varying vec2 vScreenSegmentEnd;

void main() {
        `
      )
    }

    // Replace the dashing logic with screen-space dot-dash pattern
    // Pattern: 8px long dash, 6px gap, 2px short dash, 6px gap (repeat = 22px total)
    const dashPattern =
      /if\s*\(\s*mod\s*\(\s*vLineDistance[\s\S]*?\)\s*>\s*dashSize\s*\)\s*discard\s*;/
    if (dashPattern.test(shader.fragmentShader)) {
      shader.fragmentShader = shader.fragmentShader.replace(
        dashPattern,
        `
  // Screen-space dot-dash pattern: 8px long, 6px gap, 2px short, 6px gap (22px repeat)
  vec2 screenStart = vScreenSegmentStart;
  vec2 screenEnd = vScreenSegmentEnd;
  vec2 screenPos = gl_FragCoord.xy;
  vec2 lineDir = normalize(screenEnd - screenStart);
  vec2 toFragment = screenPos - screenStart;
  float screenDistance = dot(toFragment, lineDir);
  
  // Pattern definition (in screen pixels)
  float longDash = 8.0;
  float shortDash = 2.0;
  float gap = 6.0;
  float patternLength = longDash + gap + shortDash + gap;
  
  // Find position within pattern cycle
  float patternOffset = mod(screenDistance, patternLength);
  
  // Determine if we're in a dash or gap
  bool inDash = false;
  if (patternOffset < longDash) {
    // First long dash (0-8px)
    inDash = true;
  } else if (patternOffset < longDash + gap) {
    // First gap (8-14px)
    inDash = false;
  } else if (patternOffset < longDash + gap + shortDash) {
    // Short dash (14-16px)
    inDash = true;
  } else {
    // Second gap (16-22px)
    inDash = false;
  }
  
  if (!inDash) discard;
        `
      )
    } else {
      // Fallback: replace the entire USE_DASH block
      shader.fragmentShader = shader.fragmentShader.replace(
        /#ifdef\s+USE_DASH[\s\S]*?#endif/,
        `
#ifdef USE_DASH
  // Screen-space dot-dash pattern: 8px long, 6px gap, 2px short, 6px gap (22px repeat)
  vec2 screenStart = vScreenSegmentStart;
  vec2 screenEnd = vScreenSegmentEnd;
  vec2 screenPos = gl_FragCoord.xy;
  vec2 lineDir = normalize(screenEnd - screenStart);
  vec2 toFragment = screenPos - screenStart;
  float screenDistance = dot(toFragment, lineDir);
  
  float longDash = 8.0;
  float shortDash = 2.0;
  float gap = 6.0;
  float patternLength = longDash + gap + shortDash + gap;
  
  float patternOffset = mod(screenDistance, patternLength);
  bool inDash = false;
  if (patternOffset < longDash) {
    inDash = true;
  } else if (patternOffset < longDash + gap) {
    inDash = false;
  } else if (patternOffset < longDash + gap + shortDash) {
    inDash = true;
  } else {
    inDash = false;
  }
  
  if (!inDash) discard;
#endif
        `
      )
    }
  }
}
