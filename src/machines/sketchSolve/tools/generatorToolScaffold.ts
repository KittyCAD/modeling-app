import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type RustContext from '@src/lib/rustContext'
import type { KclManager } from '@src/lang/KclManager'
import type {
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'

export type Point2D = [x: number, y: number]

export type ToolUiEvent = { type: 'point'; point: Point2D } | { type: 'escape' }

export type ToolYield =
  | { type: 'await-center-point' }
  | { type: 'await-radius-point'; center: Point2D }
  | { type: 'commit-circle'; center: Point2D; radiusPoint: Point2D }

export type ToolCompletion = {
  reason: 'unequipped'
}

export type SketchToolInput =
  | { type: 'scene-click'; point: Point2D }
  | { type: 'scene-move'; point: Point2D }
  | { type: 'escape' }

export type SketchToolStatus = 'active' | 'unequipped'

export type SketchToolSnapshot = {
  instructionType: ToolYield['type'] | null
}

export interface SketchTool {
  readonly name: string
  equip(): Promise<void>
  advance(input: SketchToolInput): Promise<SketchToolStatus>
  cancel(): Promise<SketchToolStatus>
  unequip(): Promise<void>
  isEquipped(): boolean
  getSnapshot(): SketchToolSnapshot
}

export type CircleCommitResult = {
  kclSource: SourceDelta
  sceneGraphDelta: SceneGraphDelta
}

export type GeneratorToolContext = {
  sceneInfra: SceneInfra
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
  commitCircle?: (input: {
    centerPoint: Point2D
    startPoint: Point2D
  }) => Promise<CircleCommitResult>
  onSketchOutcome?: (outcome: CircleCommitResult) => void
  onRadiusPreview?: (center: Point2D, radiusPoint: Point2D) => void
  clearRadiusPreview?: () => void
}

type ToolFactory = (context: GeneratorToolContext) => SketchTool

type SceneClickArgs = {
  mouseEvent?: { which?: number }
  intersectionPoint?: { twoD?: { x: number; y: number } }
}

type SceneMoveArgs = {
  intersectionPoint?: { twoD?: { x: number; y: number } }
}

type SceneCallbacks = {
  onClick: (args?: SceneClickArgs) => void
  onMove: (args?: SceneMoveArgs) => void
}

const NOOP_CALLBACKS: SceneCallbacks = {
  onClick: () => {},
  onMove: () => {},
}

const UNEQUIP_TOOL = Symbol('unequip-tool')
const CANCEL_CURRENT_CIRCLE = Symbol('cancel-current-circle')

function* waitForCenterPoint(): Generator<
  ToolYield,
  Point2D | typeof UNEQUIP_TOOL,
  ToolUiEvent
> {
  const event = yield { type: 'await-center-point' }
  return event.type === 'escape' ? UNEQUIP_TOOL : event.point
}

function* waitForRadiusPoint(
  center: Point2D
): Generator<ToolYield, Point2D | typeof CANCEL_CURRENT_CIRCLE, ToolUiEvent> {
  const event = yield { type: 'await-radius-point', center }
  return event.type === 'escape' ? CANCEL_CURRENT_CIRCLE : event.point
}

abstract class GeneratorSketchTool<
  TInstruction extends { type: string },
  TResumeEvent extends { type: string },
  TCompletion,
> implements SketchTool
{
  private iterator?: Generator<TInstruction, TCompletion, TResumeEvent>
  private pendingResume: Promise<SketchToolStatus> =
    Promise.resolve('unequipped')
  protected instruction: TInstruction | null = null

  abstract readonly name: string

  constructor(protected readonly context: GeneratorToolContext) {}

  async equip() {
    const iterator = this.createGenerator()
    this.iterator = iterator

    const firstStep = iterator.next()
    if (firstStep.done) {
      await this.onComplete(firstStep.value)
      this.finish()
      return
    }

    this.instruction = firstStep.value
    await this.applyInstruction(firstStep.value)
  }

  abstract advance(input: SketchToolInput): Promise<SketchToolStatus>

  async cancel(): Promise<SketchToolStatus> {
    return this.advance({ type: 'escape' })
  }

  async unequip() {
    this.finish()
  }

  isEquipped(): boolean {
    return this.iterator !== undefined
  }

  getSnapshot(): SketchToolSnapshot {
    return {
      instructionType: (this.instruction?.type as ToolYield['type']) ?? null,
    }
  }

  protected abstract createGenerator(): Generator<
    TInstruction,
    TCompletion,
    TResumeEvent
  >

  protected abstract applyInstruction(instruction: TInstruction): Promise<void>

  protected dispatchResume(event: TResumeEvent): Promise<SketchToolStatus> {
    return this.enqueueResume(() => this.resumeGenerator(event))
  }

  protected continueGenerator(): Promise<SketchToolStatus> {
    return this.resumeGenerator()
  }

  protected setSceneCallbacks(callbacks: SceneCallbacks) {
    this.context.sceneInfra.setCallbacks(callbacks as any)
  }

  protected clearSceneCallbacks() {
    this.setSceneCallbacks(NOOP_CALLBACKS)
  }

  protected onTeardown() {}

  protected async onComplete(_completion: TCompletion) {}

  private enqueueResume(
    operation: () => Promise<SketchToolStatus>
  ): Promise<SketchToolStatus> {
    const nextResume = this.pendingResume.then(operation, operation)
    nextResume.catch(() => {})
    this.pendingResume = nextResume
    return nextResume
  }

  private async resumeGenerator(
    event?: TResumeEvent
  ): Promise<SketchToolStatus> {
    if (!this.iterator) {
      return 'unequipped'
    }

    const step =
      event === undefined ? this.iterator.next() : this.iterator.next(event)

    if (step.done) {
      await this.onComplete(step.value)
      this.finish()
      return 'unequipped'
    }

    this.instruction = step.value
    await this.applyInstruction(step.value)
    return 'active'
  }

  private finish() {
    this.onTeardown()
    this.iterator = undefined
    this.instruction = null
    this.clearSceneCallbacks()
  }
}

export class CircleTool extends GeneratorSketchTool<
  ToolYield,
  ToolUiEvent,
  ToolCompletion
> {
  readonly name = 'circleTool'

  async advance(input: SketchToolInput): Promise<SketchToolStatus> {
    switch (input.type) {
      case 'scene-click':
        return this.dispatchResume({ type: 'point', point: input.point })
      case 'scene-move':
        if (this.instruction?.type === 'await-radius-point') {
          this.context.onRadiusPreview?.(this.instruction.center, input.point)
        }
        return this.isEquipped() ? 'active' : 'unequipped'
      case 'escape':
        return this.dispatchResume({ type: 'escape' })
    }
  }

  protected createGenerator(): Generator<
    ToolYield,
    ToolCompletion,
    ToolUiEvent
  > {
    return this.flow()
  }

  protected async applyInstruction(instruction: ToolYield) {
    switch (instruction.type) {
      case 'await-center-point':
        this.context.clearRadiusPreview?.()
        this.setSceneCallbacks({
          onClick: (args) => {
            const point = readPoint(args)
            if (!point) {
              return
            }
            void this.advance({ type: 'scene-click', point })
          },
          onMove: () => {},
        })
        return

      case 'await-radius-point':
        this.setSceneCallbacks({
          onClick: (args) => {
            const point = readPoint(args)
            if (!point) {
              return
            }
            void this.advance({ type: 'scene-click', point })
          },
          onMove: (args) => {
            const point = readPoint(args)
            if (!point) {
              return
            }
            void this.advance({ type: 'scene-move', point })
          },
        })
        return

      case 'commit-circle': {
        this.context.clearRadiusPreview?.()
        const commitCircle = this.context.commitCircle
        if (!commitCircle) {
          throw new Error(
            'CircleTool requires a commitCircle implementation for commit-circle yields'
          )
        }
        const outcome = await commitCircle({
          centerPoint: instruction.center,
          startPoint: instruction.radiusPoint,
        })
        this.context.onSketchOutcome?.(outcome)
        await this.continueGenerator()
        return
      }
    }
  }

  protected override onTeardown() {
    this.context.clearRadiusPreview?.()
  }

  private *flow(): Generator<ToolYield, ToolCompletion, ToolUiEvent> {
    while (true) {
      const center = yield* waitForCenterPoint()
      if (center === UNEQUIP_TOOL) {
        return { reason: 'unequipped' }
      }

      const radiusPoint = yield* waitForRadiusPoint(center)
      if (radiusPoint === CANCEL_CURRENT_CIRCLE) {
        continue
      }

      yield {
        type: 'commit-circle',
        center,
        radiusPoint,
      }
    }
  }
}

export class MockSketchMode {
  private readonly tools = new Map<string, ToolFactory>()
  private activeTool?: SketchTool

  constructor(private readonly context: GeneratorToolContext) {}

  registerTool(name: string, factory: ToolFactory) {
    this.tools.set(name, factory)
  }

  getSnapshot() {
    return {
      equippedToolName: this.activeTool?.name ?? null,
      instructionType: this.activeTool?.getSnapshot().instructionType ?? null,
    }
  }

  async equipTool(name: string) {
    const factory = this.tools.get(name)
    if (!factory) {
      throw new Error(`Unknown tool: ${name}`)
    }

    await this.unequipTool()

    const tool = factory(this.context)
    await tool.equip()
    this.activeTool = tool.isEquipped() ? tool : undefined
  }

  async unequipTool() {
    if (!this.activeTool) {
      return
    }

    await this.activeTool.unequip()
    this.activeTool = undefined
  }

  async pressEscape() {
    if (!this.activeTool) {
      return
    }

    const status = await this.activeTool.cancel()
    if (status === 'unequipped') {
      this.activeTool = undefined
    }
  }

  async simulateSceneClick(point: Point2D) {
    if (!this.activeTool) {
      return
    }

    const status = await this.activeTool.advance({
      type: 'scene-click',
      point,
    })
    if (status === 'unequipped') {
      this.activeTool = undefined
    }
  }

  simulateSceneMove(point: Point2D) {
    void this.activeTool?.advance({
      type: 'scene-move',
      point,
    })
  }
}

function readPoint(args?: SceneClickArgs | SceneMoveArgs): Point2D | null {
  const twoD = args?.intersectionPoint?.twoD
  if (!twoD) {
    return null
  }

  return [twoD.x, twoD.y]
}
