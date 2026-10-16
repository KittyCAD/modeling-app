import { registerFeatureTree } from '../src/web-components'

registerFeatureTree()
const options = new URLSearchParams(location.search)
const mount = document.querySelector<HTMLDivElement>('#mount')!
mount.dir = options.has('rtl') ? 'rtl' : 'ltr'
mount.style.cssText = 'width: 320px; height: 320px;'
const root = options.has('shadow')
  ? mount.attachShadow({ mode: 'open' })
  : mount
root.innerHTML = `
  <zoo-feature-tree appearance="hud" aria-label="Features">
    <zoo-feature-tree-row node-id="body" label="Housing">
      <zoo-feature-tree-row slot="children" node-id="sketch" label="Sketch001">
        <button slot="actions" id="visibility">Visibility</button>
        <button slot="actions" id="edit">Edit</button>
        <zoo-feature-tree-row slot="children" node-id="line" label="Construction line"></zoo-feature-tree-row>
      </zoo-feature-tree-row>
      <zoo-feature-tree-row slot="children" node-id="extrude" label="Extrude001 with a very long feature label"></zoo-feature-tree-row>
    </zoo-feature-tree-row>
    <zoo-feature-tree-row node-id="fillet" label="Fillet001"></zoo-feature-tree-row>
  </zoo-feature-tree>
`
const tree = root.querySelector('zoo-feature-tree')!
tree.expandedIds = ['body', 'sketch']
tree.selectedIds = ['sketch']
tree.addEventListener('zoo-expand', (event) => {
  const { nodeId, expanded } = (
    event as CustomEvent<{ nodeId: string; expanded: boolean }>
  ).detail
  tree.expandedIds = expanded
    ? [...tree.expandedIds, nodeId]
    : tree.expandedIds.filter((id) => id !== nodeId)
})
tree.addEventListener('zoo-selection-change', (event) => {
  tree.selectedIds = (
    event as CustomEvent<{ selectedIds: string[] }>
  ).detail.selectedIds
})
