import { EditingConstraintInputView } from '@src/clientSideScene/EditingConstraintInputView'
import { useApp, useSingletons } from '@src/lib/boot'

export const EditingConstraintInput = () => {
  const { kclManager } = useSingletons()
  const { settings } = useApp()
  return (
    <EditingConstraintInputView kclManager={kclManager} settings={settings} />
  )
}
