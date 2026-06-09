import {
  readFile, writeFile, unlink, rename, copyFile,
  readdir, mkdir, stat, rm
} from 'fs/promises'
import { existsSync } from 'fs'
import { join, resolve, relative, dirname, basename } from 'path'

// ─── Tool definitions ─────────────────────────────────────────────────────────
export const filesystemTools = [

  {
    name: 'read_file',
    description: 'Read the full contents of a file. Returns content with line count.',
    parameters: {
      path:      { type: 'string', required: true,  description: 'Relative or absolute path to the file' },
      max_lines: { type: 'number', required: false, description: 'Max lines to return (default: all)' },
    },
    async execute({ path, max_lines }, cwd) {
      const full = resolve(cwd, path)
      if (!existsSync(full)) throw new Error(`File not found: ${path}`)
      const content = await readFile(full, 'utf8')
      const lines   = content.split('\n')
      const total   = lines.length
      const shown   = max_lines ? lines.slice(0, max_lines) : lines
      const note    = max_lines && total > max_lines
        ? `\n[... ${total - max_lines} more lines not shown ...]`
        : ''
      return `FILE: ${path}\nLINES: ${total}\nSIZE: ${content.length} chars\n\n${shown.join('\n')}${note}`
    }
  },

  {
    name: 'write_file',
    description: 'Write content to a file. Creates the file and any missing directories. Overwrites if exists.',
    parameters: {
      path:    { type: 'string', required: true, description: 'Path to the file' },
      content: { type: 'string', required: true, description: 'Full content to write' },
    },
    async execute({ path, content }, cwd) {
      const full = resolve(cwd, path)
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, content, 'utf8')
      const lines = content.split('\n').length
      return `✓ Written ${content.length} chars (${lines} lines) → ${path}`
    }
  },

  {
    name: 'edit_file',
    description: 'Edit a file by finding and replacing exact text. Use read_file first to get exact content.',
    parameters: {
      path:        { type: 'string', required: true, description: 'Path to the file' },
      old_content: { type: 'string', required: true, description: 'Exact text to find and replace' },
      new_content: { type: 'string', required: true, description: 'Replacement text' },
    },
    async execute({ path, old_content, new_content }, cwd) {
      const full = resolve(cwd, path)
      if (!existsSync(full)) throw new Error(`File not found: ${path}`)
      const current = await readFile(full, 'utf8')
      if (!current.includes(old_content)) {
        const preview = old_content.slice(0, 80).replace(/\n/g, '\\n')
        throw new Error(`Text not found in ${path}.\nSearched for: "${preview}"\nUse read_file to check exact content.`)
      }
      const updated = current.replaceAll(old_content, new_content)
      await writeFile(full, updated, 'utf8')
      const count = (current.match(new RegExp(escapeRegex(old_content), 'g')) || []).length
      return `✓ Edited ${path}: replaced ${count} occurrence(s)`
    }
  },

  {
    name: 'append_file',
    description: 'Append content to the end of a file. Creates the file if it does not exist.',
    parameters: {
      path:    { type: 'string', required: true, description: 'Path to the file' },
      content: { type: 'string', required: true, description: 'Content to append' },
    },
    async execute({ path, content }, cwd) {
      const full = resolve(cwd, path)
      await mkdir(dirname(full), { recursive: true })
      const existing = existsSync(full) ? await readFile(full, 'utf8') : ''
      await writeFile(full, existing + content, 'utf8')
      return `✓ Appended ${content.length} chars to ${path}`
    }
  },

  {
    name: 'delete_file',
    description: 'Delete a file permanently.',
    parameters: {
      path: { type: 'string', required: true, description: 'Path to the file to delete' },
    },
    async execute({ path }, cwd) {
      const full = resolve(cwd, path)
      if (!existsSync(full)) throw new Error(`File not found: ${path}`)
      await unlink(full)
      return `✓ Deleted file: ${path}`
    }
  },

  {
    name: 'move_file',
    description: 'Move or rename a file or directory.',
    parameters: {
      source:      { type: 'string', required: true, description: 'Source path' },
      destination: { type: 'string', required: true, description: 'Destination path' },
    },
    async execute({ source, destination }, cwd) {
      const src = resolve(cwd, source)
      const dst = resolve(cwd, destination)
      if (!existsSync(src)) throw new Error(`Source not found: ${source}`)
      await mkdir(dirname(dst), { recursive: true })
      await rename(src, dst)
      return `✓ Moved: ${source} → ${destination}`
    }
  },

  {
    name: 'copy_file',
    description: 'Copy a file to a new location.',
    parameters: {
      source:      { type: 'string', required: true, description: 'Source path' },
      destination: { type: 'string', required: true, description: 'Destination path' },
    },
    async execute({ source, destination }, cwd) {
      const src = resolve(cwd, source)
      const dst = resolve(cwd, destination)
      if (!existsSync(src)) throw new Error(`Source not found: ${source}`)
      await mkdir(dirname(dst), { recursive: true })
      await copyFile(src, dst)
      return `✓ Copied: ${source} → ${destination}`
    }
  },

  {
    name: 'rename_file',
    description: 'Rename a file or folder within the same directory.',
    parameters: {
      path:    { type: 'string', required: true, description: 'Path to the file or folder to rename' },
      newName: { type: 'string', required: true, description: 'New name (just the filename, not a full path)' },
    },
    async execute({ path, newName }, cwd) {
      const full    = resolve(cwd, path)
      if (!existsSync(full)) throw new Error(`Not found: ${path}`)
      const newPath = join(dirname(full), newName)
      await rename(full, newPath)
      return `✓ Renamed: ${basename(path)} → ${newName}`
    }
  },

  {
    name: 'create_directory',
    description: 'Create a new directory (including nested paths).',
    parameters: {
      path: { type: 'string', required: true, description: 'Directory path to create' },
    },
    async execute({ path }, cwd) {
      const full = resolve(cwd, path)
      await mkdir(full, { recursive: true })
      return `✓ Directory created: ${path}`
    }
  },

  {
    name: 'delete_directory',
    description: 'Delete a directory and all its contents recursively.',
    parameters: {
      path:  { type: 'string', required: true,  description: 'Directory to delete' },
      force: { type: 'boolean', required: false, description: 'Skip confirmation check (default: false)' },
    },
    async execute({ path, force = false }, cwd) {
      const full = resolve(cwd, path)
      if (!existsSync(full)) throw new Error(`Directory not found: ${path}`)

      // Safety: never delete root-level dirs
      const relPath = relative(cwd, full)
      if (relPath === '' || relPath === '.' || relPath.startsWith('..')) {
        throw new Error(`Safety: cannot delete root or parent directory`)
      }

      await rm(full, { recursive: true, force: true })
      return `✓ Deleted directory: ${path}`
    }
  },

  {
    name: 'list_directory',
    description: 'List files and subdirectories. Shows file sizes. Auto-skips node_modules, .git, dist.',
    parameters: {
      path:      { type: 'string',  required: false, description: 'Directory path (default: ".")' },
      recursive: { type: 'boolean', required: false, description: 'Recurse into subdirectories (default: false)' },
    },
    async execute({ path = '.', recursive = false }, cwd) {
      const full = resolve(cwd, path)
      if (!existsSync(full)) throw new Error(`Directory not found: ${path}`)

      const SKIP = new Set(['.git','node_modules','.next','dist','build','.cache','__pycache__','.venv','venv','.turbo'])

      const walk = async (dir, depth, maxDepth) => {
        if (depth > maxDepth) return []
        let entries
        try { entries = await readdir(dir, { withFileTypes: true }) }
        catch { return [] }

        const pad = '  '.repeat(depth)
        const lines = []
        for (const e of entries) {
          if (SKIP.has(e.name)) {
            if (e.isDirectory()) lines.push(`${pad}\x1b[90m📁 ${e.name}/ [skipped]\x1b[0m`)
            continue
          }
          const abs = join(dir, e.name)
          if (e.isDirectory()) {
            lines.push(`${pad}📁 ${e.name}/`)
            if (recursive || depth < 1) {
              lines.push(...await walk(abs, depth + 1, recursive ? 4 : 2))
            }
          } else {
            try {
              const s = await stat(abs)
              lines.push(`${pad}📄 ${e.name}  \x1b[2m${fmtSize(s.size)}\x1b[0m`)
            } catch {
              lines.push(`${pad}📄 ${e.name}`)
            }
          }
        }
        return lines
      }

      const lines = await walk(full, 0, recursive ? 4 : 2)
      return `Directory: ${path}\n\n${lines.join('\n')}\n\n${lines.length} items`
    }
  },

  {
    name: 'search_files',
    description: 'Search for text inside files, or find files by name pattern.',
    parameters: {
      pattern:        { type: 'string',  required: true,  description: 'Search pattern (text or filename glob)' },
      search_content: { type: 'boolean', required: false, description: 'true=search inside files, false=search filenames (default: false)' },
      path:           { type: 'string',  required: false, description: 'Root directory to search from (default: ".")' },
      case_sensitive: { type: 'boolean', required: false, description: 'Case-sensitive search (default: false)' },
    },
    async execute({ pattern, search_content = false, path = '.', case_sensitive = false }, cwd) {
      const root = resolve(cwd, path)
      const SKIP = new Set(['.git','node_modules','.next','dist','build','.cache','__pycache__'])
      const results = []
      const pat     = case_sensitive ? pattern : pattern.toLowerCase()

      const walk = async (dir) => {
        let entries
        try { entries = await readdir(dir, { withFileTypes: true }) }
        catch { return }

        for (const e of entries) {
          if (SKIP.has(e.name)) continue
          const abs = join(dir, e.name)
          const rel = relative(root, abs)

          if (e.isDirectory()) {
            await walk(abs)
          } else {
            if (search_content) {
              try {
                const text  = await readFile(abs, 'utf8')
                const lines = text.split('\n')
                lines.forEach((line, i) => {
                  const hay = case_sensitive ? line : line.toLowerCase()
                  if (hay.includes(pat)) {
                    results.push(`\x1b[36m${rel}\x1b[0m:\x1b[33m${i+1}\x1b[0m: ${line.trim()}`)
                  }
                })
              } catch { /* binary */ }
            } else {
              const hay = case_sensitive ? e.name : e.name.toLowerCase()
              if (hay.includes(pat) || globMatch(e.name, pattern)) {
                results.push(rel)
              }
            }
          }
        }
      }

      await walk(root)

      if (results.length === 0) return `No matches found for "${pattern}"`
      const shown  = results.slice(0, 60)
      const extra  = results.length - shown.length
      const suffix = extra > 0 ? `\n\x1b[2m...and ${extra} more results\x1b[0m` : ''
      return `Found ${results.length} match(es) for "${pattern}":\n\n${shown.join('\n')}${suffix}`
    }
  },

]

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtSize(b) {
  if (b < 1024)        return `${b}B`
  if (b < 1024 * 1024) return `${(b/1024).toFixed(1)}KB`
  return `${(b/1024/1024).toFixed(1)}MB`
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function globMatch(name, pattern) {
  try {
    const rx = '^' + pattern.replace(/\./g,'\\.')
      .replace(/\*/g,'.*').replace(/\?/g,'.') + '$'
    return new RegExp(rx, 'i').test(name)
  } catch { return false }
}
