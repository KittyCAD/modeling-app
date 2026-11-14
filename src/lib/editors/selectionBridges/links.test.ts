import { expect, it } from 'vitest'
import { signal, computed } from '@preact/signals-core'
import { Registry, Slot, provide, defineRegistryItem } from '@kittycad/registry'
import extension from '@src/lib/editors/selectionBridges/registry'
import { createEditorSelectionBridges } from '@src/lib/editors/selectionBridges/links'
import {
  editorSelectionBridgeDefinitions,
  editorSelectionEndpointsService,
  editorSelectionLinksService,
  type EditorSelectionBridgeDefinition,
} from '@src/lib/editors/selectionBridges/contract'

const diagram: EditorSelectionBridgeDefinition = {
  id: 'diagram.source',
  sourceKind: 'text',
  targetKind: 'diagram',
  linkSameEditor: true,
}
it('supports a non-KCL adapter and chooses no picking destination when several linked targets exist', () => {
  const owner = createEditorSelectionBridges(signal([diagram]))
  const editorId = Symbol(),
    source = Symbol(),
    a = Symbol(),
    b = Symbol()
  try {
    owner.registrations.register({ viewId: source, editorId, kind: 'text' })
    owner.registrations.register({ viewId: source, editorId, kind: 'diagram' })
    expect(owner.links.link(diagram.id, source, source)).toBeInstanceOf(Error)
    owner.registrations.register({ viewId: a, editorId, kind: 'diagram' })
    expect(owner.links.pickingTarget(diagram.id, source)).toBe(a)
    owner.registrations.register({ viewId: b, editorId, kind: 'diagram' })
    expect(owner.links.connections.peek()).toHaveLength(2)
    expect(owner.links.pickingTarget(diagram.id, source)).toBeUndefined()
    expect(owner.links.setPickingTarget(diagram.id, source, b)).toBeUndefined()
    expect(owner.links.pickingTarget(diagram.id, source)).toBe(b)
    expect(owner.links.link(diagram.id, a, source)).toBeInstanceOf(Error)
  } finally {
    owner.dispose()
  }
})
it('keeps disabled targets from receiving picks and clears destination intent when an endpoint closes', () => {
  const owner = createEditorSelectionBridges(signal([diagram]))
  const editorId = Symbol(),
    source = Symbol(),
    target = Symbol(),
    enabled = signal(true)
  try {
    owner.registrations.register({ viewId: source, editorId, kind: 'text' })
    const close = owner.registrations.register({
      viewId: target,
      editorId,
      kind: 'diagram',
      enabled,
    })
    if (close instanceof Error) throw close
    owner.links.setPickingTarget(diagram.id, source, target)
    enabled.value = false
    expect(owner.links.pickingTarget(diagram.id, source)).toBeUndefined()
    enabled.value = true
    close()
    expect(owner.links.connections.peek()).toEqual([])
    owner.registrations.register({
      viewId: Symbol(),
      editorId,
      kind: 'diagram',
    })
    expect(owner.links.pickingTarget(diagram.id, source)).not.toBe(target)
  } finally {
    owner.dispose()
  }
})
it('lets independent adapters coexist on the same view without sharing links or destinations', () => {
  const other = { ...diagram, id: 'outline.source', targetKind: 'outline' }
  const owner = createEditorSelectionBridges(signal([diagram, other]))
  const source = Symbol(),
    target = Symbol()
  try {
    owner.registrations.register({
      viewId: source,
      editorId: Symbol(),
      kind: 'text',
    })
    owner.registrations.register({
      viewId: target,
      editorId: Symbol(),
      kind: 'diagram',
    })
    owner.registrations.register({
      viewId: target,
      editorId: Symbol(),
      kind: 'outline',
    })
    const unlink = owner.links.link(diagram.id, source, target)
    if (unlink instanceof Error) throw unlink
    expect(owner.links.pickingTarget(diagram.id, source)).toBe(target)
    expect(owner.links.pickingTarget(other.id, source)).toBeUndefined()
    unlink()
    expect(owner.links.connections.peek()).toEqual([])
  } finally {
    owner.dispose()
  }
})
it('composes through the registry independently of KCL and withdraws a contributed bridge without reviving old links', () => {
  const registry = new Registry(),
    slot = new Slot()
  registry.configure([
    extension,
    slot.of(
      defineRegistryItem({
        provides: [provide(editorSelectionBridgeDefinitions, diagram)],
      })
    ),
  ])
  const links = registry.get(editorSelectionLinksService),
    endpoints = registry.get(editorSelectionEndpointsService)
  const source = Symbol(),
    target = Symbol()
  endpoints.register({ viewId: source, editorId: Symbol(), kind: 'text' })
  endpoints.register({ viewId: target, editorId: Symbol(), kind: 'diagram' })
  links.link(diagram.id, source, target)
  expect(links.connections.peek()).toHaveLength(1)
  registry.reconfigure(slot, [])
  expect(links.connections.peek()).toEqual([])
  registry.reconfigure(slot, [
    defineRegistryItem({
      provides: [provide(editorSelectionBridgeDefinitions, diagram)],
    }),
  ])
  expect(links.connections.peek()).toEqual([])
  links.link(diagram.id, source, target)
  expect(links.connections.peek()).toHaveLength(1)
  registry.configure([])
  expect(
    endpoints.register({ viewId: Symbol(), editorId: Symbol(), kind: 'text' })
  ).toBeInstanceOf(Error)
})

it('publishes destination changes reactively and makes old endpoint cleanup harmless after replacement', () => {
  const owner = createEditorSelectionBridges(signal([diagram]))
  const editorId = Symbol(),
    source = Symbol(),
    a = Symbol(),
    b = Symbol()
  try {
    owner.registrations.register({ viewId: source, editorId, kind: 'text' })
    const close = owner.registrations.register({
      viewId: a,
      editorId,
      kind: 'diagram',
    })
    if (close instanceof Error) throw close
    owner.registrations.register({ viewId: b, editorId, kind: 'diagram' })
    const destination = computed(() =>
      owner.links.pickingTarget(diagram.id, source)
    )
    expect(destination.peek()).toBeUndefined()
    owner.links.setPickingTarget(diagram.id, source, b)
    expect(destination.peek()).toBe(b)
    close()
    owner.registrations.register({ viewId: a, editorId, kind: 'diagram' })
    owner.links.setPickingTarget(diagram.id, source, a)
    close()
    expect(destination.peek()).toBe(a)
  } finally {
    owner.dispose()
  }
})
