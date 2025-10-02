/**
 * For now we have strict area types but in future
 * we should make it possible to register your own in an extension.
 */
export const areaTypeRegistry = Object.freeze({
  modeling: (
    <div className="self-stretch flex-1 grid place-content-center">
      Modeling!
    </div>
  ),
  ttc: (
    <div className="self-stretch flex-1 grid place-content-center">
      Text-to-CAD!
    </div>
  ),
  variables: (
    <div className="self-stretch flex-1 grid place-content-center">
      Variables
    </div>
  ),
  codeEditor: (
    <div className="self-stretch flex-1 grid place-content-center">
      Code Editor
    </div>
  ),
  featureTree: (
    <div className="self-stretch flex-1 grid place-content-center">
      Feature Tree
    </div>
  ),
})
