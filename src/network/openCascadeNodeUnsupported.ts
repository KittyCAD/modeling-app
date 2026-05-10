export default async function initOpenCascadeNodeUnsupported(): Promise<never> {
  throw new Error(
    'OpenCascade Node initialization was included in a browser build unexpectedly'
  )
}
