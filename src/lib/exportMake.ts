import { deserialize_files } from 'wasm-lib/pkg/wasm_lib'
import { machineManager } from './machineManager'
import toast from 'react-hot-toast'
import { components } from './machine-api'
import ModelingAppFile from './modelingAppFile'

// Make files locally from an export call.
export async function exportMake(data: ArrayBuffer): Promise<Response | null> {
  if (machineManager.machineCount() === 0) {
    console.error('No machines available')
    toast.error('No machines available')
    return null
  }

  const machineApiIp = machineManager.machineApiIp
  if (!machineApiIp) {
    console.error('No machine api ip available')
    toast.error('No machine api ip available')
    return null
  }

  const currentMachine = machineManager.currentMachine
  if (!currentMachine) {
    console.error('No current machine available')
    toast.error('No current machine available')
    return null
  }

  let machineId = currentMachine?.id
  if (!machineId) {
    console.error('No machine id available', currentMachine)
    toast.error('No machine id available')
    return null
  }

  const params: components['schemas']['PrintParameters'] = {
    machine_id: machineId,
    job_name: 'Exported Job', // TODO: make this the project name.
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

    return response
  } catch (error) {
    console.error('Error exporting', error)
    toast.error('Error exporting')
    return null
  }
}
