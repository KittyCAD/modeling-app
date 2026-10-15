import { SelectionReferencesList } from '@src/components/SelectionReferencesList'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useSingletons } from '@src/lib/boot'

export function SelectionReferencesPopover() {
  const { kclManager } = useSingletons()
  const { context, send } = useModelingContext()
  return (
    <SelectionReferencesList
      kclManager={kclManager}
      wasmPromise={kclManager.wasmInstancePromise}
      selectionRanges={context.selectionRanges}
      onChange={(selection) =>
        send({
          type: 'Set selection',
          data: { selectionType: 'completeSelection', selection },
        })
      }
    />
  )
}
