import { ContextMenu, ContextMenuItem } from 'components/ContextMenu'
import { CustomIcon, CustomIconName } from 'components/CustomIcon'
import { useModelingContext } from 'hooks/useModelingContext'
import { FrontPlane } from 'lang/KclSingleton'
import { getNodePathFromSourceRange } from 'lang/queryAst'
import { Operation } from 'lib/fakeOperationTypes'
import { kclManager } from 'lib/singletons'
import { reportRejection } from 'lib/trap'
import { ComponentProps, useCallback, useMemo, useRef, useState } from 'react'

const stdLibWhiteList = [
  'startSketchOn',
  'extrude',
  'revolve',
  'fillet',
  'chamfer',
  'offsetPlane',
  'shell',
  'loft',
] as const

const stdLibIconMap: Record<(typeof stdLibWhiteList)[number], CustomIconName> =
  {
    startSketchOn: 'sketch',
    extrude: 'extrude',
    revolve: 'revolve',
    fillet: 'fillet3d',
    chamfer: 'chamfer3d',
    offsetPlane: 'plane',
    shell: 'shell',
    loft: 'loft',
  }

function isWhiteListedStdLibCall(
  name: string
): name is (typeof stdLibWhiteList)[number] {
  return stdLibWhiteList.includes(name as any)
}

function getOperationIcon(op: Operation): CustomIconName {
  switch (op.type) {
    case 'StdLibCall':
      return isWhiteListedStdLibCall(op.name)
        ? stdLibIconMap[op.name]
        : 'questionMark'
    default:
      return 'make-variable'
  }
}

const FAKE_OPERATION_LIST: Operation[] = [
  {
    type: 'StdLibCall',
    unlabeledArg: {
      sourceRange: [0, 0, false],
    },
    labeledArgs: {},
    sourceRange: [0, 0, false],
    name: 'startSketchOn',
  },
  {
    type: 'StdLibCall',
    unlabeledArg: {
      sourceRange: [0, 0, false],
    },
    labeledArgs: {},
    sourceRange: [0, 0, false],
    name: 'startProfileAt',
  },
  {
    type: 'StdLibCall',
    unlabeledArg: {
      sourceRange: [0, 0, false],
    },
    labeledArgs: {},
    sourceRange: [0, 0, false],
    name: 'line',
  },
  {
    type: 'StdLibCall',
    unlabeledArg: {
      sourceRange: [0, 0, false],
    },
    labeledArgs: {},
    sourceRange: [0, 0, false],
    name: 'line',
  },
  {
    type: 'StdLibCall',
    unlabeledArg: {
      sourceRange: [0, 0, false],
    },
    labeledArgs: {},
    sourceRange: [0, 0, false],
    name: 'extrude',
  },
  {
    type: 'UserDefinedFunctionCall',
    name: 'myFunction',
    functionSourceRange: [0, 0, false],
    unlabeledArg: null,
    labeledArgs: {},
    sourceRange: [0, 0, false],
  },
]

export const FeatureTreePane = () => {
  const operationList = FAKE_OPERATION_LIST
  const defaultPlanes = useMemo(() => {
    return kclManager?.defaultPlanes
  }, [kclManager.defaultPlanes])

  return (
    <div className="relative">
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
            {operationList
              .filter(
                (operation) =>
                  operation.type !== 'StdLibCall' ||
                  stdLibWhiteList.some((fnName) => fnName === operation.name)
              )
              .map((operation) => (
                <OperationListItem
                  key={`${operation.type}-${
                    'name' in operation ? operation.name : 'anonymous'
                  }-${
                    'sourceRange' in operation
                      ? operation.sourceRange[0]
                      : 'start'
                  }`}
                  item={operation}
                />
              ))}
          </>
        )}
      </section>
    </div>
  )
}

export const visibilityMap = new Map<string, boolean>()

interface VisibilityToggleProps {
  entityId: string
  initialVisibility: boolean
  onVisibilityChange?: () => void
}

const VisibilityToggle = (props: VisibilityToggleProps) => {
  const [visible, setVisible] = useState(props.initialVisibility)

  function handleToggleVisible() {
    setVisible(!visible)
    visibilityMap.set(props.entityId, !visible)
    props.onVisibilityChange?.()
  }

  return (
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
  )
}

const OperationPaneItem = (props: {
  icon: CustomIconName
  name: string
  handleSelect: () => void
  visibilityToggle?: VisibilityToggleProps
  menuItems?: ComponentProps<typeof ContextMenu>['items']
}) => {
  const menuRef = useRef<HTMLDivElement>(null)

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
      {props.visibilityToggle && (
        <VisibilityToggle {...props.visibilityToggle} />
      )}
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
      .setPlaneVisibility(props.name, !planeVisibility)
      .catch(reportRejection)
  }

  function handleSelectPlane() {
    // I don't think we can select default planes at the moment
  }

  return (
    plane && (
      <OperationPaneItem
        icon="plane"
        name={props.title}
        handleSelect={handleSelectPlane}
        visibilityToggle={{
          entityId: props.name,
          initialVisibility: planeVisibility,
          onVisibilityChange: handleToggleHidden,
        }}
      />
    )
  )
}

const OperationListItem = (props: { item: Operation }) => {
  const { send: modelingSend, state: modelingState } = useModelingContext()
  const selectOperation = useCallback(() => {
    if (!('sourceRange' in props.item)) {
      return
    }
    modelingSend({
      type: 'Set selection',
      data: {
        selectionType: 'singleCodeCursor',
        selection: {
          codeRef: {
            range: props.item.sourceRange,
            pathToNode: getNodePathFromSourceRange(
              kclManager.ast,
              props.item.sourceRange
            ),
          },
        },
      },
    })
  }, [modelingSend, props.item])
  // const [visible, setVisible] = useState(true)

  // async function handleToggleVisible() {
  //   if (props.item.id instanceof Array) {
  //     await Promise.all([
  //       engineCommandManager.setObjectVisibility(props.item.id[0], !visible),
  //       await engineCommandManager.setObjectVisibility(
  //         props.item.id[1],
  //         !visible
  //       ),
  //     ])
  //   } else {
  //     await engineCommandManager.setObjectVisibility(props.item.id, !visible)
  //   }
  //   setVisible(!visible)
  // }

  const menuItems = useMemo(
    () => [
      <ContextMenuItem
        onClick={() => {
          selectOperation()
          modelingSend({
            type: 'Set context',
            data: {
              openPanes: [...modelingState.context.store.openPanes, 'code'],
            },
          })
        }}
      >
        View KCL source code
      </ContextMenuItem>,
      <ContextMenuItem
        onClick={() => {
          selectOperation()
          modelingSend({ type: 'Delete selection' })
        }}
      >
        Delete
      </ContextMenuItem>,
    ],
    [modelingSend, props.item]
  )

  return (
    <OperationPaneItem
      icon={getOperationIcon(props.item)}
      name={
        'name' in props.item && props.item.name !== null
          ? props.item.name
          : 'anonymous'
      }
      menuItems={menuItems}
      handleSelect={selectOperation}
    />
  )
}
