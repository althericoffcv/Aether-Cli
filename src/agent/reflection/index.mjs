/**
 * Reflection system — evaluates each action outcome and
 * surfaces insights that guide the agent's next decision.
 */
export class Reflection {
  constructor() {
    this.log = []   // { step, action, params, success, insight, ts }
  }

  // ── Analyze one action+observation ────────────────────────────────────────
  analyze(step, action, params, observation) {
    const obs    = String(observation ?? '')
    const failed = this._isFailed(obs)

    const insight = failed
      ? this._buildFailureInsight(action, params, obs)
      : this._buildSuccessInsight(action, params, obs)

    const entry = {
      step,
      action,
      params,
      success: !failed,
      insight,
      ts: Date.now(),
    }
    this.log.push(entry)
    return entry
  }

  // ── Pattern helpers ───────────────────────────────────────────────────────
  _isFailed(obs) {
    return (
      obs.startsWith('ERROR')         ||
      obs.startsWith('COMMAND FAILED')||
      obs.includes('Error:')          ||
      obs.includes('ENOENT')          ||
      obs.includes('Permission denied')||
      obs.includes('not found')       ||
      obs.includes('EXIT CODE: 1')
    )
  }

  _buildFailureInsight(action, params, obs) {
    // ENOENT — missing file
    if (obs.includes('ENOENT') || obs.includes('not found')) {
      const file = (obs.match(/['"]([^'"]+)['"]/)?.[1]) || (params?.path ?? '')
      return `File/path not found: "${file}". I should check the directory structure before retrying.`
    }
    // Permission
    if (obs.includes('Permission denied') || obs.includes('EACCES')) {
      return `Permission denied. May need to adjust file permissions or check the path.`
    }
    // npm/node errors
    if (action === 'execute_command') {
      if (obs.includes('command not found')) {
        const cmd = obs.match(/(.+): command not found/)?.[1] || 'unknown'
        return `Command "${cmd}" not installed. I should install it or use an alternative.`
      }
      if (obs.includes('MODULE_NOT_FOUND') || obs.includes('Cannot find module')) {
        return `Module not found. Run npm install or check package imports.`
      }
      if (obs.includes('SyntaxError')) {
        return `Syntax error in code. I need to read the file and fix the syntax.`
      }
      if (obs.includes('npm ERR!')) {
        return `npm error. Check package.json or run npm install first.`
      }
    }
    // Generic
    return `Action "${action}" failed. I should adjust my approach.`
  }

  _buildSuccessInsight(action, params, obs) {
    if (action === 'write_file')  return `File written successfully: ${params?.path}`
    if (action === 'edit_file')   return `File edited successfully: ${params?.path}`
    if (action === 'delete_file') return `File deleted: ${params?.path}`
    if (action === 'execute_command') {
      const cmd = params?.command ?? ''
      if (obs.includes('(no output)')) return `Command "${cmd}" ran with no output.`
      return `Command "${cmd}" completed successfully.`
    }
    if (action === 'git_commit')  return `Changes committed to git.`
    if (action === 'git_push')    return `Changes pushed to remote.`
    return `Action "${action}" succeeded.`
  }

  // ── Aggregate insights ────────────────────────────────────────────────────

  /** Summary for system prompt injection */
  getSummary() {
    if (!this.log.length) return null
    const total    = this.log.length
    const passed   = this.log.filter(e => e.success).length
    const recent   = this.log.slice(-4)
    const insights = recent.map(e => `  ${e.success ? '✓' : '✗'} [${e.action}] ${e.insight}`).join('\n')
    return `Progress: ${passed}/${total} actions succeeded\nRecent:\n${insights}`
  }

  /** Detect if the same tool keeps failing — signal to try something different */
  isStuck(windowSize = 3) {
    if (this.log.length < windowSize) return false
    const recent = this.log.slice(-windowSize)
    return recent.every(e => !e.success)
  }

  /** Last entry */
  last() { return this.log.at(-1) ?? null }

  /** How many consecutive failures on the same action */
  consecutiveFailures(action) {
    let count = 0
    for (let i = this.log.length - 1; i >= 0; i--) {
      if (this.log[i].action === action && !this.log[i].success) count++
      else break
    }
    return count
  }
}

export default Reflection
