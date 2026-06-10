/**
 * interactive.mjs — Unified AETHER interactive mode
 * AUTO FIX MODE: silent tools, clean output, auto-retry on errors.
 */
import readline             from 'readline'
import { AetherAgent }      from '../agent/index.mjs'
import { ui, spin }         from './ui.mjs'
import { scanProject }      from '../scanner/index.mjs'
import { initWorkspace,
         getWorkspaceFiles } from '../config/index.mjs'
import { askGemini }        from '../providers/gemini.mjs'
import { homedir }          from 'os'
import { existsSync }       from 'fs'
import { readFile }         from 'fs/promises'

// ─── Task routing keywords ────────────────────────────────────────────────────
const TASK_EN = /^\s*(create|make|build|write|fix|add|remove|delete|update|refactor|implement|generate|install|setup|init|configure|rename|move|copy|migrate|start|run|deploy|test|scaffold|debug|optimize|convert|fetch)\b/i
const TASK_ID = /^\s*(buat|bikin|tulis|perbaiki|tambah|hapus|ubah|jalankan|mulai|pasang|konfigurasi|atur|pindah|salin|rename|deploy|debug|generate|buat|buatkan)\b/i
const PROJ_GEN = /\b(website|landing.?page|web.?app|app|aplikasi|project|proyek|bot|dashboard|api|backend|frontend|portfolio|blog|toko|ecommerce|todo.?app|chat.?app|crud)\b/i
const DESTRUCTIVE = new Set(['delete_file','delete_directory','move_file','rename_file'])

function looksLikeTask(input) {
  return TASK_EN.test(input) || TASK_ID.test(input) ||
    (PROJ_GEN.test(input) && input.length > 15) ||
    /\.(js|ts|jsx|tsx|css|html|json|py|go|rs|md|yml|yaml|toml|sh|env)\b/i.test(input)
}

function looksLikeProjectGen(input) {
  return PROJ_GEN.test(input) && (TASK_EN.test(input) || TASK_ID.test(input))
}

// ─── Main entry ───────────────────────────────────────────────────────────────
export async function runInteractive(options = {}) {
  const {
    workingDir  = process.cwd(),
    config      = {},
    verbose     = false,
    directTask  = null,
  } = options

  ui.banner()
  await initWorkspace(workingDir)

  spin.start('Scanning workspace…')
  let projectScan = null
  try { projectScan = await scanProject('.', workingDir) } catch {}
  spin.stop()

  ui.workspaceInfo(workingDir, projectScan)

  // Show last task hint
  const wFiles = getWorkspaceFiles(workingDir)
  try {
    if (existsSync(wFiles.session)) {
      const s = JSON.parse(await readFile(wFiles.session, 'utf8'))
      if (s.objective) {
        const short = String(s.objective).slice(0, 60)
        console.log(`  \x1b[38;5;245mLast task\x1b[0m  \x1b[2m"${short}${s.objective.length > 60 ? '…' : ''}"\x1b[0m`)
        console.log()
      }
    }
  } catch {}

  console.log('  \x1b[2mType a task or question.  /help for commands.\x1b[0m\n')

  const maxIterations = config.maxIterations ?? 25

  if (directTask) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.on('SIGINT', () => { console.log('\n'); rl.close(); process.exit(0) })
    await handleInput(directTask, workingDir, maxIterations, verbose, projectScan, rl)
    rl.close()
    return
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  rl.on('SIGINT', () => {
    console.log('\n\x1b[36m  Goodbye ✨\x1b[0m\n')
    rl.close(); process.exit(0)
  })

  const ask = () => {
    rl.question('\x1b[1m\x1b[36mYou › \x1b[0m', async (raw) => {
      const input = raw.trim()
      if (!input) { ask(); return }
      if (input.startsWith('/')) {
        await handleSlash(input, workingDir, maxIterations, verbose, projectScan, rl)
      } else {
        await handleInput(input, workingDir, maxIterations, verbose, projectScan, rl)
      }
      ask()
    })
  }
  ask()
  return new Promise(resolve => rl.on('close', resolve))
}

// ─── Route to agent or chat ───────────────────────────────────────────────────
async function handleInput(input, workingDir, maxIterations, verbose, projectScan, rl) {
  if (looksLikeTask(input)) {
    await runAgentTask(input, workingDir, maxIterations, verbose, projectScan, rl)
  } else {
    await runChatQuery(input, workingDir, verbose)
  }
}

// ─── AGENT TASK with AUTO FIX MODE ───────────────────────────────────────────
async function runAgentTask(objective, workingDir, maxIterations, verbose, projectScan, rl) {
  const isGenMode = looksLikeProjectGen(objective)

  // Project gen: plan first, confirm, then execute
  if (isGenMode) {
    const confirmed = await projectGenConfirm(objective, workingDir, rl)
    if (!confirmed) { console.log('\x1b[2m  Cancelled.\x1b[0m\n'); return }
    console.log()
  }

  // ── Track state for clean display ────────────────────────────────────────
  let _lastTool   = null
  let _lastParams = null
  let filesCount  = 0
  let errorCount  = 0

  const startTime = Date.now()
  spin.start(isGenMode ? 'Generating project…' : 'Thinking…')

  const agent = new AetherAgent({
    workingDir,
    maxIterations,
    verbose,

    // ── Status ───────────────────────────────────────────────────────────
    onStatus(text) {
      spin.update(text)
    },

    // ── Iteration — minimal step counter ─────────────────────────────────
    onIteration(i, max) {
      if (!isGenMode) {
        spin.stop()
        const bar = progressBar(i, max, 14)
        console.log(`\n\x1b[90m── ${String(i).padStart(2)}/${max}  ${bar} ──\x1b[0m`)
      }
    },

    // ── Thought — completely silent (just update spinner) ─────────────────
    onThought(thought) {
      // Extract a short hint for spinner without showing full thought
      const hint = thought.trim().split('.')[0].slice(0, 60)
      if (hint) spin.update(hint + '…')
    },

    // ── Action — SILENT TOOL MODE ─────────────────────────────────────────
    onAction(toolName, params) {
      _lastTool   = toolName
      _lastParams = params
      spin.stop()

      // Detect build commands for special status
      if (toolName === 'execute_command') {
        const cmd = String(params?.command ?? '')
        if (/npm (run )?build|tsc --/.test(cmd))     { ui.buildStart(); return }
        if (/npm install|pnpm install/.test(cmd))    { spin.start('Installing dependencies…'); return }
        if (/npm (run )?test|jest|vitest/.test(cmd)) { spin.start('Running tests…'); return }
      }

      // Count file writes silently
      if (toolName === 'write_file') {
        filesCount++
        if (isGenMode) {
          spin.start(`Creating files… [${filesCount}] ${params?.path ?? ''}`)
          return
        }
      }

      // Clean status — no raw tool name or params shown
      const msg = toolStatusMsg(toolName, params)
      spin.start(msg)
    },

    // ── Observation — clean result display ────────────────────────────────
    onObservation(obs) {
      spin.stop()
      const tool   = _lastTool
      const params = _lastParams
      const failed = obs.startsWith('ERROR') || obs.includes('COMMAND FAILED') || obs.startsWith('EXECUTOR ERROR')

      if (failed) {
        errorCount++
        // Show that we detected an error and are fixing automatically
        if (tool === 'execute_command') {
          const firstLine = obs.split('\n')
            .map(l => l.trim())
            .filter(l => l && !/^(npm warn|>|\s*$)/.test(l))
            .find(l => l.length > 2) ?? 'Command failed'

          // Show brief error + auto-fix notice
          console.log(`\x1b[33m⚠\x1b[0m  \x1b[2m${firstLine.slice(0, 100)}\x1b[0m`)
          console.log(`\x1b[36m↻\x1b[0m  Detecting error… analyzing… fixing automatically`)
          spin.start('Analyzing error…')
        } else {
          const msg = cleanObservation(tool, params, obs)
          if (msg) console.log(msg)
        }
        return
      }

      // Success — format cleanly
      if (tool === 'execute_command') {
        const cmd = String(params?.command ?? '')
        if (/npm (run )?build|tsc --/.test(cmd)) {
          ui.buildSuccess()
          return
        }
        if (/npm (run )?test|jest|vitest/.test(cmd)) {
          console.log(`\x1b[32m✓\x1b[0m Tests passed`)
          return
        }
        if (/npm install|pnpm install/.test(cmd)) {
          console.log(`\x1b[32m✓\x1b[0m Dependencies installed`)
          return
        }
      }

      const msg = cleanObservation(tool, params, obs)
      if (msg) console.log(msg)
    },

    // ── Final answer ──────────────────────────────────────────────────────
    onFinalAnswer(answer) {
      spin.stop()
      if (isGenMode) {
        const home = homedir()
        const dir  = workingDir.startsWith(home) ? '~' + workingDir.slice(home.length) : workingDir
        ui.projectGenDone(filesCount, filesCount > 0 ? dir : null)
        // Show only a brief non-code summary
        const summary = stripCode(answer).split('\n').filter(l => l.trim()).slice(0, 4).join('\n')
        if (summary.trim()) console.log(`\x1b[2m${summary}\x1b[0m\n`)
      } else {
        ui.finalAnswer(answer)
      }
    },

    onError(msg) {
      spin.stop()
      // Suppress internal agent warnings in normal mode (they're noise)
      if (verbose) console.log(`\x1b[90m[debug] ${msg}\x1b[0m`)
    },

    // ── Confirm destructive ops ───────────────────────────────────────────
    async onBeforeAction(toolName, params) {
      if (!DESTRUCTIVE.has(toolName)) return true
      spin.stop()
      const desc = describeAction(toolName, params)
      ui.confirmBox([`About to: \x1b[1m${desc}\x1b[0m`])
      return new Promise(resolve => {
        rl.question('\n  Proceed? [\x1b[32mY\x1b[0m/\x1b[31mn\x1b[0m] ', ans => {
          const yes = ans.trim().toLowerCase() !== 'n'
          if (!yes) console.log('\x1b[2m  Skipped.\x1b[0m')
          console.log()
          resolve(yes)
        })
      })
    },
  })

  try {
    const result  = await agent.run(objective)
    spin.stop()
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

    if (!isGenMode) {
      const mark = result.success ? '\x1b[32m✓\x1b[0m' : '\x1b[33m⚠\x1b[0m'
      console.log(`${mark} \x1b[2mDone · ${result.iterations} steps · ${elapsed}s\x1b[0m\n`)
      if (!result.success) {
        console.log('\x1b[2mTip: Run again to continue where AETHER left off.\x1b[0m\n')
      }
    }
  } catch (err) {
    spin.stop()
    ui.error(`Agent error: ${err.message}`)
    printConnectionHint(err)
  }
}

// ─── Chat mode ────────────────────────────────────────────────────────────────
let _chatAgent = null
async function runChatQuery(message, workingDir, verbose) {
  if (!_chatAgent || _chatAgent.workingDir !== workingDir) {
    _chatAgent = new AetherAgent({ workingDir, verbose })
  }
  spin.start('Thinking…')
  try {
    const reply = await _chatAgent.chat(message)
    spin.stop()
    ui.chatReply(reply)
  } catch (err) {
    spin.stop()
    ui.error(`Error: ${err.message}`)
    printConnectionHint(err)
  }
}

// ─── Project gen planning ─────────────────────────────────────────────────────
async function projectGenConfirm(objective, workingDir, rl) {
  spin.start('Planning project structure…')
  let planText = null
  try {
    const prompt = `Project planner. User wants: "${objective}"\n\nList files to be created (one per line):\n- path/to/file.ext : description\n\nMax 20 files. No explanation, just the list.`
    planText = await askGemini(prompt)
  } catch { spin.stop(); return true }
  spin.stop()

  const fileLines = planText.split('\n')
    .filter(l => l.match(/^\s*[-•*]?\s*\S+\.\w+/))
    .slice(0, 25)

  if (!fileLines.length) return true

  console.log(`\n\x1b[1mProject Plan\x1b[0m`)
  console.log('\x1b[90m' + '─'.repeat(44) + '\x1b[0m')
  fileLines.forEach(l => console.log(`  \x1b[2m${l.trim()}\x1b[0m`))
  console.log('\x1b[90m' + '─'.repeat(44) + '\x1b[0m')
  console.log(`  \x1b[2m${fileLines.length} file(s) planned\x1b[0m\n`)

  return new Promise(resolve => {
    rl.question('  Proceed? [\x1b[32mY\x1b[0m/\x1b[31mn\x1b[0m] ', ans => {
      console.log()
      resolve(ans.trim().toLowerCase() !== 'n')
    })
  })
}

// ─── Slash commands ───────────────────────────────────────────────────────────
async function handleSlash(input, workingDir, maxIterations, verbose, projectScan, rl) {
  const [cmd, ...rest] = input.slice(1).split(' ')
  const arg = rest.join(' ').trim()

  switch (cmd.toLowerCase()) {
    case 'help': case 'h':
      console.log(`
\x1b[1mCommands:\x1b[0m
  \x1b[36m/scan\x1b[0m       Scan current project
  \x1b[36m/memory\x1b[0m     View persistent memory
  \x1b[36m/history\x1b[0m    Recent task history
  \x1b[36m/serve\x1b[0m      Start dev server
  \x1b[36m/run\x1b[0m \x1b[2m<cmd>\x1b[0m   Run a shell command
  \x1b[36m/clear\x1b[0m      Clear screen
  \x1b[36m/reset\x1b[0m      Clear chat history
  \x1b[36m/exit\x1b[0m       Exit\n`)
      break

    case 'clear':
      console.clear()
      ui.banner()
      ui.workspaceInfo(workingDir, projectScan)
      break

    case 'reset':
      _chatAgent = null
      console.log('\x1b[32m✓\x1b[0m Chat history cleared.\n')
      break

    case 'scan': {
      spin.start('Scanning project…')
      try {
        const result = await scanProject('.', workingDir)
        spin.stop(); console.log(`\n${result}\n`)
      } catch (err) { spin.fail(`Scan failed: ${err.message}`) }
      break
    }

    case 'memory': {
      const { Memory } = await import('../agent/memory/index.mjs')
      const mem  = new Memory(workingDir)
      const ctx  = await mem.getContextSummary()
      const last = await mem.getLastSession()
      console.log('\n\x1b[1mMemory\x1b[0m\n\x1b[90m' + '─'.repeat(40) + '\x1b[0m')
      console.log(ctx ?? '\x1b[2m(empty)\x1b[0m')
      if (last?.objective) {
        console.log(`\n\x1b[1mLast Session\x1b[0m`)
        console.log(`  ${String(last.objective).slice(0, 70)}`)
        console.log(`  \x1b[2m${last.steps} steps · ${last.completedAt}\x1b[0m`)
      }
      console.log()
      break
    }

    case 'history': {
      const { getWorkspaceFiles: gwf } = await import('../config/index.mjs')
      const wf = gwf(workingDir)
      try {
        const hist = JSON.parse(await readFile(wf.history, 'utf8'))
        if (!hist.length) { console.log('\x1b[2m  No history.\x1b[0m\n'); break }
        console.log('\n\x1b[1mTask History\x1b[0m\n\x1b[90m' + '─'.repeat(50) + '\x1b[0m')
        hist.slice(-10).reverse().forEach((h, i) => {
          const ts = h.completedAt ? new Date(h.completedAt).toLocaleString() : ''
          console.log(`  \x1b[36m${i+1}.\x1b[0m ${String(h.objective).slice(0,60)}`)
          console.log(`     \x1b[2m${h.steps} steps · ${ts}\x1b[0m`)
        })
        console.log()
      } catch { console.log('\x1b[2m  No history.\x1b[0m\n') }
      break
    }

    case 'serve':
      await runAgentTask(arg ? `Start server: ${arg}` : 'Start the development server', workingDir, 8, verbose, projectScan, rl)
      break

    case 'run': {
      if (!arg) { ui.error('Usage: /run <command>'); break }
      console.log(`\n\x1b[2m$ ${arg}\x1b[0m\n`)
      spin.start(`Running: ${arg}`)
      try {
        const { exec } = await import('child_process')
        const { promisify } = await import('util')
        const { stdout, stderr } = await promisify(exec)(arg, { cwd: workingDir, timeout: 60000 })
        spin.stop()
        if (stdout) process.stdout.write(stdout)
        if (stderr) process.stderr.write('\x1b[33m' + stderr + '\x1b[0m')
        ui.success('Done.\n')
      } catch (err) {
        spin.stop()
        if (err.stdout) process.stdout.write(err.stdout)
        if (err.stderr) process.stderr.write('\x1b[31m' + err.stderr + '\x1b[0m')
        ui.error(`Failed (exit ${err.code ?? 1})`)
        const fix = await askYN('  Fix with AETHER? [Y/n] ', rl)
        if (fix) {
          const errOut = [err.stdout && `STDOUT:\n${err.stdout}`, err.stderr && `STDERR:\n${err.stderr}`].filter(Boolean).join('\n\n')
          await runAgentTask(`Fix the failing command: "${arg}"\n\nError:\n${errOut}`, workingDir, 12, verbose, projectScan, rl)
        }
      }
      break
    }

    case 'exit': case 'quit': case 'q':
      console.log('\n\x1b[36m  Goodbye ✨\x1b[0m\n')
      rl.close(); process.exit(0)
      break

    default:
      console.log(`\x1b[2m  Unknown: /${cmd} — type /help\x1b[0m\n`)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toolStatusMsg(toolName, params) {
  const p = params ?? {}
  switch (toolName) {
    case 'read_file':        return `Reading ${p.path ?? 'file'}…`
    case 'write_file':       return `Writing ${p.path ?? 'file'}…`
    case 'edit_file':        return `Updating ${p.path ?? 'file'}…`
    case 'append_file':      return `Updating ${p.path ?? 'file'}…`
    case 'delete_file':      return `Deleting ${p.path ?? 'file'}…`
    case 'delete_directory': return `Deleting ${p.path ?? 'directory'}…`
    case 'create_directory': return `Creating ${p.path ?? 'directory'}…`
    case 'list_directory':   return `Scanning ${p.path ?? '.'}…`
    case 'search_files':     return `Searching…`
    case 'project_scan':     return `Scanning project…`
    case 'git_status':       return `Checking git…`
    case 'git_add':          return `Staging changes…`
    case 'git_commit':       return `Committing…`
    case 'git_push':         return `Pushing…`
    case 'memory_read':
    case 'memory_write':     return `Memory…`
    case 'start_server':     return `Starting server…`
    case 'execute_command':  return `Running: ${String(p.command ?? '').slice(0, 50)}…`
    default:                 return `Processing…`
  }
}

function cleanObservation(toolName, params, obs) {
  const p   = params ?? {}
  const ok  = !obs.startsWith('ERROR') && !obs.includes('COMMAND FAILED') && !obs.startsWith('EXECUTOR ERROR')
  const G = '\x1b[32m✓\x1b[0m'
  const E = '\x1b[31m✗\x1b[0m'

  switch (toolName) {
    case 'write_file':
      return ok ? `${G} Created:  \x1b[2m${p.path}\x1b[0m` : `${E} Failed: ${p.path}`
    case 'edit_file':
    case 'append_file':
      return ok ? `${G} Updated:  \x1b[2m${p.path}\x1b[0m` : `${E} Failed: ${p.path}`
    case 'delete_file':
    case 'delete_directory':
      return ok ? `${G} Deleted:  \x1b[2m${p.path}\x1b[0m` : `${E} Delete failed`
    case 'move_file':
    case 'rename_file':
      return ok ? `${G} Renamed:  \x1b[2m${p.source ?? p.path} → ${p.destination ?? p.newName}\x1b[0m` : `${E} Move failed`
    case 'copy_file':
      return ok ? `${G} Copied:   \x1b[2m${p.source} → ${p.destination}\x1b[0m` : `${E} Copy failed`
    case 'create_directory':
      return ok ? `${G} Folder:   \x1b[2m${p.path}\x1b[0m` : `${E} Folder failed`
    case 'git_commit': return ok ? `${G} Committed` : `${E} Commit failed`
    case 'git_push':   return ok ? `${G} Pushed`    : `${E} Push failed`
    case 'start_server': {
      if (!ok) return `${E} Server failed`
      const url = obs.match(/https?:\/\/localhost:\d+[^\s]*/i)?.[0]
      return url ? `${G} Server → \x1b[36m${url}\x1b[0m` : `${G} Server started`
    }
    // Silent for reads/scans
    case 'read_file':
    case 'list_directory':
    case 'search_files':
    case 'project_scan':
    case 'memory_read':
    case 'memory_write':
      return null
    default:
      return ok ? null : `${E} Error in ${toolName}`
  }
}

function stripCode(text) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]{30,}`/g, '').trim()
}

function progressBar(current, total, width) {
  const filled = Math.round(Math.min(current / total, 1) * width)
  return '\x1b[32m' + '█'.repeat(filled) + '\x1b[90m' + '░'.repeat(width - filled) + '\x1b[0m'
}

function describeAction(toolName, params) {
  switch (toolName) {
    case 'delete_file':      return `delete file: ${params?.path}`
    case 'delete_directory': return `delete directory: ${params?.path}`
    case 'move_file':        return `move: ${params?.source} → ${params?.destination}`
    case 'rename_file':      return `rename: ${params?.path} → ${params?.newName}`
    default:                 return toolName
  }
}

function printConnectionHint(err) {
  const msg = (err.message ?? '').toLowerCase()
  if (msg.includes('session') || msg.includes('fetch') || msg.includes('initialize') || msg.includes('enotfound')) {
    console.log(`\n\x1b[33mConnection tips:\x1b[0m\n  • Sign in at \x1b[36mhttps://gemini.google.com\x1b[0m\n  • Run \x1b[36maether doctor\x1b[0m for diagnostics\n`)
  }
}

async function askYN(question, rl) {
  return new Promise(resolve => {
    rl.question(question, ans => resolve(ans.trim().toLowerCase() !== 'n'))
  })
}
