import { ContextMenu, ContextMenuItem } from 'components/ContextMenu'
import { CustomIcon, CustomIconName } from 'components/CustomIcon'
import { useModelingContext } from 'hooks/useModelingContext'
import { FrontPlane } from 'lang/KclSingleton'
import { createFeatureTree } from 'lang/std/artifactGraph'
import { engineCommandManager, kclManager } from 'lib/singletons'
import { reportRejection } from 'lib/trap'
import { toSync } from 'lib/utils'
import { ComponentProps, useMemo, useRef, useState } from 'react'

export const FeatureTreePane = () => {

  const defaultPlanes = useMemo(() => {
    return kclManager?.defaultPlanes
  }, [kclManager.defaultPlanes])
  const featureTree = useMemo(() => {
    if (!engineCommandManager.artifactGraph || defaultPlanes === null) {
      return []
    }
    console.log('artifactGraph', engineCommandManager.artifactGraph)
    return createFeatureTree({
      artifactGraph: engineCommandManager.artifactGraph,
      defaultPlanes,
      ast: kclManager.ast,
    })
  }, [engineCommandManager.artifactGraph])

  return (
    <section
      data-testid="debug-panel"
      className="absolute inset-0 p-1 box-border overflow-auto"
    >
      {defaultPlanes !== null && (
        <>
          <FeatureTreeDefaultPlaneItem name="xy" title="Top plane" />
          <FeatureTreeDefaultPlaneItem name="xz" title="Front plane" />
          <FeatureTreeDefaultPlaneItem name="yz" title="Side plane" />
          <hr className="my-0 py-0" />
          {featureTree
            .filter((feature) => feature.type !== 'defaultPlane')
            .map((feature) => (
              <FeatureTreeCreatedItem
                key={
                  feature.type +
                  '-' +
                  (feature.id instanceof Array ? feature.id[0] : feature.id)
                }
                item={feature}
              />
            ))}
        </>
      )}
    </section>
  )
}

const FeatureTreeItem = (props: {
  icon: CustomIconName
  name: string
  handleSelect: () => void
  visible?: boolean
  onVisibilityChange?: () => void
  menuItems?: ComponentProps<typeof ContextMenu>['items']
}) => {
  const menuRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(props.visible ?? true)
  function handleToggleVisible() {
    console.log('toggling visibility', visible)
    setVisible(!visible)
    props.onVisibilityChange?.()
  }

  return (
    <div
      ref={menuRef}
      className="flex select-none items-center group/item py-0.5 px-1 focus-within:bg-primary/10 hover:bg-primary/5"
    >
      <button
        onClick={props.handleSelect}
        className="reset flex-1 flex items-center gap-2 border-transparent text-left text-base"
      >
        <CustomIcon name={props.icon} className="w-5 h-5 block" />
        {props.name}
      </button>
      <button
        onClick={handleToggleVisible}
        className="border-transparent p-0 m-0"
      >
        <CustomIcon
          name={visible ? 'eyeOpen' : 'eyeCrossedOut'}
          className={`w-5 h-5 ${
            visible
              ? 'hidden group-hover/item:block group-focus-within/item:block'
              : 'text-chalkboard-50'
          }`}
        />
      </button>
      {props.menuItems && (
        <ContextMenu menuTargetElement={menuRef} items={props.menuItems} />
      )}
    </div>
  )
}

const FeatureTreeDefaultPlaneItem = (props: {
  name: FrontPlane
  title: string
}) => {
  const plane = useMemo(() => {
    console.log('getting plane', props.name)
    console.log('defaultPlanes', kclManager?.defaultPlanes)
    return kclManager?.defaultPlanes?.[props.name]
  }, [kclManager.defaultPlanes?.[props.name]])
  const planeVisibility = useMemo(() => {
    return kclManager.defaultPlanesVisibility[props.name]
  }, [kclManager.defaultPlanesVisibility[props.name]])

  function handleToggleHidden() {
    if (!plane) {
      return
    }

    kclManager
      .setPlaneVisibility(props.name, !plane.visible)
      .catch(reportRejection)
  }

  function handleSelectPlane() {
    // I don't think we can select default planes at the moment
  }

  return (
    plane && (
      <FeatureTreeItem
        icon="plane"
        name={props.title}
        handleSelect={handleSelectPlane}
        visible={planeVisibility}
        onVisibilityChange={handleToggleHidden}
      />
    )
  )
}

const FeatureTreeCreatedItem = (props: {
  item: ReturnType<typeof createFeatureTree>[0]
}) => {
  const { send: modelingSend } = useModelingContext()
  const [visible, setVisible] = useState(true)

  async function handleToggleVisible() {
    if (props.item.id instanceof Array) {
      await Promise.all([
        engineCommandManager.setObjectVisibility(props.item.id[0], !visible),
        await engineCommandManager.setObjectVisibility(
          props.item.id[1],
          !visible
        ),
      ])
    } else {
      await engineCommandManager.setObjectVisibility(props.item.id, !visible)
    }
    setVisible(!visible)
  }

  function getIcon(): CustomIconName {
    switch (props.item.type) {
      case 'defaultPlane':
        return 'plane'
      case 'extrusion':
        return 'extrude'
      default:
        return props.item.type
    }
  }

  const menuItems = useMemo(
    () => [
      <ContextMenuItem
        onClick={() => {
          modelingSend({
            type: 'Set selection',
            data: {
              selectionType: 'singleCodeCursor',
              selection: {
                type: 'default',
                range: props.item.codeRef?.range || [0, 0],
              },
            },
          })
          modelingSend({ type: 'Delete selection' })
        }}
      >
        Delete
      </ContextMenuItem>,
    ],
    [modelingSend, props.item.codeRef]
  )

  return (
    <FeatureTreeItem
      icon={getIcon()}
      name={props.item.name}
      menuItems={menuItems}
      handleSelect={() => {
        modelingSend({
          type: 'Set selection',
          data: {
            selectionType: 'singleCodeCursor',
            selection: {
              type: 'default',
              range: props.item.codeRef?.range || [0, 0],
            },
          },
        })
      }}
      visible={visible}
      onVisibilityChange={toSync(handleToggleVisible, reportRejection)}
    />
  )
}