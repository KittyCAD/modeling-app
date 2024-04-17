/**
 *  Generate a random string of 6 characters, uppercase and lowercase letters and numbers
 *  for use as a KCL tag.
 *  TODO: in future, use an LLM and/or other context clues to name the tag better
 *  @returns {string} - A random string of 6 characters
 */
export function generateKclTag() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}
