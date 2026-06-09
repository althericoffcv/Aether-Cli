import { readFile, writeFile } from 'fs/promises'
import { existsSync }         from 'fs'
import { getWorkspaceFiles, initWorkspace } from '../../config/index.mjs'

/**
 * Memory — workspace-local persistent storage.
 * Files live in <workingDir>/.aether/ instead of ~/.aether/
 * This gives each project its own isolated memory.
 */
export class Memory {
  constructor(workingDir = process.cwd()) {
    this.workingDir = workingDir
    this._data      = null   // loaded lazily
    this._files     = getWorkspaceFiles(workingDir)
  }

  // ── Internal load/save ─────────────────────────────────────────────────────
  async _load() {
    if (this._data) return
    await initWorkspace(this.workingDir)
    try {
      this._data = existsSync(this._files.memory)
        ? JSON.parse(await readFile(this._files.memory, 'utf8'))
        : {}
    } catch {
      this._data = {}
    }
  }

  async _save() {
    await initWorkspace(this.workingDir)
    await writeFile(this._files.memory, JSON.stringify(this._data, null, 2), 'utf8')
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async read(key = 'all') {
    await this._load()
    const userKeys = Object.keys(this._data)
      .filter(k => !k.startsWith('_') && !k.startsWith('session_'))

    if (key === 'all') {
      if (userKeys.length === 0) return 'Memory is empty.'
      return userKeys
        .map(k => `[${k}] ${this._data[k]}`)
        .join('\n')
    }

    return this._data[key] !== undefined
      ? `[${key}] ${this._data[key]}`
      : `No memory found for key: "${key}"`
  }

  async write(key, value) {
    await this._load()
    this._data[key]          = String(value)
    this._data[`_ts_${key}`] = new Date().toISOString()
    await this._save()
    return `✓ Memory saved: [${key}] = ${String(value).slice(0, 120)}`
  }

  async delete(key) {
    await this._load()
    if (this._data[key] === undefined) return `Key not found: "${key}"`
    delete this._data[key]
    delete this._data[`_ts_${key}`]
    await this._save()
    return `✓ Memory deleted: "${key}"`
  }

  async clear() {
    this._data = {}
    await this._save()
    return '✓ Memory cleared.'
  }

  async getContextSummary() {
    await this._load()
    const userKeys = Object.keys(this._data)
      .filter(k => !k.startsWith('_') && !k.startsWith('session_'))
    if (userKeys.length === 0) return null
    return userKeys
      .slice(0, 12)
      .map(k => `[${k}]: ${String(this._data[k]).slice(0, 150)}`)
      .join('\n')
  }

  // ── Session management ─────────────────────────────────────────────────────

  async saveSession(objective, history) {
    await initWorkspace(this.workingDir)

    // Save detailed session
    const sessionData = {
      objective,
      steps:       history.length,
      history:     history.slice(-10).map(h => ({
        action:      h.action,
        params:      h.params,
        result:      String(h.observation ?? '').slice(0, 200),
        reflection:  h.reflection ?? '',
      })),
      completedAt: new Date().toISOString(),
    }
    await writeFile(this._files.session, JSON.stringify(sessionData, null, 2), 'utf8')

    // Append to history.json
    let historyLog = []
    try {
      if (existsSync(this._files.history)) {
        historyLog = JSON.parse(await readFile(this._files.history, 'utf8'))
      }
    } catch {}
    historyLog.push({
      objective,
      steps:       history.length,
      completedAt: sessionData.completedAt,
    })
    // Keep last 50 sessions
    if (historyLog.length > 50) historyLog = historyLog.slice(-50)
    await writeFile(this._files.history, JSON.stringify(historyLog, null, 2), 'utf8')

    // Save to long-term memory snapshot
    await this._load()
    const snap = `Completed: "${objective}" in ${history.length} steps on ${sessionData.completedAt}`
    this._data[`session_${Date.now()}`] = snap
    // Keep last 10 session snapshots
    const snapKeys = Object.keys(this._data)
      .filter(k => k.startsWith('session_'))
      .sort()
    if (snapKeys.length > 10) {
      snapKeys.slice(0, snapKeys.length - 10).forEach(k => delete this._data[k])
    }
    await this._save()
  }

  async getLastSession() {
    await initWorkspace(this.workingDir)
    if (!existsSync(this._files.session)) return null
    try {
      return JSON.parse(await readFile(this._files.session, 'utf8'))
    } catch { return null }
  }

  async saveProjectInfo(info) {
    await initWorkspace(this.workingDir)
    const data = {
      ...info,
      detectedAt: new Date().toISOString(),
    }
    await writeFile(this._files.project, JSON.stringify(data, null, 2), 'utf8')
  }

  async getProjectInfo() {
    if (!existsSync(this._files.project)) return null
    try {
      return JSON.parse(await readFile(this._files.project, 'utf8'))
    } catch { return null }
  }

  // ── Task list ──────────────────────────────────────────────────────────────

  async addTask(task) {
    await initWorkspace(this.workingDir)
    let tasks = []
    try {
      if (existsSync(this._files.tasks)) {
        tasks = JSON.parse(await readFile(this._files.tasks, 'utf8'))
      }
    } catch {}
    tasks.push({ task, status: 'pending', createdAt: new Date().toISOString() })
    await writeFile(this._files.tasks, JSON.stringify(tasks, null, 2), 'utf8')
  }
}

export default Memory
