import { Models } from '@kittycad/lib'
import { EngineCommandManager } from './engineConnection'
import { v4 as uuidv4 } from 'uuid'

export class DefaultPlanes {
  xy: string = ''
  // yz: string = ''
  // xz: string = ''
  private ecm: EngineCommandManager
  onPlaneSelectCallback = (id: string) => {}
  constructor(engineConnectionManager: EngineCommandManager) {
    this.ecm = engineConnectionManager
    this.ecm.waitForReady.then(() => {
      this.initPlanes()

      this.ecm.subscribeTo({
        event: 'select_with_point',
        callback: ({ data }) => {
          if (!data?.entity_id) return
          if (![this.xy /*, this.yz, this.xz*/].includes(data.entity_id)) return
          this.onPlaneSelectCallback(data.entity_id)
        },
      })
    })
  }

  onPlaneSelected(callback: (id: string) => void) {
    this.onPlaneSelectCallback = callback
  }

  showPlanes() {
    this.setPlaneHidden(this.xy, false)
    // this.setPlaneHidden(this.yz,false)
    // this.setPlaneHidden(this.xz,false)
  }

  hidePlanes() {
    this.setPlaneHidden(this.xy, true)
    // this.setPlaneHidden(this.yz,true)
    // this.setPlaneHidden(this.xz,true)
  }

  private initPlanes() {
    const [xy /*, yz, xz*/] = [
      this.createPlane({
        x_axis: { x: 1, y: 0, z: 0 },
        y_axis: { x: 0, y: 1, z: 0 },
        color: { r: 0.7, g: 0.28, b: 0.28, a: 0.4 },
      }),
      // TODO re-enable
      // this.createPlane({
      //   x_axis: { x: 0, y: 1, z: 0 },
      //   y_axis: { x: 0, y: 0, z: 1 },
      //   color: { r: 0.28, g: 0.7, b: 0.28, a: 0.4 },
      // })
      // this.createPlane({
      //   x_axis: { x: 1, y: 0, z: 0 },
      //   y_axis: { x: 0, y: 0, z: 1 },
      //   color: { r: 0.28, g: 0.28, b: 0.7, a: 0.4 },
      // })
    ]
    this.xy = xy
    // this.yz = yz
    // this.xz = xz
  }

  private setPlaneHidden(id: string, hidden: boolean): Promise<string> {
    return this.ecm.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'object_visible',
        object_id: id,
        hidden: hidden,
      },
    })
  }

  private createPlane({
    x_axis,
    y_axis,
    color,
  }: {
    x_axis: Models['Point3d_type']
    y_axis: Models['Point3d_type']
    color: Models['Color_type']
  }): string {
    const planeId = uuidv4()
    this.ecm.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd: {
        type: 'make_plane',
        size: 60,
        origin: { x: 0, y: 0, z: 0 },
        x_axis,
        y_axis,
        clobber: false,
      },
      cmd_id: planeId,
    })
    this.ecm.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd: {
        type: 'plane_set_color',
        plane_id: planeId,
        color,
      },
      cmd_id: uuidv4(),
    })
    this.setPlaneHidden(planeId, true)
    return planeId
  }
}
