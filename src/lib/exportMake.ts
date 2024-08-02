import { deserialize_files } from 'wasm-lib/pkg/wasm_lib'
import { ModelingAppFile } from './exportSave'

// Make files locally from an export call.
export async function exportMake(data: ArrayBuffer) {
  const formData = new FormData()
  formData.append('params', '{"printer_id":"CZPX2418X004XK68718"}')
  let files: ModelingAppFile[] = deserialize_files(new Uint8Array(data))
  let file = files[0]
  const fileBlob = new Blob([new Uint8Array(file.contents)], {
    type: 'text/plain',
  })
  formData.append('file', fileBlob, file.name)

  const response = await fetch('http://0.0.0.0:8585/print', {
    mode: 'no-cors',
    method: 'POST',
    body: formData,
  })

  return response
}
