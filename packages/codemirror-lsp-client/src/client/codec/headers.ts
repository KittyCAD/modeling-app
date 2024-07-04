export default class Headers {
  static add(message: string): string {
    return `Content-Length: ${message.length}\r\n\r\n${message}`
  }

  static remove(delimited: string): string {
    return delimited.replace(/^Content-Length:\s*\d+\s*/, '')
  }
}
