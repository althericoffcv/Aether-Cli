/**
 * interactive.mjs — Unified AETHER interactive mode
 *
 * Launched when user runs `aether` with no arguments.
 * Combines chat + autonomous agent in one loop with smart routing.
 */
import readline          from 'readline'
import { AetherAgent }   from '../agent/index.mjs'
import { ui, spin }      from './ui.mjs'
import { scanProject }   from '../scanner/index.mjs'
import { initWorkspace,
         getWorkspaceFiles } from '../config/index.mjs'
import { askGemini }     from '../providers/gemini.mjs'
import { homedir }       from 'os'
import { existsSync }    from 'fs'
import { readFile }      from 'fs/promises'

// ─── Keywords for task vs chat routing ───────────────────────────────────────
const TASK_VERBS_EN = /^\s*(create|make|build|write|fix|add|remove|delete|update|refactor|implement|generate|install|setup|initialize|configure|rename|move|copy|migrate|start|run|deploy|test|scaffold|fetch|debug|optimize|convert)\b/i
const TASK_VERBS_ID = /^\s*(buat|bikin|tulis|perbaiki|tambah|hapus|ubah|jalankan|mulai|pasang|konfigurasi|atur|pindah|salin|rename|deploy|debug|generate)\b/i
const PROJECT_GEN   = /\b(website|landing.?page|web.?app|app|aplikasi|project|proyek|bot|dashboard|api|backend|frontend|portfolio|blog|toko|ecommerce|todo.?app|chat.?app|crud)\b/i
const DESTRUCTIVE   = new Set(['delete_file', 'delete_directory', 'move_file', 'rename_file'])
const FILE_WRITES   = new Set(['write_file', 'edit_file', 'append_file', 'copy_file'])

function looksLikeTask(input) {
  return TASK_VERBS_EN.test(input) ||
         TASK_VERBS_ID.test(input) ||
         (PROJECT_GEN.test(input) && input.length > 15) ||
         /\.(js|ts|jsx|tsx|css|html|json|py|go|rs|md|yml|yaml|toml|sh|env)\b/i.test(input)
}

function looksLikeProjectGen(input) {
  return PROJECT_GEN.test(input) && (TASK_VERBS_EN.test(input) || TASK_VERBS_ID.test(input))
}

// ─── Main entry ───────────────────────────────────────────────────────────────
export async function runInteractive(options = {}) {
  const {
    workingDir    = process.cwd(),
    config        = {},
    verbose       = false,
    directTask    = null,   // task passed directly via CLI args
  } = options

  // ── 1. Banner ─────────────────────────────────────────────────────────────
  ui.banner()

  // ── 2. Init workspace .aether/ silently ───────────────────────────────────
  await initWorkspace(workingDir)

  // ── 3. Scan project ───────────────────────────────────────────────────────
  spin.start('Scanning workspace…')
  let projectScan = null
  try {
    projectScan = await scanProject('.', workingDir)
  } catch {}
  spin.stop()

  // ── 4. Show workspace info ────────────────────────────────────────────────
  ui.workspaceInfo(workingDir, projectScan)

  // ── 5. Check for last session ─────────────────────────────────────────────
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

  console.log('  \x1b[2mType a task or question. Use /help for commands.\x1b[0m\n')

  // ── 6. Build agent ────────────────────────────────────────────────────────
  const maxIterations = config.maxIterations ?? 25

  // ── 7. Handle direct task from CLI args ───────────────────────────────────
  if (directTask) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.on('SIGINT', () => { console.log('\n'); rl.close(); process.exit(0) })
    await handleInput(directTask, workingDir, maxIterations, verbose, projectScan, rl)
    rl.close()
    return
  }

  // ── 8. Interactive REPL ───────────────────────────────────────────────────
  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
  })

  rl.on('SIGINT', () => {
    console.log('\n\x1b[36m  Goodbye ✨\x1b[0m\n')
    rl.close()
    process.exit(0)
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

// ─── Route input → agent or chat ─────────────────────────────────────────────
async function handleInput(input, workingDir, maxIterations, verbose, projectScan, rl) {
  if (looksLikeTask(input)) {
    await runAgentTask(input, workingDir, maxIterations, verbose, projectScan, rl)
  } else {
    await runChatQuery(input, workingDir, verbose)
  }
}

// ─── Agent task mode ─────────────────────────────────────────────────────────
async function runAgentTask(objective, workingDir, maxIterations, verbose, projectScan, rl) {
  const isGenMode    = looksLikeProjectGen(objective)
  let   filesCreated = 0
  let   lastFilePath = null

  console.log()

  if (isGenMode) {
    // Project gen: show plan first, then confirm
    const confirmed = await projectGenConfirm(objective, workingDir, rl)
    if (!confirmed) {
      console.log('\x1b[2m  Cancelled.\x1b[0m\n')
      return
    }
    console.log()
    spin.start('Generating project…')
  }

  const startTime = Date.now()

  const agent = new AetherAgent({
    workingDir,
    maxIterations,
    verbose,

    onStatus(text) {
      if (!isGenMode) ui.status(text)
    },

    onIteration(i, max) {
      if (!isGenMode) {
        spin.stop()
        const bar = progressBar(i, max, 18)
        console.log(`\n\x1b[90m─── Step ${String(i).padStart(2)} / ${max}  ${bar} ───\x1b[0m`)
      }
    },

    onThought(thought) {
      if (!isGenMode) ui.thought(thought)
    },

    onAction(toolName, params) {
      if (isGenMode) {
        if (toolName === 'write_file') {
          filesCreated++
          lastFilePath = params?.path ?? ''
          spin.update(`Creating files… [${filesCreated}] ${lastFilePath}`)
        } else if (toolName === 'execute_command') {
          spin.update(`Running: ${(params?.command ?? '').slice(0, 50)}…`)
        }
        // No action display in gen mode — keeps terminal clean
        return
      }
      // Normal mode: show action with params (content stripped from write_file)
      ui.action(toolName, params)
      spin.start(`Executing ${toolName}…`)
    },

    onObservation(obs) {
      if (!isGenMode) {
        spin.stop()
        ui.observation(obs)
      }
    },

    onFinalAnswer(answer) {
      spin.stop()
      if (isGenMode) {
        const home  = homedir()
        const dir   = workingDir.startsWith(home) ? '~' + workingDir.slice(home.length) : workingDir
        ui.projectGenDone(filesCreated, filesCreated > 0 ? dir : null)
        // Only show the summary, not the full answer (no code)
        const summary = extractSummary(answer)
        if (summary) console.log(`\x1b[2m${summary}\x1b[0m\n`)
      } else {
        ui.finalAnswer(answer)
      }
    },

    onError(msg) {
      if (!isGenMode) {
        spin.stop()
        ui.warn(msg)
      }
    },

    // ── Confirmation before destructive operations ─────────────────────────
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
    const result = await agent.run(objective)
    spin.stop()

    if (!isGenMode) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      const mark    = result.success ? '\x1b[32m✓\x1b[0m' : '\x1b[33m⚠\x1b[0m'
      console.log(`${mark} \x1b[2mDone · ${result.iterations} steps · ${elapsed}s\x1b[0m\n`)

      if (!result.success) {
        ui.warn('Max iterations reached. The task may be partially complete.')
        console.log('\x1b[2mTip: Run again to continue where AETHER left off.\x1b[0m\n')
      }
    }

  } catch (err) {
    spin.stop()
    ui.error(`Agent error: ${err.message}`)
    printConnectionHint(err)
  }
}

// ─── Chat mode (quick questions) ─────────────────────────────────────────────
// Uses a shared agent instance per session for conversation history
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

// ─── Project generation: quick plan + confirm ─────────────────────────────────
async function projectGenConfirm(objective, workingDir, rl) {
  spin.start('Planning project structure…')

  let planText = null
  try {
    const planPrompt = `You are a project planner. The user wants to: "${objective}"

List ONLY the files that will be created, one per line. Format:
- path/to/file.ext : brief description

Keep it under 20 files. Be specific. Do not include explanation, just the file list.`

    planText = await askGemini(planPrompt)
  } catch {
    // If planning fails, skip confirmation and proceed
    spin.stop()
    return true
  }

  spin.stop()

  // Parse file lines from plan
  const fileLines = planText
    .split('\n')
    .filter(l => l.match(/^\s*[-•*]?\s*\S+\.\w+/))
    .slice(0, 25)

  if (fileLines.length === 0) return true  // No plan parsed, just proceed

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

    case 'help':
    case 'h':
      console.log(`
\x1b[1mCommands:\x1b[0m
  \x1b[36m/scan\x1b[0m         Scan current project
  \x1b[36m/memory\x1b[0m       View persistent memory
  \x1b[36m/history\x1b[0m      Show recent task history
  \x1b[36m/serve\x1b[0m        Start development server
  \x1b[36m/run\x1b[0m \x1b[2m<cmd>\x1b[0m     Run a shell command
  \x1b[36m/clear\x1b[0m        Clear screen
  \x1b[36m/reset\x1b[0m        Clear chat history
  \x1b[36m/exit\x1b[0m         Exit AETHER

\x1b[1mTip:\x1b[0m Just type naturally — tasks go to the agent, questions get answered in chat.
`)
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
        spin.stop()
        console.log(`\n${result}\n`)
      } catch (err) {
        spin.fail(`Scan failed: ${err.message}`)
      }
      break
    }

    case 'memory': {
      const { Memory } = await import('../agent/memory/index.mjs')
      const mem = new Memory(workingDir)
      const ctx = await mem.getContextSummary()
      const last = await mem.getLastSession()
      console.log('\n\x1b[1mMemory\x1b[0m')
      console.log('\x1b[90m' + '─'.repeat(40) + '\x1b[0m')
      console.log(ctx ?? '\x1b[2m(no entries stored)\x1b[0m')
      if (last) {
        console.log(`\n\x1b[1mLast Session\x1b[0m`)
        console.log(`  ${String(last.objective ?? '').slice(0, 70)}`)
        console.log(`  \x1b[2m${last.steps} steps · ${last.completedAt}\x1b[0m`)
      }
      console.log('\n\x1b[2m/memory set <key> <value>  |  /memory clear\x1b[0m\n')
      break
    }

    case 'history': {
      const { Memory } = await import('../agent/memory/index.mjs')
      const mem  = new Memory(workingDir)
      const { readFile: rf } = await import('fs/promises')
      const { getWorkspaceFiles: gwf } = await import('../config/index.mjs')
      const wf = gwf(workingDir)
      try {
        const hist = JSON.parse(await rf(wf.history, 'utf8'))
        if (!hist.length) { console.log('\x1b[2m  No history yet.\x1b[0m\n'); break }
        console.log('\n\x1b[1mTask History\x1b[0m')
        console.log('\x1b[90m' + '─'.repeat(50) + '\x1b[0m')
        hist.slice(-10).reverse().forEach((h, i) => {
          const ts = h.completedAt ? new Date(h.completedAt).toLocaleString() : ''
          console.log(`  \x1b[36m${i+1}.\x1b[0m ${String(h.objective).slice(0, 60)}`)
          console.log(`     \x1b[2m${h.steps} steps · ${ts}\x1b[0m`)
        })
        console.log()
      } catch {
        console.log('\x1b[2m  No history yet.\x1b[0m\n')
      }
      break
    }

    case 'serve': {
      const serveCmd = arg || null
      const servTask = serveCmd
        ? `Start the server with command: ${serveCmd}`
        : 'Start the development server'
      await runAgentTask(servTask, workingDir, 8, verbose, projectScan, rl)
      break
    }

    case 'run': {
      if (!arg) { ui.error('Usage: /run <command>'); break }
      console.log(`\n\x1b[2m$ ${arg}\x1b[0m\n`)
      spin.start(`Running: ${arg}`)
      try {
        const { exec } = await import('child_process')
        const { promisify } = await import('util')
        const execAsync = promisify(exec)
        const { stdout, stderr } = await execAsync(arg, {
          cwd: workingDir, timeout: 60000,
          env: { ...process.env, FORCE_COLOR: '1' },
        })
        spin.stop()
        if (stdout) process.stdout.write(stdout)
        if (stderr) process.stderr.write('\x1b[33m' + stderr + '\x1b[0m')
        ui.success('Command completed.\n')
      } catch (err) {
        spin.stop()
        if (err.stdout) process.stdout.write(err.stdout)
        if (err.stderr) process.stderr.write('\x1b[31m' + err.stderr + '\x1b[0m')
        ui.error(`Failed (exit ${err.code ?? 1})`)
        const wantsFix = await askYN('  Fix with AETHER? [Y/n] ', rl)
        if (wantsFix) {
          const errOut = [
            err.stdout && `STDOUT:\n${err.stdout}`,
            err.stderr && `STDERR:\n${err.stderr}`,
          ].filter(Boolean).join('\n\n')
          await runAgentTask(
            `Fix the failing command: "${arg}"\n\nError:\n${errOut}`,
            workingDir, 12, verbose, projectScan, rl
          )
        }
      }
      break
    }

    case 'exit':
    case 'quit':
    case 'q':
      console.log('\n\x1b[36m  Goodbye ✨\x1b[0m\n')
      rl.close()
      process.exit(0)
      break

    default:
      console.log(`\x1b[2m  Unknown command: /${cmd}. Type /help for commands.\x1b[0m\n`)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function progressBar(current, total, width) {
  const pct    = Math.min(current / total, 1)
  const filled = Math.round(pct * width)
  const empty  = width - filled
  return '\x1b[32m' + '█'.repeat(filled) + '\x1b[90m' + '░'.repeat(empty) + '\x1b[0m'
}

function describeAction(toolName, params) {
  switch (toolName) {
    case 'delete_file':      return `delete file: ${params?.path}`
    case 'delete_directory': return `delete directory: ${params?.path}`
    case 'move_file':        return `move: ${params?.source} → ${params?.destination}`
    case 'rename_file':      return `rename: ${params?.path} → ${params?.newName}`
    default:                 return `${toolName}`
  }
}

function extractSummary(answer) {
  // Get first 1-2 sentences for gen mode (avoid showing code)
  const sentences = answer.replace(/```[\s\S]*?```/g, '').split(/[.!?]\s+/).filter(Boolean)
  return sentences.slice(0, 2).join('. ').slice(0, 200)
}

function printConnectionHint(err) {
  const msg = (err.message ?? '').toLowerCase()
  if (msg.includes('session') || msg.includes('fetch') || msg.includes('initialize') || msg.includes('enotfound')) {
    console.log(`
\x1b[33mConnection tips:\x1b[0m
  • Open \x1b[36mhttps://gemini.google.com\x1b[0m in your browser and sign in
  • Ensure you have internet access
  • Run \x1b[36maether doctor\x1b[0m for diagnostics
`)
  }
}

async function askYN(question, rl) {
  return new Promise(resolve => {
    rl.question(question, ans => {
      resolve(ans.trim().toLowerCase() !== 'n')
    })
  })
}
