import { Models } from '@kittycad/lib'
import { EngineCommandManager } from './engineConnection'
import { v4 as uuidv4 } from 'uuid'
import { DefaultPlanes as DefaultPlanesType } from 'wasm-lib/kcl/bindings/DefaultPlanes'

export class DefaultPlanes {
  planes: DefaultPlanesType = { xy: '', yz: '', xz: '' }
  private ecm: EngineCommandManager
  onPlaneSelectCallback = (id: string) => {}
  constructor(engineConnectionManager: EngineCommandManager) {
    this.ecm = engineConnectionManager

    /*this.ecm.waitForReady.then(() => {

      this.ecm.subscribeTo({
        event: 'select_with_point',
        callback: ({ data }) => {
          if (!data?.entity_id) return
          if (
            ![this.planes.xy, this.planes.yz, this.planes.xz].includes(
              data.entity_id
            )
          )
            return
          this.onPlaneSelectCallback(data.entity_id)
        },
      })
    })*/
  }
}
