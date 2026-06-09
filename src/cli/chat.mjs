/**
 * chat.mjs — kept for backward compatibility
 * Delegates to the unified interactive mode.
 */
import { runInteractive } from './interactive.mjs'

export async function runChat(options = {}) {
  return runInteractive(options)
}
