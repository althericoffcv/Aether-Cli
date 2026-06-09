import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import os from 'os'

// ─── Global config dir (for global settings) ─────────────────────────────────
export const AETHER_GLOBAL_DIR = join(os.homedir(), '.aether')
export const CONFIG_FILE       = join(AETHER_GLOBAL_DIR, 'config.json')

// Legacy exports — kept for backward compat (doctor.mjs etc.)
export const AETHER_DIR  = AETHER_GLOBAL_DIR
export const MEMORY_FILE = join(AETHER_GLOBAL_DIR, 'memory.json')
export const SESSION_FILE = join(AETHER_GLOBAL_DIR, 'session.json')
export const LOG_FILE    = join(AETHER_GLOBAL_DIR, 'aether.log')

const DEFAULTS = {
  version:       '2.0.0',
  maxIterations: 25,
  verbose:       false,
  theme:         'default',
  created:       new Date().toISOString(),
}

// ─── Global dir helpers ───────────────────────────────────────────────────────
export async function ensureDir() {
  if (!existsSync(AETHER_GLOBAL_DIR)) {
    await mkdir(AETHER_GLOBAL_DIR, { recursive: true })
  }
}

export async function loadConfig() {
  await ensureDir()
  if (!existsSync(CONFIG_FILE)) {
    await saveConfig(DEFAULTS)
    return { ...DEFAULTS }
  }
  try {
    return { ...DEFAULTS, ...JSON.parse(await readFile(CONFIG_FILE, 'utf8')) }
  } catch {
    return { ...DEFAULTS }
  }
}

export async function saveConfig(cfg) {
  await ensureDir()
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8')
}

export async function getConfig(key) {
  const cfg = await loadConfig()
  return cfg[key]
}

export async function setConfig(key, value) {
  const cfg = await loadConfig()
  cfg[key] = value
  await saveConfig(cfg)
}

// ─── Workspace-local .aether/ dir ────────────────────────────────────────────
// One per project — created in cwd where `aether` is run

export function getWorkspaceDir(cwd = process.cwd()) {
  return join(cwd, '.aether')
}

export function getWorkspaceFiles(cwd = process.cwd()) {
  const dir = getWorkspaceDir(cwd)
  return {
    dir,
    memory:  join(dir, 'memory.json'),
    session: join(dir, 'session.json'),
    history: join(dir, 'history.json'),
    tasks:   join(dir, 'tasks.json'),
    project: join(dir, 'project.json'),
  }
}

/**
 * Initialize workspace .aether/ directory and all session files.
 * Called automatically on startup — silently creates missing files.
 */
export async function initWorkspace(cwd = process.cwd()) {
  const files = getWorkspaceFiles(cwd)
  await mkdir(files.dir, { recursive: true })

  const defaults = [
    [files.memory,  {}],
    [files.session, { createdAt: new Date().toISOString(), sessions: [] }],
    [files.history, []],
    [files.tasks,   []],
    [files.project, { detectedAt: null, type: null, framework: null }],
  ]

  for (const [path, defaultContent] of defaults) {
    if (!existsSync(path)) {
      await writeFile(path, JSON.stringify(defaultContent, null, 2), 'utf8')
    }
  }

  return files
}
