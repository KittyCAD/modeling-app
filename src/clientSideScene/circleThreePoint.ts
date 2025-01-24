import {
  Group,
  Mesh,
  Vector3,
  Vector2,
  Object3D,
  SphereGeometry,
  MeshBasicMaterial,
  Color,
  BufferGeometry,
  LineDashedMaterial,
  Line,
} from 'three'

import { PathToNode, recast, parse, VariableDeclaration } from 'lang/wasm'
import { getNodeFromPath } from 'lang/queryAst'
import { LabeledArg } from 'wasm-lib/kcl/bindings/LabeledArg'
import { Literal } from 'wasm-lib/kcl/bindings/Literal'
import { calculate_circle_from_3_points } from 'wasm-lib/pkg/wasm_lib'
import { findUniqueName, createPipeExpression } from 'lang/modifyAst'

import { getThemeColorForThreeJs } from 'lib/theme'

import { err } from 'lib/trap'
import { codeManager } from 'lib/singletons'

import { SketchTool, NoOpTool } from './interfaceSketchTool'
import { createCircleGeometry } from './segments'
import { quaternionFromUpNForward } from './helpers'
import {
  SKETCH_LAYER,
  CIRCLE_3_POINT_DRAFT_POINT,
  CIRCLE_3_POINT_DRAFT_CIRCLE,
} from './sceneInfra'

interface InitArgs {
  scene: Scene
  intersectionPlane: any
  startSketchOnASTNodePath: PathToNode
  maybeExistingNodePath: PathToNode
  forward: Vector3
  up: Vector3
  sketchOrigin: Vector3

  // I want the intention to be clear, but keep done() semantics general.
  callDoneFnAfterBeingDefined?: true
  done: () => void
}

// The reason why InitArgs are not part of the CircleThreePoint constructor is
// because we may want to re-initialize the same instance many times, w/ init()
export function CircleThreePoint(initArgs: InitArgs): SketchTool {
  // lee: This is a bit long, but subsequent sketch tools don't need to detail
  // all this. Use this as a template for other tools.

  // The KCL to generate. Parses into an AST to be modified / manipulated.
  const selfASTNode = parse(`profileVarNameToBeReplaced = circleThreePoint(
    sketchVarNameToBeReplaced,
    p1 = [0.0, 0.0],
    p2 = [0.0, 0.0],
    p3 = [0.0, 0.0],
  )`)

  // AST node to work with. It's either an existing one, or a new one.

  let isNewSketch = true
  const astSnapshot = structuredClone(kclManager.ast)

  if (initArgs.maybeExistingNodePath.length === 0) {
    // Travel 1 node up from the sketch plane AST node, and append or
    // update the new profile AST node.

    // Get the index of the sketch AST node.
    // (It could be in a program or function body!)
    // (It could be in the middle of anywhere in the program!)
    // ['body', 'index']
    // [8, 'index'] <- ...[1]?.[0] refers to 8.
    const nextIndex = initArgs.startSketchOnASTNodePath[
      // - 3 puts us at the body of a function or the overall program
      initArgs.startSketchOnASTNodePath.length - 3
    ][0] + 1

    const bodyASTNode = getNodeFromPath<VariableDeclaration>(
      astSnapshot,
      Array.from(initArgs.startSketchOnASTNodePath).splice(
        0,
        initArgs.startSketchOnASTNodePath.length - 3
      ),
      'VariableDeclaration'
    )

    // In the event of an error, we return a no-op tool.
    // Should maybe consider something else, like ExceptionTool or something.
    // Logically there should never be an error.
    if (err(bodyASTNode)) return new NoOpTool()

    // Attach the node
    bodyASTNode.node.splice(nextIndex, 0, selfASTNode.program.body[0])
  } else {
    selfASTNode = getNodeFromPath<VariableDeclaration>(
      kclManager.ast,
      initArgs.maybeExistingNodePath,
      'VariableDeclaration'
    )
    if (err(selfASTNode)) return new NoOpTool()
    isNewSketch = false
  }
  
  // Keep track of points in the scene with their ThreeJS ids.
  const points: Map<number, Vector2> = new Map()

  // Keep a reference so we can destroy and recreate as needed.
  let groupCircle: Group | undefined

  // Add our new group to the list of groups to render
  const groupOfDrafts = new Group()
  groupOfDrafts.name = 'circle-3-point-group'
  groupOfDrafts.layers.set(SKETCH_LAYER)
  groupOfDrafts.traverse((child) => {
    child.layers.set(SKETCH_LAYER)
  })
  initArgs.scene.add(groupOfDrafts)

  // lee: Not a fan we need to re-iterate this dummy object all over the place
  // just to get the scale but okie dokie.
  const dummy = new Mesh()
  dummy.position.set(0, 0, 0)
  const scale = sceneInfra.getClientSceneScaleFactor(dummy)

  // How large the points on the circle will render as
  const DRAFT_POINT_RADIUS = 10 // px

  // The target of our dragging
  let target: Object3D | undefined = undefined

  this.destroy = async () => {
    initArgs.scene.remove(groupOfDrafts)
  }

  const createPoint = (
    center: Vector3,
    // This is to draw dots with no interactions; purely visual.
    opts?: { noInteraction?: boolean }
  ): Mesh => {
    const geometry = new SphereGeometry(DRAFT_POINT_RADIUS)
    const color = getThemeColorForThreeJs(sceneInfra._theme)

    const material = new MeshBasicMaterial({
      color: opts?.noInteraction
        ? sceneInfra._theme === 'light'
          ? new Color(color).multiplyScalar(0.15)
          : new Color(0x010101).multiplyScalar(2000)
        : color,
    })

    const mesh = new Mesh(geometry, material)
    mesh.userData = {
      type: opts?.noInteraction ? 'ghost' : CIRCLE_3_POINT_DRAFT_POINT,
    }
    mesh.renderOrder = 1000
    mesh.layers.set(SKETCH_LAYER)
    mesh.position.copy(center)
    mesh.scale.set(scale, scale, scale)
    mesh.renderOrder = 100

    return mesh
  }

  const createCircleThreePointGraphic = async (
    points: Vector2[],
    center: Vector2,
    radius: number
  ) => {
    if (
      Number.isNaN(radius) ||
      Number.isNaN(center.x) ||
      Number.isNaN(center.y)
    )
      return

    const color = getThemeColorForThreeJs(sceneInfra._theme)
    const lineCircle = createCircleGeometry({
      center: [center.x, center.y],
      radius,
      color,
      isDashed: false,
      scale: 1,
    })
    lineCircle.userData = { type: CIRCLE_3_POINT_DRAFT_CIRCLE }
    lineCircle.layers.set(SKETCH_LAYER)

    if (groupCircle) groupOfDrafts.remove(groupCircle)
    groupCircle = new Group()
    groupCircle.renderOrder = 1
    groupCircle.add(lineCircle)

    const pointMesh = createPoint(new Vector3(center.x, center.y, 0), {
      noInteraction: true,
    })
    groupCircle.add(pointMesh)

    const geometryPolyLine = new BufferGeometry().setFromPoints([
      ...points.map((p) => new Vector3(p.x, p.y, 0)),
      new Vector3(points[0].x, points[0].y, 0),
    ])
    const materialPolyLine = new LineDashedMaterial({
      color,
      scale: 1 / scale,
      dashSize: 6,
      gapSize: 6,
    })
    const meshPolyLine = new Line(geometryPolyLine, materialPolyLine)
    meshPolyLine.computeLineDistances()
    groupCircle.add(meshPolyLine)

    groupOfDrafts.add(groupCircle)
  }

  const insertCircleThreePointKclIntoASTSnapshot = (
    points: Vector2[],
  ): Program => {
    // Make TypeScript happy about selfASTNode property accesses.
    if (err(selfASTNode) || selfASTNode.program === null)
      return kclManager.ast
    if (selfASTNode.program.body[0].type !== 'VariableDeclaration')
      return kclManager.ast
    if (
      selfASTNode.program.body[0].declaration.init.type !==
      'CallExpressionKw'
    )
      return kclManager.ast

    // Make accessing the labeled arguments easier / less verbose
    const arg = (x: LabeledArg): Literal[] | undefined => {
      if (
        'arg' in x &&
        'elements' in x.arg &&
        x.arg.type === 'ArrayExpression'
      ) {
        if (x.arg.elements.every((x) => x.type === 'Literal')) {
          return x.arg.elements
        }
      }
      return undefined
    }

    // Set the `profileXXX =` variable name if not set
    if (
      selfASTNode.program.body[0].declaration.id.name ===
      'profileVarNameToBeReplaced'
    ) {
      const profileVarName = findUniqueName(astSnapshot, 'profile')
      selfASTNode.program.body[0].declaration.id.name = profileVarName
    }

    // Used to get the sketch variable name
    const startSketchOnASTNode = getNodeFromPath<VariableDeclaration>(
      astSnapshot,
      initArgs.startSketchOnASTNodePath,
      'VariableDeclaration'
    )
    if (err(startSketchOnASTNode)) return astSnapshot

    // Set the sketch variable name
    if (/^sketch/.test(startSketchOnASTNode.node.declaration.id.name)) {
      selfASTNode.program.body[0].declaration.init.unlabeled.name =
        startSketchOnASTNode.node.declaration.id.name
    }

    // Set the points 1-3
    const selfASTNodeArgs =
      selfASTNode.program.body[0].declaration.init.arguments

    const arg0 = arg(selfASTNodeArgs[0])
    if (!arg0) return kclManager.ast
    arg0[0].value = points[0].x
    arg0[0].raw = points[0].x.toString()
    arg0[1].value = points[0].y
    arg0[1].raw = points[0].y.toString()

    const arg1 = arg(selfASTNodeArgs[1])
    if (!arg1) return kclManager.ast
    arg1[0].value = points[1].x
    arg1[0].raw = points[1].x.toString()
    arg1[1].value = points[1].y
    arg1[1].raw = points[1].y.toString()

    const arg2 = arg(selfASTNodeArgs[2])
    if (!arg2) return kclManager.ast
    arg2[0].value = points[2].x
    arg2[0].raw = points[2].x.toString()
    arg2[1].value = points[2].y
    arg2[1].raw = points[2].y.toString()

    // Return the `Program`
    return astSnapshot
  }

  this.init = () => {
    groupOfDrafts.position.copy(initArgs.sketchOrigin)
    const orientation = quaternionFromUpNForward(initArgs.up, initArgs.forward)

    // Reminder: the intersection plane is the primary way to derive a XY
    // position from a mouse click in ThreeJS.
    // Here, we position and orient so it's facing the viewer.
    initArgs.intersectionPlane!.setRotationFromQuaternion(orientation)
    initArgs.intersectionPlane!.position.copy(initArgs.sketchOrigin)

    // lee: I'm keeping this here as a developer gotchya:
    // If you use 3D points, do not rotate anything.
    // If you use 2D points (easier to deal with, generally do this!), then
    // rotate the group just like this! Remember to rotate other groups too!
    groupOfDrafts.setRotationFromQuaternion(orientation)
    initArgs.scene.add(groupOfDrafts)

    // We're not working with an existing circleThreePoint.
    if (isNewSketch) return

    // Otherwise, we are :)
    // Use the points in the AST as starting points.
    const maybeVariableDeclaration = getNodeFromPath<VariableDeclaration>(
      astSnapshot,
      selfASTNode,
      'VariableDeclaration'
    )

    // This should never happen.
    if (err(maybeVariableDeclaration))
      return Promise.reject(maybeVariableDeclaration)

    const maybeCallExpressionKw = maybeVariableDeclaration.node.declaration.init
    if (
      maybeCallExpressionKw.type === 'CallExpressionKw' &&
      maybeCallExpressionKw.callee.name === 'circleThreePoint'
    ) {
      maybeCallExpressionKw?.arguments
        .map(
          ({ arg }: any) =>
            new Vector2(arg.elements[0].value, arg.elements[1].value)
        )
        .forEach((point: Vector2) => {
          const pointMesh = createPoint(new Vector3(point.x, point.y, 0))
          groupOfDrafts.add(pointMesh)
          points.set(pointMesh.id, point)
        })

      void this.update()
    }
  }

  this.update = async () => {
    const points_ = Array.from(points.values())
    const circleParams = calculate_circle_from_3_points(
      points_[0].x,
      points_[0].y,
      points_[1].x,
      points_[1].y,
      points_[2].x,
      points_[2].y
    )

    if (Number.isNaN(circleParams.radius)) return

    await createCircleThreePointGraphic(
      points_,
      new Vector2(circleParams.center_x, circleParams.center_y),
      circleParams.radius
    )
    const astWithNewCode = insertCircleThreePointKclIntoASTSnapshot(points_)
    const codeAsString = recast(astWithNewCode)
    if (err(codeAsString)) return
    codeManager.updateCodeStateEditor(codeAsString)
    return astWithNewCode
  }

  this.onDrag = async (args) => {
    const draftPointsIntersected = args.intersects.filter(
      (intersected) =>
        intersected.object.userData.type === CIRCLE_3_POINT_DRAFT_POINT
    )

    const firstPoint = draftPointsIntersected[0]
    if (firstPoint && !target) {
      target = firstPoint.object
    }

    // The user was off their mark! Missed the object to select.
    if (!target) return

    target.position.copy(
      new Vector3(
        args.intersectionPoint.twoD.x,
        args.intersectionPoint.twoD.y,
        0
      )
    )
    points.set(target.id, args.intersectionPoint.twoD)

    if (points.size <= 2) return

    await this.update()
  }

  this.onDragEnd = async (_args) => {
    target = undefined
  }

  this.onClick = async (args) => {
    if (points.size >= 3) return
    if (!args.intersectionPoint) return

    const pointMesh = createPoint(
      new Vector3(
        args.intersectionPoint.twoD.x,
        args.intersectionPoint.twoD.y,
        0
      )
    )
    groupOfDrafts.add(pointMesh)
    points.set(pointMesh.id, args.intersectionPoint.twoD)

    if (points.size <= 2) return

    const astWithNewCode = await this.update()

    if (initArgs.callDoneFnAfterBeingDefined) {
      // We "fake" execute to update the overall program memory.
      // setupSketch needs that memory to be updated.
      // We only do it at the very last moment before passing off control
      // because this sketch tool logic doesn't need that at all, and is
      // needless (sometimes heavy, but not here) computation.
      await kclManager.executeAstMock(astWithNewCode)
      initArgs.done()
    }
  }
}
