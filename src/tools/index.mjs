import { filesystemTools } from './filesystem/index.mjs'
import { terminalTools }   from './terminal/index.mjs'
import { gitTools }        from './git/index.mjs'
import { serverTools }     from './server/index.mjs'

// ─── Tool Registry ────────────────────────────────────────────────────────────
class ToolRegistry {
  constructor() {
    this._tools = new Map()
  }

  register(tool) {
    if (!tool?.name || typeof tool.execute !== 'function') {
      throw new Error(`Invalid tool definition: ${JSON.stringify(tool?.name)}`)
    }
    this._tools.set(tool.name, tool)
    return this
  }

  registerAll(tools) {
    tools.forEach(t => this.register(t))
    return this
  }

  has(name)  { return this._tools.has(name) }
  get(name)  { return this._tools.get(name) }
  names()    { return Array.from(this._tools.keys()) }
  all()      { return Array.from(this._tools.values()) }

  schema() {
    return this.all().map(tool => {
      const params = Object.entries(tool.parameters || {})
        .map(([n, d]) => `    - ${n} (${d.type}${d.required ? ', REQUIRED' : ', optional'}): ${d.description}`)
        .join('\n')

      return [
        `• ${tool.name}`,
        `  ${tool.description}`,
        params ? `  Parameters:\n${params}` : '  Parameters: none',
      ].join('\n')
    }).join('\n\n')
  }

  async execute(name, params, cwd) {
    const tool = this._tools.get(name)
    if (!tool) {
      const available = this.names().join(', ')
      return `ERROR: Unknown tool "${name}".\nAvailable tools: ${available}`
    }
    try {
      const result = await tool.execute(params ?? {}, cwd)
      return typeof result === 'string' ? result : JSON.stringify(result, null, 2)
    } catch (err) {
      return `ERROR in ${name}: ${err.message}`
    }
  }
}

// ─── Build the global registry ────────────────────────────────────────────────
export const registry = new ToolRegistry()

registry
  .registerAll(filesystemTools)
  .registerAll(terminalTools)
  .registerAll(gitTools)
  .registerAll(serverTools)

// ── project_scan ──────────────────────────────────────────────────────────────
registry.register({
  name: 'project_scan',
  description: 'Scan the project to understand its structure, framework, dependencies, and scripts. Always run this first on an unfamiliar codebase.',
  parameters: {
    path: { type: 'string', required: false, description: 'Subdirectory to scan (default: "." = project root)' },
  },
  async execute({ path = '.' }, cwd) {
    const { scanProject } = await import('../scanner/index.mjs')
    return await scanProject(path, cwd)
  },
})

// ── memory_read ───────────────────────────────────────────────────────────────
registry.register({
  name: 'memory_read',
  description: 'Read from persistent memory. Use to recall facts saved across sessions.',
  parameters: {
    key: { type: 'string', required: false, description: 'Key to read (default: "all" = everything)' },
  },
  async execute({ key = 'all' }, cwd) {
    const { Memory } = await import('../agent/memory/index.mjs')
    return await new Memory(cwd).read(key)
  },
})

// ── memory_write ──────────────────────────────────────────────────────────────
registry.register({
  name: 'memory_write',
  description: 'Save a key-value fact to persistent memory for future sessions.',
  parameters: {
    key:   { type: 'string', required: true, description: 'Memory key' },
    value: { type: 'string', required: true, description: 'Value to store' },
  },
  async execute({ key, value }, cwd) {
    const { Memory } = await import('../agent/memory/index.mjs')
    return await new Memory(cwd).write(key, value)
  },
})

export default registry
