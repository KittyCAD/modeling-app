import { deserialize_files } from '@rust/kcl-wasm-lib/pkg/kcl_wasm_lib'
import { MachineManager } from 'components/MachineManagerProvider'
import toast from 'react-hot-toast'
import { components } from './machine-api'
import ModelingAppFile from './modelingAppFile'
import { MAKE_TOAST_MESSAGES } from './constants'

// Make files locally from an export call.
export async function exportMake(
  data: ArrayBuffer,
  name: string,
  toastId: string,
  machineManager: MachineManager
): Promise<Response | null> {
  if (name === '') {
    console.error(MAKE_TOAST_MESSAGES.NO_NAME)
    toast.error(MAKE_TOAST_MESSAGES.NO_NAME, { id: toastId })
    return null
  }

  if (machineManager.machines.length === 0) {
    console.error(MAKE_TOAST_MESSAGES.NO_MACHINES)
    toast.error(MAKE_TOAST_MESSAGES.NO_MACHINES, { id: toastId })
    return null
  }

  const machineApiIp = machineManager.machineApiIp
  if (!machineApiIp) {
    console.error(MAKE_TOAST_MESSAGES.NO_MACHINE_API_IP)
    toast.error(MAKE_TOAST_MESSAGES.NO_MACHINE_API_IP, { id: toastId })
    return null
  }

  const currentMachine = machineManager.currentMachine
  if (!currentMachine) {
    console.error(MAKE_TOAST_MESSAGES.NO_CURRENT_MACHINE)
    toast.error(MAKE_TOAST_MESSAGES.NO_CURRENT_MACHINE, { id: toastId })
    return null
  }

  let machineId = currentMachine?.id
  if (!machineId) {
    console.error(MAKE_TOAST_MESSAGES.NO_MACHINE_ID, currentMachine)
    toast.error(MAKE_TOAST_MESSAGES.NO_MACHINE_ID, { id: toastId })
    return null
  }

  const params: components['schemas']['PrintParameters'] = {
    machine_id: machineId,
    job_name: name,
  }
  try {
    console.log('params', params)
    const formData = new FormData()
    formData.append('params', JSON.stringify(params))
    let files: ModelingAppFile[] = deserialize_files(new Uint8Array(data))
    let file = files[0]
    const fileBlob = new Blob([new Uint8Array(file.contents)], {
      type: 'text/plain',
    })
    formData.append('file', fileBlob, file.name)
    console.log('formData', formData)

    const response = await fetch('http://' + machineApiIp + '/print', {
      mode: 'no-cors',
      method: 'POST',
      body: formData,
    })

    console.log('response', response)

    if (!response.ok) {
      console.error(MAKE_TOAST_MESSAGES.ERROR_STARTING_PRINT, response)
      const text = await response.text()
      toast.error(
        'Error while starting print: ' + response.statusText + ' ' + text,
        {
          id: toastId,
        }
      )
      return null
    }

    toast.success(MAKE_TOAST_MESSAGES.SUCCESS, { id: toastId })
    return response
  } catch (error) {
    console.error(MAKE_TOAST_MESSAGES.ERROR_STARTING_PRINT, error)
    toast.error(MAKE_TOAST_MESSAGES.ERROR_STARTING_PRINT, { id: toastId })
    return null
  }
}
