import { exec }      from 'child_process'
import { promisify } from 'util'
import readline      from 'readline'
import { AetherAgent } from '../agent/index.mjs'
import { ui, spin }    from './ui.mjs'

const execAsync = promisify(exec)

export async function runCommand(cmdArgs, options = {}) {
  if (!cmdArgs?.trim()) {
    ui.error('Usage: aether run <command>')
    console.log('\x1b[2mExample: aether run npm test\x1b[0m\n')
    process.exit(1)
  }

  const workingDir = options.workingDir ?? process.cwd()
  const verbose    = options.verbose    ?? false

  console.log(`\n\x1b[2m$ ${cmdArgs}\x1b[0m\n`)
  spin.start(`Running: ${cmdArgs}`)

  let stdout = '', stderr = '', exitCode = 0, failed = false

  try {
    const res = await execAsync(cmdArgs, {
      cwd:       workingDir,
      timeout:   120_000,
      maxBuffer: 1024 * 1024 * 20,
      shell:     true,
      env:       { ...process.env, FORCE_COLOR: '1' },
    })
    stdout = res.stdout ?? ''
    stderr = res.stderr ?? ''
    spin.stop()

    if (stdout) process.stdout.write(stdout)
    if (stderr) process.stderr.write('\x1b[33m' + stderr + '\x1b[0m')
    ui.success('Command completed successfully.\n')

  } catch (err) {
    stdout   = err.stdout ?? ''
    stderr   = err.stderr ?? ''
    exitCode = err.code   ?? 1
    failed   = true
    spin.stop()

    if (stdout) process.stdout.write(stdout)
    if (stderr) process.stderr.write('\x1b[31m' + stderr + '\x1b[0m')
    console.log()
    ui.error(`Command failed (exit code ${exitCode})\n`)
  }

  // ── Offer AI recovery if command failed ────────────────────────────────────
  if (failed) {
    const errorOutput = [
      stdout.trim() && `STDOUT:\n${stdout.trim()}`,
      stderr.trim() && `STDERR:\n${stderr.trim()}`,
      !stdout.trim() && !stderr.trim() && `Exit code ${exitCode}`,
    ].filter(Boolean).join('\n\n')

    const wantsFix = await askYN('🤖 Want AETHER to analyze and fix this error? [Y/n] ')

    if (wantsFix) {
      console.log()
      ui.section('AI Error Recovery')

      const startTime = Date.now()

      const agent = new AetherAgent({
        workingDir,
        maxIterations: 12,
        verbose,

        onStatus:      t   => ui.status(t),
        onIteration:   (i,max) => { spin.stop(); console.log(`\n\x1b[90m─── Recovery step ${i}/${max} ───\x1b[0m`) },
        onThought:     t   => ui.thought(t),
        onAction:      (tool, params) => { ui.action(tool, params); spin.start(`Executing…`) },
        onObservation: obs => { spin.stop(); ui.observation(obs) },
        onFinalAnswer: ans => { spin.stop(); ui.finalAnswer(ans) },
        onError:       msg => { spin.stop(); ui.warn(msg) },
      })

      try {
        const objective = [
          `The following command failed:\n\`${cmdArgs}\`\n`,
          `Error output:\n${errorOutput}\n`,
          `Analyze the root cause, fix the underlying issue(s), then re-run the command to confirm it passes.`,
        ].join('\n')

        const result = await agent.run(objective)
        spin.stop()

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        console.log(`\x1b[2mRecovery: ${result.iterations} steps · ${elapsed}s\x1b[0m\n`)

        if (!result.success) {
          ui.warn('Recovery did not fully complete. Try: aether code "fix the failing command: ' + cmdArgs + '"')
        }

      } catch (agentErr) {
        spin.stop()
        ui.error(`Recovery failed: ${agentErr.message}`)
        if (verbose) console.error(agentErr)
      }
    }
  }
}

async function askYN(question) {
  if (!process.stdin.isTTY) return false
  const rl  = readline.createInterface({ input: process.stdin, output: process.stdout })
  const ans = await new Promise(resolve => rl.question(question, resolve))
  rl.close()
  return ans.trim().toLowerCase() !== 'n'
}
