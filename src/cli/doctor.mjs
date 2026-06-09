import { exec }      from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { join }       from 'path'
import os             from 'os'

import { ui }                         from './ui.mjs'
import { AETHER_GLOBAL_DIR,
         getWorkspaceFiles }           from '../config/index.mjs'

const execAsync = promisify(exec)

export async function runDoctor({ workingDir = process.cwd() } = {}) {
  ui.banner()
  console.log('\x1b[1mRunning diagnostics…\x1b[0m\n')

  const ok   = (label, detail = '') => row('\x1b[32m✓\x1b[0m', '\x1b[32mOK\x1b[0m',   label, detail)
  const fail = (label, detail = '') => row('\x1b[31m✗\x1b[0m', '\x1b[31mFAIL\x1b[0m', label, detail)
  const warn = (label, detail = '') => row('\x1b[33m⚠\x1b[0m', '\x1b[33mWARN\x1b[0m', label, detail)
  const row  = (icon, badge, label, detail) => {
    const pad = label.padEnd(28)
    console.log(`  ${icon} ${pad} ${badge}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`)
  }

  // ── System ────────────────────────────────────────────────────────────────
  ui.section('System')
  console.log(`  Platform   : ${os.platform()} ${os.arch()}`)
  console.log(`  OS         : ${os.type()} ${os.release()}`)
  console.log(`  RAM        : ${gb(os.freemem())} free / ${gb(os.totalmem())} total`)
  console.log(`  Home       : ${os.homedir()}`)
  console.log(`  Workspace  : ${workingDir}`)
  console.log()

  // ── Runtime ───────────────────────────────────────────────────────────────
  ui.section('Runtime')

  const nodeVer   = process.version
  const nodeMajor = parseInt(nodeVer.slice(1))
  nodeMajor >= 22
    ? ok('Node.js ≥ 22', nodeVer)
    : fail('Node.js ≥ 22', `${nodeVer} — upgrade to v22+`)

  for (const [bin, label] of [['npm','npm'],['pnpm','pnpm'],['yarn','yarn'],['git','git'],['curl','curl']]) {
    try {
      const { stdout } = await execAsync(`${bin} --version 2>&1`)
      ok(label, stdout.trim().split('\n')[0])
    } catch {
      bin === 'git' ? fail(label, 'required for git tools')
                    : warn(label, 'not installed (optional)')
    }
  }
  console.log()

  // ── AETHER config ─────────────────────────────────────────────────────────
  ui.section('AETHER v2.0')
  existsSync(AETHER_GLOBAL_DIR)
    ? ok('Global config dir', AETHER_GLOBAL_DIR)
    : warn('Global config dir', 'created on first run')

  // Workspace-local .aether/ files
  const wf = getWorkspaceFiles(workingDir)
  existsSync(wf.dir)
    ? ok('Workspace .aether/', wf.dir)
    : warn('Workspace .aether/', 'will be created on first run')
  existsSync(wf.memory)  ? ok('memory.json')  : warn('memory.json',  'not yet created')
  existsSync(wf.session) ? ok('session.json') : warn('session.json', 'no previous session')
  existsSync(wf.history) ? ok('history.json') : warn('history.json', 'no history yet')

  if (existsSync(wf.memory)) {
    try {
      const { readFile } = await import('fs/promises')
      const data = JSON.parse(await readFile(wf.memory, 'utf8'))
      const keys = Object.keys(data).filter(k => !k.startsWith('_')).length
      console.log(`  \x1b[2m${keys} memory entries\x1b[0m`)
    } catch {}
  }
  console.log()

  // ── Network ───────────────────────────────────────────────────────────────
  ui.section('Network')
  console.log('  Checking gemini.google.com…')

  const netOk = await checkNetwork()
  if (netOk.ok) {
    ok('gemini.google.com', `HTTP ${netOk.code}`)
  } else {
    fail('gemini.google.com', netOk.detail)
    console.log()
    console.log('  \x1b[33mTroubleshooting:\x1b[0m')
    console.log('    • Check internet connection')
    console.log('    • Sign in at https://gemini.google.com in your browser')
    console.log('    • Some regions require a VPN')
  }
  console.log()

  // ── Current project ───────────────────────────────────────────────────────
  ui.section('Current Project')

  existsSync(join(workingDir, 'package.json'))  ? ok('package.json')       : warn('package.json',  'not found')
  existsSync(join(workingDir, 'tsconfig.json')) ? ok('tsconfig.json')      : warn('tsconfig.json', 'not found')
  existsSync(join(workingDir, '.git'))          ? ok('git repository')     : warn('git',            'not initialized')
  existsSync(join(workingDir, 'node_modules'))  ? ok('node_modules')       : warn('node_modules',   'run npm install')

  if (existsSync(join(workingDir, 'package.json'))) {
    try {
      const { readFile } = await import('fs/promises')
      const pkg = JSON.parse(await readFile(join(workingDir, 'package.json'), 'utf8'))
      const scripts = Object.keys(pkg.scripts ?? {}).join(', ')
      console.log(`\n  \x1b[2mProject  : ${pkg.name ?? 'unnamed'} v${pkg.version ?? '?'}`)
      if (pkg.description) console.log(`  ${pkg.description}`)
      if (scripts) console.log(`  Scripts  : ${scripts}\x1b[0m`)
    } catch {}
  }
  console.log()

  // ── Last session ──────────────────────────────────────────────────────────
  if (existsSync(wf.session)) {
    ui.section('Last Session')
    try {
      const { readFile } = await import('fs/promises')
      const s = JSON.parse(await readFile(wf.session, 'utf8'))
      if (s.objective) {
        console.log(`  Objective  : ${String(s.objective).slice(0, 72)}`)
        console.log(`  Steps      : ${s.steps ?? 0}`)
        console.log(`  Completed  : ${s.completedAt ?? 'unknown'}`)
      }
      console.log()
    } catch {}
  }

  console.log('\x1b[2mRun \x1b[0m\x1b[36maether\x1b[0m\x1b[2m to start an interactive session.\x1b[0m\n')
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function gb(bytes) {
  return (bytes / 1024 / 1024 / 1024).toFixed(1) + 'GB'
}

async function checkNetwork() {
  try {
    const { stdout } = await execAsync(
      'curl -s -o /dev/null -w "%{http_code}" --max-time 6 https://gemini.google.com',
      { timeout: 8000 }
    )
    const code = stdout.trim()
    return { ok: code.startsWith('2') || code.startsWith('3'), code, detail: `HTTP ${code}` }
  } catch {}

  try {
    const res = await fetch('https://gemini.google.com', { signal: AbortSignal.timeout(6000) })
    return { ok: res.status < 400, code: String(res.status), detail: `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, code: 'ERR', detail: err.message.slice(0, 60) }
  }
}
