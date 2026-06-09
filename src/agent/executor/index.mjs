import registry from '../../tools/index.mjs'

/**
 * Executor — thin wrapper around the tool registry that
 * enforces the working directory and provides timing info.
 */
export class Executor {
  constructor(workingDir) {
    this.workingDir = workingDir
  }

  setWorkingDir(dir) {
    this.workingDir = dir
  }

  async run(toolName, params) {
    const start  = Date.now()
    const result = await registry.execute(toolName, params ?? {}, this.workingDir)
    const ms     = Date.now() - start
    return { result, ms }
  }
}

export default Executor
