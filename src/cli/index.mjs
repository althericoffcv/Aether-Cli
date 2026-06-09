import { runChat }        from './chat.mjs'
import { runCode }        from './code.mjs'
import { runCommand }     from './run.mjs'
import { runDoctor }      from './doctor.mjs'
import { runInteractive } from './interactive.mjs'
import { ui }             from './ui.mjs'
import { loadConfig }     from '../config/index.mjs'

const VERSION = '2.0.0'

// ─── Entry point ──────────────────────────────────────────────────────────────
export async function main() {
  const argv = process.argv.slice(2)

  // ── Global flags ─────────────────────────────────────────────────────────────
  if (hasFlag(argv, '--version', '-v')) {
    console.log(`AETHER v${VERSION}`)
    return
  }

  const verbose = hasFlag(argv, '--verbose', '--debug')
  if (verbose) process.env.AETHER_DEBUG = '1'

  // Help flag (explicit)
  if (hasFlag(argv, '--help', '-h')) {
    ui.banner()
    ui.help()
    return
  }

  // Strip known flags so sub-command parsers see clean args
  const args = argv.filter(a => !a.startsWith('--') && a !== '-v')
  const command = args[0]

  const config     = await loadConfig()
  const workingDir = process.cwd()

  // ── No command → Unified interactive mode ────────────────────────────────────
  if (!command) {
    await runInteractive({ workingDir, config, verbose })
    return
  }

  // ── Named commands ────────────────────────────────────────────────────────────
  switch (command) {

    // ── aether chat [still works as alias] ────────────────────────────────────
    case 'chat':
      await runInteractive({ workingDir, config, verbose })
      break

    // ── aether code [task] [still works as alias] ──────────────────────────────
    case 'code': {
      const rawTask       = args.slice(1).join(' ').trim()
      const task          = stripQuotes(rawTask)
      const maxIterations = flagValue(argv, '--max') ?? config.maxIterations ?? 25
      if (task) {
        // Direct task passed: run non-interactively
        await runCode(task, { workingDir, maxIterations, verbose, config })
      } else {
        // No task: enter interactive mode
        await runInteractive({ workingDir, config, verbose })
      }
      break
    }

    // ── aether <task string> — inline task without a subcommand ───────────────
    // e.g.: aether "fix all TypeScript errors"
    case (command.match(/^[^a-z]/) ? command : null): // special chars
    // Fallthrough: if first arg looks like a task sentence, run it
    default: {
      // Does the "command" look like a task sentence rather than a sub-command?
      const looksLikeInlineTask =
        command.length > 10 ||           // longer than any subcommand
        command.includes(' ') ||          // has spaces (quoted task)
        /[A-Z]/.test(command[0]) ||       // starts with capital
        /["']/.test(command[0])           // starts with quote

      if (looksLikeInlineTask) {
        // Everything is the task
        const task = stripQuotes(args.join(' ').trim())
        const maxIterations = flagValue(argv, '--max') ?? config.maxIterations ?? 25
        await runInteractive({ workingDir, config, verbose, directTask: task })
        return
      }

      // Check for remaining real sub-commands
      switch (command) {

        case 'run': {
          const cmdArgs = args.slice(1).join(' ').trim()
          await runCommand(cmdArgs, { workingDir, verbose, config })
          break
        }

        case 'doctor':
        case 'check':
          await runDoctor({ workingDir, config })
          break

        case 'memory':
          await runMemory(args.slice(1), workingDir)
          break

        case 'update':
          await runUpdate()
          break

        case 'help':
          ui.banner()
          ui.help()
          break

        default:
          // Unknown command: treat as inline task
          const inlineTask = stripQuotes(args.join(' ').trim())
          const maxIter    = flagValue(argv, '--max') ?? config.maxIterations ?? 25
          await runInteractive({ workingDir, config, verbose, directTask: inlineTask })
      }
    }
  }
}

// ─── Memory command ────────────────────────────────────────────────────────────
async function runMemory(args, workingDir = process.cwd()) {
  const { Memory } = await import('../agent/memory/index.mjs')
  const mem = new Memory(workingDir)
  const sub = args[0]

  switch (sub) {
    case 'clear': {
      await mem.clear()
      console.log('\x1b[32m✓\x1b[0m Memory cleared.\n')
      break
    }
    case 'delete': {
      const key = args[1]
      if (!key) { console.log('\x1b[31mUsage: aether memory delete <key>\x1b[0m\n'); break }
      const result = await mem.delete(key)
      console.log(`\x1b[32m✓\x1b[0m ${result}\n`)
      break
    }
    case 'set': {
      const key   = args[1]
      const value = args.slice(2).join(' ')
      if (!key || !value) {
        console.log('\x1b[31mUsage: aether memory set <key> <value>\x1b[0m\n')
        break
      }
      const result = await mem.write(key, value)
      console.log(`\x1b[32m✓\x1b[0m ${result}\n`)
      break
    }
    default: {
      const ctx     = await mem.getContextSummary()
      const session = await mem.getLastSession()
      console.log('\n\x1b[1mPersistent Memory\x1b[0m')
      console.log('\x1b[90m' + '─'.repeat(42) + '\x1b[0m')
      console.log(ctx ?? '\x1b[2m(no entries stored)\x1b[0m')
      if (session) {
        console.log('\n\x1b[1mLast Session\x1b[0m')
        console.log(`  Objective : ${String(session.objective ?? '').slice(0, 72)}`)
        console.log(`  Steps     : ${session.steps}`)
        console.log(`  Completed : ${session.completedAt}`)
      }
      console.log('\n\x1b[2mCommands: aether memory set <key> <value>  |  aether memory delete <key>  |  aether memory clear\x1b[0m\n')
    }
  }
}

// ─── Update command ────────────────────────────────────────────────────────────
async function runUpdate() {
  ui.banner()
  console.log('\x1b[1mUpdate AETHER\x1b[0m\n')
  console.log(`Current: \x1b[36mv${VERSION}\x1b[0m\n`)

  try {
    const { exec }      = await import('child_process')
    const { promisify } = await import('util')
    const execAsync     = promisify(exec)
    const { stdout }    = await execAsync('git log --oneline -3 2>/dev/null || echo ""', {
      cwd: new URL('../../', import.meta.url).pathname
    }).catch(() => ({ stdout: '' }))
    if (stdout.trim()) {
      console.log('\x1b[2mRecent commits:\x1b[0m')
      stdout.trim().split('\n').forEach(l => console.log(`  ${l}`))
      console.log()
    }
  } catch {}

  console.log('\x1b[1mTo update:\x1b[0m')
  console.log('  \x1b[36mgit pull\x1b[0m             pull latest changes')
  console.log('  \x1b[36mnpm install\x1b[0m          install dependencies')
  console.log('  \x1b[36mnpm link\x1b[0m             re-link globally (if needed)')
  console.log()
}

// ─── Argument helpers ──────────────────────────────────────────────────────────
function hasFlag(argv, ...flags) {
  return flags.some(f => argv.includes(f))
}

function flagValue(argv, flag) {
  const idx = argv.indexOf(flag)
  if (idx !== -1 && argv[idx + 1]) {
    const n = parseInt(argv[idx + 1])
    return isNaN(n) ? null : n
  }
  return null
}

function stripQuotes(str) {
  return str.replace(/^['"` ]|['"` ]$/g, '').trim()
}
