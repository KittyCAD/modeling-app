export default function makeUrlPathRelative(path: string) {
  return path.replace(/^\//, '')
}
