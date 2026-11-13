// Temporary SDK augmentation generated from kittycad.ts bd014c5e0b133f95c36a05f6f46252f5f2a6bf4d.
// Remove when the published SDK includes the native B-rep contract.
import '@kittycad/lib'

declare module '@kittycad/lib' {
  export interface NativeBrepBody {
    brep: NativeBrepBrep
    id: string
  }
  export interface NativeBrepBrep {
    curves2D: NativeBrepCurve[]
    faces: NativeBrepFace[]
    loops: NativeBrepTrimLoop[]
    surfaces: NativeBrepSurface[]
  }
  export interface NativeBrepCircle {
    origin?: number[]
    radius: number
    xAxis?: number[]
    yAxis?: number[]
  }
  export type NativeBrepCoordinateSystem = 'z-up'
  export type NativeBrepCurve =
    | {
        line: NativeBrepLine
        type: 'line'
      }
    | {
        circle: NativeBrepCircle
        type: 'circle'
      }
    | {
        nurbs: NativeBrepNurbsCurve
        type: 'nurbs'
      }
  export interface NativeBrepFace {
    loops: number[][]
    surface: number[]
  }
  export interface NativeBrepLine {
    direction: number[]
    origin?: number[]
  }
  export interface NativeBrepNurbs {
    closed?: boolean[]
    controlPoints: number[][]
    knotVector: number[]
    numControlPoints: number[]
    numKnots: number[]
    order: number[]
    weights?: number[]
  }
  export interface NativeBrepNurbsCurve {
    controlPoints: number[][]
    knotVector: number[]
    order: number
    weights?: number[]
  }
  export interface NativeBrepPlane {
    origin?: number[]
    xAxis?: number[]
    yAxis?: number[]
  }
  export interface NativeBrepSceneSnapshot {
    bodies: NativeBrepBody[]
    coordinateSystem: NativeBrepCoordinateSystem
    errors: string[]
    version: number
  }
  export interface NativeBrepSnapshot {
    brep: NativeBrepBrep
    version: number
  }
  export type NativeBrepSurface =
    | {
        plane: NativeBrepPlane
        type: 'plane'
      }
    | {
        nurbs: NativeBrepNurbs
        type: 'nurbs'
      }
  export interface NativeBrepTrace {
    curve: number[]
    t: number[]
  }
  export interface NativeBrepTrimLoop {
    traces?: NativeBrepTrace[]
  }
}
