import { homedir } from 'os'

// ─── ANSI helpers ─────────────────────────────────────────────────────────────
const R = '\x1b[0m'
const B = '\x1b[1m'
const D = '\x1b[2m'

export const clr = {
  red    : s => `\x1b[31m${s}${R}`,
  green  : s => `\x1b[32m${s}${R}`,
  yellow : s => `\x1b[33m${s}${R}`,
  cyan   : s => `\x1b[36m${s}${R}`,
  gray   : s => `\x1b[90m${s}${R}`,
  bold   : s => `${B}${s}${R}`,
  dim    : s => `${D}${s}${R}`,
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
class Spinner {
  constructor() {
    this.frames   = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏']
    this.idx      = 0
    this.text     = ''
    this.timer    = null
    this.spinning = false
  }
  start(text = '') {
    this.text = text; this.spinning = true
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => {
      const f = `\x1b[36m${this.frames[this.idx]}\x1b[0m`
      process.stdout.write(`\r${f} \x1b[2m${this.text}\x1b[0m   `)
      this.idx = (this.idx + 1) % this.frames.length
    }, 80)
    return this
  }
  update(text) { this.text = text; return this }
  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    process.stdout.write('\r\x1b[K')
    this.spinning = false
    return this
  }
  succeed(text) { this.stop(); console.log(`\x1b[32m✓\x1b[0m ${text || this.text}`); return this }
  fail(text)    { this.stop(); console.log(`\x1b[31m✗\x1b[0m ${text || this.text}`); return this }
}

export const spin = new Spinner()

// ─── Tool → human-readable status ────────────────────────────────────────────
function toolStatus(toolName, params) {
  const p = params ?? {}
  switch (toolName) {
    case 'read_file':        return `Reading ${p.path ?? 'file'}…`
    case 'write_file':       return `Writing ${p.path ?? 'file'}…`
    case 'edit_file':        return `Updating ${p.path ?? 'file'}…`
    case 'append_file':      return `Updating ${p.path ?? 'file'}…`
    case 'delete_file':      return `Deleting ${p.path ?? 'file'}…`
    case 'delete_directory': return `Deleting ${p.path ?? 'directory'}…`
    case 'move_file':        return `Moving ${p.source ?? p.path ?? 'file'}…`
    case 'rename_file':      return `Renaming ${p.path ?? 'file'}…`
    case 'copy_file':        return `Copying ${p.source ?? 'file'}…`
    case 'create_directory': return `Creating folder ${p.path ?? ''}…`
    case 'list_directory':   return `Scanning ${p.path ?? '.'}…`
    case 'search_files':     return `Searching files…`
    case 'project_scan':     return `Scanning project…`
    case 'memory_read':      return `Reading memory…`
    case 'memory_write':     return `Saving to memory…`
    case 'git_status':       return `Checking git status…`
    case 'git_add':          return `Staging changes…`
    case 'git_commit':       return `Committing changes…`
    case 'git_push':         return `Pushing to remote…`
    case 'git_pull':         return `Pulling from remote…`
    case 'git_clone':        return `Cloning repository…`
    case 'start_server':     return `Starting server…`
    case 'stop_server':      return `Stopping server…`
    case 'server_status':    return `Checking server…`
    case 'execute_command': {
      const cmd = String(p.command ?? '').trim().slice(0, 60)
      if (/npm (run )?build|pnpm build|yarn build/.test(cmd))   return `Building project…`
      if (/npm (run )?test|jest|vitest|mocha/.test(cmd))        return `Running tests…`
      if (/npm install|pnpm install|yarn/.test(cmd))            return `Installing dependencies…`
      if (/npm (run )?dev|pnpm dev|yarn dev/.test(cmd))         return `Starting dev server…`
      if (/npm (run )?lint|eslint|tsc/.test(cmd))               return `Linting / type-checking…`
      return `Running: ${cmd}…`
    }
    default: return `Processing…`
  }
}

// ─── Observation → clean result message ──────────────────────────────────────
function observationResult(toolName, params, obs) {
  const p   = params ?? {}
  const ok  = !obs.startsWith('ERROR') && !obs.includes('COMMAND FAILED') && !obs.startsWith('EXECUTOR ERROR')

  switch (toolName) {
    case 'write_file':
      return ok
        ? `\x1b[32m✓\x1b[0m Created:  \x1b[2m${p.path}\x1b[0m`
        : `\x1b[31m✗\x1b[0m Failed to write: \x1b[2m${p.path}\x1b[0m`

    case 'edit_file':
    case 'append_file':
      return ok
        ? `\x1b[32m✓\x1b[0m Updated:  \x1b[2m${p.path}\x1b[0m`
        : `\x1b[31m✗\x1b[0m Failed to update: \x1b[2m${p.path}\x1b[0m`

    case 'delete_file':
    case 'delete_directory':
      return ok
        ? `\x1b[32m✓\x1b[0m Deleted:  \x1b[2m${p.path}\x1b[0m`
        : `\x1b[31m✗\x1b[0m Failed to delete: \x1b[2m${p.path}\x1b[0m`

    case 'move_file':
    case 'rename_file':
      return ok
        ? `\x1b[32m✓\x1b[0m Renamed:  \x1b[2m${p.source ?? p.path} → ${p.destination ?? p.newName}\x1b[0m`
        : `\x1b[31m✗\x1b[0m Move failed`

    case 'copy_file':
      return ok
        ? `\x1b[32m✓\x1b[0m Copied:   \x1b[2m${p.source} → ${p.destination}\x1b[0m`
        : `\x1b[31m✗\x1b[0m Copy failed`

    case 'create_directory':
      return ok
        ? `\x1b[32m✓\x1b[0m Folder:   \x1b[2m${p.path}\x1b[0m`
        : `\x1b[31m✗\x1b[0m Folder creation failed`

    case 'execute_command': {
      if (!ok) {
        // Show only the first meaningful error line
        const errLine = obs.split('\n')
          .map(l => l.trim())
          .filter(l => l && !l.startsWith('>') && !l.startsWith('npm warn'))
          .find(l => l.length > 3) ?? obs.slice(0, 120)
        return `\x1b[33m⚠\x1b[0m  \x1b[2m${errLine.slice(0, 120)}\x1b[0m`
      }
      // Success — only show if meaningful output
      const lines = obs.split('\n').filter(l => l.trim() && !l.startsWith('['))
      const preview = lines.slice(0, 2).join(' ').slice(0, 100)
      return preview ? `\x1b[32m✓\x1b[0m \x1b[2m${preview}\x1b[0m` : null
    }

    case 'git_commit':
      return ok ? `\x1b[32m✓\x1b[0m Committed` : `\x1b[31m✗\x1b[0m Commit failed`
    case 'git_push':
      return ok ? `\x1b[32m✓\x1b[0m Pushed` : `\x1b[31m✗\x1b[0m Push failed`

    // Silent for read/scan/search/memory
    case 'read_file':
    case 'list_directory':
    case 'search_files':
    case 'project_scan':
    case 'memory_read':
    case 'memory_write':
      return null

    case 'start_server': {
      if (!ok) return `\x1b[31m✗\x1b[0m Server failed to start`
      const url = obs.match(/https?:\/\/localhost:\d+[^\s]*/i)?.[0]
      return url
        ? `\x1b[32m✓\x1b[0m Server started → \x1b[36m${url}\x1b[0m`
        : `\x1b[32m✓\x1b[0m Server started`
    }

    default:
      return ok ? null : `\x1b[31m✗\x1b[0m Error in ${toolName}`
  }
}

// ─── Main UI object ───────────────────────────────────────────────────────────
export const ui = {

  banner() {
    const v = '2.0.0'
    console.log(`
\x1b[38;5;39m  ╔══════════════════════════════════════════════════════╗\x1b[0m
\x1b[38;5;39m  ║\x1b[0m                                                      \x1b[38;5;39m║\x1b[0m
\x1b[38;5;39m  ║\x1b[0m  \x1b[1m\x1b[38;5;51m ▲  A E T H E R\x1b[0m   \x1b[38;5;245mv${v}\x1b[0m                          \x1b[38;5;39m║\x1b[0m
\x1b[38;5;39m  ║\x1b[0m  \x1b[38;5;245m AI Development Partner · Powered by Gemini\x1b[0m       \x1b[38;5;39m║\x1b[0m
\x1b[38;5;39m  ║\x1b[0m                                                      \x1b[38;5;39m║\x1b[0m
\x1b[38;5;39m  ╚══════════════════════════════════════════════════════╝\x1b[0m
`)
  },

  workspaceInfo(workingDir, projectScan) {
    const home    = homedir()
    const display = workingDir.startsWith(home) ? '~' + workingDir.slice(home.length) : workingDir
    let projectLine = null
    if (projectScan) {
      const fw  = projectScan.match(/⚡ Framework\s+:\s+(.+)/)?.[1]?.trim()
      const typ = projectScan.match(/🔤 Language\s+:\s+(.+)/)?.[1]?.trim()
      const nm  = projectScan.match(/🏷 Project\s+:\s+(.+)/)?.[1]?.trim()
      const parts = [fw, !fw && typ].filter(Boolean)
      if (nm && nm !== '(unnamed)') projectLine = `${nm}${parts.length ? ` · ${parts.join(' · ')}` : ''}`
      else if (parts.length) projectLine = parts.join(' · ')
    }
    console.log(`  \x1b[38;5;245mWorkspace\x1b[0m  \x1b[1m${display}\x1b[0m`)
    if (projectLine) console.log(`  \x1b[38;5;245mProject  \x1b[0m  \x1b[36m${projectLine}\x1b[0m`)
    console.log()
  },

  help() {
    console.log(`\x1b[1mUsage:\x1b[0m
  \x1b[36maether\x1b[0m                    Interactive AI mode
  \x1b[36maether\x1b[0m \x1b[2m[task]\x1b[0m             Run task directly
  \x1b[36maether run\x1b[0m  \x1b[2m[cmd]\x1b[0m         Run command + AI error recovery
  \x1b[36maether doctor\x1b[0m             Diagnostics
  \x1b[36maether memory\x1b[0m             Persistent memory

\x1b[1mIn interactive mode:\x1b[0m
  \x1b[36m/help\x1b[0m   \x1b[36m/scan\x1b[0m   \x1b[36m/memory\x1b[0m   \x1b[36m/serve\x1b[0m   \x1b[36m/history\x1b[0m   \x1b[36m/clear\x1b[0m   \x1b[36m/exit\x1b[0m

\x1b[1mFlags:\x1b[0m  \x1b[36m--max N\x1b[0m   \x1b[36m--verbose\x1b[0m   \x1b[36m--version\x1b[0m
`)
  },

  // ── Status ─────────────────────────────────────────────────────────────────
  status(text)  { spin.spinning ? spin.update(text) : spin.start(text) },
  thinking(t)   { spin.start(t || 'Thinking…') },
  stopSpin()    { spin.stop() },
  log(text)     { console.log(text) },
  success(text) { spin.stop(); console.log(`\x1b[32m✓\x1b[0m ${text}`) },
  error(text)   { spin.stop(); console.log(`\x1b[31m✗\x1b[0m \x1b[31m${text}\x1b[0m`) },
  warn(text)    { spin.stop(); console.log(`\x1b[33m⚠\x1b[0m \x1b[33m${text}\x1b[0m`) },
  info(text)    { spin.stop(); console.log(`\x1b[36mℹ\x1b[0m ${text}`) },

  section(title) {
    console.log(`\n\x1b[1m\x1b[36m${title}\x1b[0m`)
    console.log('\x1b[90m' + '─'.repeat(Math.min(title.length + 2, 60)) + '\x1b[0m')
  },

  // ── SILENT TOOL MODE ───────────────────────────────────────────────────────
  // Shows clean human-readable status instead of raw tool+params
  silentAction(toolName, params) {
    spin.stop()
    const msg = toolStatus(toolName, params)
    spin.start(msg)
  },

  // Shows clean result instead of raw observation text
  silentObservation(toolName, params, obs) {
    spin.stop()
    const msg = observationResult(toolName, params, obs)
    if (msg) console.log(msg)
  },

  // ── Auto-fix status messages ───────────────────────────────────────────────
  detecting(msg)     { spin.stop(); console.log(`\n\x1b[33m⚠\x1b[0m  Detecting error…`);              spin.start(msg || 'Analyzing…') },
  analyzing(msg)     { spin.update(msg || 'Analyzing error…') },
  fixing(file)       { spin.update(`Fixing ${file ?? 'error'}…`) },
  retrying(cmd)      { spin.stop(); console.log(`\x1b[36m↻\x1b[0m  Retrying: \x1b[2m${cmd}\x1b[0m…`); spin.start('Running…') },
  fixed(what)        { spin.stop(); console.log(`\x1b[32m✓\x1b[0m Fixed: \x1b[2m${what}\x1b[0m`) },

  // ── Build status ───────────────────────────────────────────────────────────
  buildStart()       { spin.stop(); console.log(); spin.start('Building project…') },
  buildSuccess()     { spin.stop(); console.log(`\x1b[32m✓\x1b[0m Build successful`) },
  buildFail(summary) { spin.stop(); console.log(`\x1b[31m✗\x1b[0m Build failed`); if (summary) console.log(`\x1b[2m  ${summary.slice(0,120)}\x1b[0m`) },

  // ── Project gen ────────────────────────────────────────────────────────────
  projectGenDone(filesCreated, outputDir) {
    spin.stop()
    console.log()
    console.log(`\x1b[32m✓\x1b[0m \x1b[1m${filesCreated} file${filesCreated !== 1 ? 's' : ''} created\x1b[0m`)
    if (outputDir) console.log(`\x1b[32m✓\x1b[0m Project ready at \x1b[36m${outputDir}\x1b[0m`)
    console.log()
  },

  // ── Confirmation ───────────────────────────────────────────────────────────
  confirmBox(lines) {
    spin.stop()
    console.log()
    console.log('\x1b[33m┌─ Confirmation required ──────────────────────────────┐\x1b[0m')
    lines.forEach(l => console.log(`\x1b[33m│\x1b[0m  ${l}`))
    console.log('\x1b[33m└──────────────────────────────────────────────────────┘\x1b[0m')
  },

  // ── Final answer ───────────────────────────────────────────────────────────
  finalAnswer(text) {
    spin.stop()
    console.log(`
\x1b[32m╔═══════════════════════════════════════════════╗\x1b[0m
\x1b[32m║  ✅  Task Complete                            ║\x1b[0m
\x1b[32m╚═══════════════════════════════════════════════╝\x1b[0m
`)
    // Strip any code blocks from final answer display
    const clean = text
      .replace(/```[\s\S]*?```/g, '[code omitted]')
      .replace(/`[^`\n]{30,}`/g, '[code omitted]')
    console.log(clean)
    console.log()
  },

  // ── Chat ───────────────────────────────────────────────────────────────────
  chatReply(text) {
    spin.stop()
    console.log(`\n\x1b[1m\x1b[32mAETHER\x1b[0m\x1b[90m ›\x1b[0m\n${text}\n`)
  },

  // ── Iteration header (step counter) ───────────────────────────────────────
  iterHeader(i, max) {
    spin.stop()
    const bar = progressBar(i, max, 16)
    console.log(`\n\x1b[90m── ${String(i).padStart(2)}/${max}  ${bar} ──\x1b[0m`)
  },

  // ── Server ─────────────────────────────────────────────────────────────────
  serverStarted(url, command) {
    spin.stop()
    console.log(`\n\x1b[32m✓\x1b[0m Server started`)
    if (url) console.log(`\x1b[32m✓\x1b[0m URL: \x1b[1m\x1b[36m${url}\x1b[0m`)
    console.log(`\x1b[2m  ${command}\x1b[0m\n`)
  },
}

function progressBar(current, total, width) {
  const pct    = Math.min(current / total, 1)
  const filled = Math.round(pct * width)
  return '\x1b[32m' + '█'.repeat(filled) + '\x1b[90m' + '░'.repeat(width - filled) + '\x1b[0m'
}

export default ui
