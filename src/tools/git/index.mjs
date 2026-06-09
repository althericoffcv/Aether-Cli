import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { join } from 'path'

const execAsync = promisify(exec)

async function git(args, cwd, opts = {}) {
  try {
    const { stdout, stderr } = await execAsync(`git ${args}`, {
      cwd,
      timeout: opts.timeout ?? 30000,
      maxBuffer: 1024 * 1024 * 5,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
    return { ok: true, out: (stdout + stderr).trim() || '(no output)' }
  } catch (err) {
    return { ok: false, out: (err.stderr || err.stdout || err.message).trim() }
  }
}

function requireGit(cwd) {
  if (!existsSync(join(cwd, '.git'))) {
    throw new Error('Not a git repository. Run "git init" or use git_clone first.')
  }
}

export const gitTools = [

  {
    name: 'git_status',
    description: 'Show working tree status, current branch, and recent commits.',
    parameters: {},
    async execute({}, cwd) {
      requireGit(cwd)
      const [status, branch, log, remotes] = await Promise.all([
        git('status',                cwd),
        git('branch --show-current', cwd),
        git('log --oneline -8',      cwd),
        git('remote -v',             cwd),
      ])
      return [
        '=== STATUS ===',   status.out,
        '\n=== BRANCH ===',  branch.out,
        '\n=== RECENT COMMITS ===', log.out || '(no commits yet)',
        '\n=== REMOTES ===',  remotes.out || '(no remotes)',
      ].join('\n')
    }
  },

  {
    name: 'git_add',
    description: 'Stage files for commit. Use "." to stage all changes.',
    parameters: {
      files: { type: 'string', required: true, description: 'Files to stage. Use "." for everything.' },
    },
    async execute({ files }, cwd) {
      requireGit(cwd)
      const add    = await git(`add ${files}`, cwd)
      const status = await git('status --short', cwd)
      return `git add ${files}\n${add.out}\n\nStaged:\n${status.out || '(nothing staged)'}`
    }
  },

  {
    name: 'git_commit',
    description: 'Commit staged changes with a message.',
    parameters: {
      message: { type: 'string', required: true, description: 'Commit message' },
    },
    async execute({ message }, cwd) {
      requireGit(cwd)
      const msg    = message.replace(/"/g, '\\"').replace(/`/g, '\\`')
      const result = await git(`commit -m "${msg}"`, cwd)
      return result.ok
        ? `✓ Committed: "${message}"\n${result.out}`
        : `Commit failed:\n${result.out}`
    }
  },

  {
    name: 'git_push',
    description: 'Push commits to a remote repository.',
    parameters: {
      remote: { type: 'string', required: false, description: 'Remote name (default: origin)' },
      branch: { type: 'string', required: false, description: 'Branch name (default: current branch)' },
    },
    async execute({ remote = 'origin', branch = '' }, cwd) {
      requireGit(cwd)
      const args   = branch ? `push ${remote} ${branch}` : `push ${remote}`
      const result = await git(args, cwd, { timeout: 60000 })
      return result.ok
        ? `✓ Pushed to ${remote}\n${result.out}`
        : `Push failed:\n${result.out}`
    }
  },

  {
    name: 'git_pull',
    description: 'Pull latest changes from a remote repository.',
    parameters: {
      remote: { type: 'string', required: false, description: 'Remote name (default: origin)' },
      branch: { type: 'string', required: false, description: 'Branch name (default: current branch)' },
    },
    async execute({ remote = 'origin', branch = '' }, cwd) {
      requireGit(cwd)
      const args   = branch ? `pull ${remote} ${branch}` : `pull ${remote}`
      const result = await git(args, cwd, { timeout: 60000 })
      return result.ok
        ? `✓ Pulled from ${remote}\n${result.out}`
        : `Pull failed:\n${result.out}`
    }
  },

  {
    name: 'git_clone',
    description: 'Clone a remote repository into the current directory.',
    parameters: {
      url:       { type: 'string', required: true,  description: 'Repository URL' },
      directory: { type: 'string', required: false, description: 'Local directory name (optional)' },
    },
    async execute({ url, directory = '' }, cwd) {
      const args   = directory ? `clone ${url} ${directory}` : `clone ${url}`
      const result = await git(args, cwd, { timeout: 120000 })
      return result.ok
        ? `✓ Cloned ${url}${directory ? ` into ${directory}` : ''}\n${result.out}`
        : `Clone failed:\n${result.out}`
    }
  },

]
