import type { Freedom } from '@rust/kcl-lib/bindings/FrontendApi'
import { SKETCH_LAYER } from '@src/clientSideScene/sceneUtils'
import { sceneInfra } from '@src/lib/singletons'
import { getThemeColorForThreeJs, type Themes } from '@src/lib/theme'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three'

type SegmentInputs = {
  type: 'point'
  position: [number, number]
  freedom: Freedom
}

interface CreateSegmentArgs {
  input: SegmentInputs
  theme: Themes
  id: number
  scale: number
}

interface UpdateSegmentArgs {
  input: SegmentInputs
  theme: Themes
  id: number
  scale: number
  group: Group
}

export interface SegmentUtils {
  /**
   * the init is responsible for adding all of the correct entities to the group with important details like `mesh.name = ...`
   * as these act like handles later
   *
   * It's **Not** responsible for doing all calculations to size and position the entities as this would be duplicated in the update function
   * Which should instead be called at the end of the init function
   */
  init: (args: CreateSegmentArgs) => any
  /**
   * The update function is responsible for updating the group with the correct size and position of the entities
   * It should be called at the end of the init function and return a callback that can be used to update the overlay
   *
   * It returns a callback for updating the overlays, this is so the overlays do not have to update at the same pace threeJs does
   * This is useful for performance reasons
   */
  update: (args: UpdateSegmentArgs) => any
}

class PointSegment implements SegmentUtils {
  init = async (args: CreateSegmentArgs) => {
    if (args.input.type !== 'point') {
      return Promise.reject(new Error('Invalid input type for PointSegment'))
    }
    const segmentGroup = new Group()
    // const boxSize = 3/args.scale
    const box = new BoxGeometry(12, 12, 12)
    // const box = new BoxGeometry(300, 300, 300)
    const body = new MeshBasicMaterial({ color: 0xffffff, depthTest: false })
    const mesh = new Mesh(box, body)
    mesh.userData.type = 'yo'
    mesh.name = 'yo'
    segmentGroup.name = args.id.toString()
    segmentGroup.userData = {
      type: 'point',
    }
    segmentGroup.add(mesh)
    segmentGroup.traverse((child) => {
      child.layers.set(SKETCH_LAYER)
    })
    mesh.layers.set(SKETCH_LAYER)
    console.log('cam', sceneInfra.camControls)

    await this.update({
      input: args.input,
      theme: args.theme,
      id: args.id,
      scale: args.scale,
      group: segmentGroup,
    })
    return segmentGroup
  }

  update(args: UpdateSegmentArgs) {
    if (args.input.type !== 'point') {
      return Promise.reject(new Error('Invalid input type for PointSegment'))
    }
    const [x, y] = args.input.position
    args.group.scale.set(args.scale, args.scale, args.scale)
    const mesh = args.group.getObjectByName(args.id.toString())
    console.log('mesh?', mesh, args)
    if (mesh) {
      console.log(
        'setting position',
        x,
        y,
        args.scale,
        args.input.position,
        args
      )

      mesh.position.set(x, y, 0)
      // mesh.position.set(x*args.scale, y*args.scale, 0)
    }
    // args.group.position.set(x, y, 0)
    console.log('got all teh way here')
  }
}

export const segmentUtilsMap = {
  PointSegment: new PointSegment(),
}
