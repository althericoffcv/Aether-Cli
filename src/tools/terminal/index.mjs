import { exec } from 'child_process'
import { promisify } from 'util'
import { resolve } from 'path'

const execAsync = promisify(exec)

export const terminalTools = [

  {
    name: 'execute_command',
    description: [
      'Execute a shell command and return STDOUT + STDERR.',
      'Use for: npm/pnpm/yarn, git, node scripts, bash, python, etc.',
      'If the command fails, the error output is returned so you can analyze and fix it.',
      'Working directory defaults to the project root.',
    ].join(' '),
    parameters: {
      command: { type: 'string',  required: true,  description: 'The full shell command to run' },
      cwd:     { type: 'string',  required: false, description: 'Override working directory (default: project root)' },
      timeout: { type: 'number',  required: false, description: 'Timeout in milliseconds (default: 60000)' },
    },
    async execute({ command, cwd, timeout = 60000 }, workingDir) {
      const execCwd = cwd ? resolve(workingDir, cwd) : workingDir

      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd:       execCwd,
          timeout,
          maxBuffer: 1024 * 1024 * 20,   // 20 MB
          env:       { ...process.env, FORCE_COLOR: '0' },
          shell:     true,
        })

        const parts = []
        if (stdout?.trim()) parts.push(`STDOUT:\n${stdout.trim()}`)
        if (stderr?.trim()) parts.push(`STDERR:\n${stderr.trim()}`)
        return parts.join('\n\n') || '(Command exited with code 0 — no output)'

      } catch (err) {
        const parts = [`EXIT CODE: ${err.code ?? 'unknown'}`]
        if (err.stdout?.trim()) parts.push(`STDOUT:\n${err.stdout.trim()}`)
        if (err.stderr?.trim()) parts.push(`STDERR:\n${err.stderr.trim()}`)
        if (!err.stdout && !err.stderr) parts.push(`ERROR: ${err.message}`)
        return `COMMAND FAILED:\n${parts.join('\n\n')}`
      }
    }
  },

]
