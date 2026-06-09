# ⚡ AETHER CLI

> Autonomous AI coding agent — powered by Gemini, no API key required.

AETHER is a fully autonomous coding agent for the terminal. It understands your project, plans tasks, calls tools, writes/edits code, runs commands, fixes errors, and manages git — all by itself.

---

## Requirements

- **Node.js 22+**
- Internet access (requires reaching `gemini.google.com`)
- A Google account (sign in to Gemini once in your browser)

---

## Installation

```bash
# 1. Clone / copy this project
git clone <repo-url>
cd aether-cli

# 2. Install dependencies (none required — pure Node.js)
npm install

# 3. Link globally so "aether" works anywhere
npm link
```

### Termux (Android)

```bash
pkg install nodejs git
# Then follow the same steps above
```

---

## Commands

| Command | Description |
|---|---|
| `aether` | Show help |
| `aether chat` | Interactive chat with AETHER |
| `aether code [task]` | **Autonomous coding agent** |
| `aether run <cmd>` | Run a command + AI error recovery |
| `aether doctor` | System & project diagnostics |
| `aether memory` | View/manage persistent memory |
| `aether update` | Show update instructions |

### Flags

| Flag | Description |
|---|---|
| `--max N` | Set max iterations for `aether code` (default: 25) |
| `--verbose` | Show debug output |
| `--version` | Show version |

---

## Usage Examples

### Autonomous coding

```bash
# Feature implementation
aether code "add input validation to all Express routes"

# Refactoring
aether code "convert all callbacks to async/await in src/"

# New project
aether code "create a REST API with Express, MongoDB, and JWT auth"

# Bug fixing
aether code "fix all TypeScript errors in the project"

# Testing
aether code "write unit tests for all functions in utils.js"

# Documentation
aether code "add JSDoc comments to all exported functions"

# Git workflow
aether code "commit all changes with a descriptive message and push"
```

### Chat mode

```bash
aether chat
# Then type anything:
# You: explain how async/await works in JavaScript
# You: what's the difference between null and undefined?
# You: /scan    — scan current project
# You: /memory  — show memory
# You: /clear   — clear chat history
# You: /exit    — quit
```

### Run with AI recovery

```bash
aether run npm test
# If it fails → AETHER analyzes the error and fixes it automatically
```

---

## How It Works

AETHER uses a **ReAct (Reason + Act)** loop:

```
┌─────────────────────────────────────────────┐
│  Observe  → read project context & history  │
│  Think    → reason about next action        │
│  Act      → call a tool                     │
│  Reflect  → analyze the result              │
│  Repeat   → until objective is complete     │
└─────────────────────────────────────────────┘
```

### Tool Set

| Category | Tools |
|---|---|
| **Files** | `read_file`, `write_file`, `edit_file`, `delete_file`, `move_file`, `copy_file` |
| **Search** | `list_directory`, `search_files` |
| **Terminal** | `execute_command` |
| **Git** | `git_status`, `git_add`, `git_commit`, `git_push`, `git_pull`, `git_clone` |
| **Project** | `project_scan` |
| **Memory** | `memory_read`, `memory_write` |

---

## Project Structure

```
aether-cli/
├── bin/
│   └── aether.js              CLI entry point
├── src/
│   ├── providers/
│   │   └── gemini.mjs         Gemini AI brain (no API key)
│   ├── agent/
│   │   ├── index.mjs          Main autonomous agent loop
│   │   ├── prompts.mjs        Prompt engineering
│   │   ├── parser.mjs         Response parser (multi-format)
│   │   ├── planner/           Task planner
│   │   ├── executor/          Tool executor
│   │   ├── memory/            Persistent memory system
│   │   └── reflection/        Self-reflection & learning
│   ├── tools/
│   │   ├── index.mjs          Tool registry
│   │   ├── filesystem/        File operations
│   │   ├── terminal/          Command execution
│   │   └── git/               Git operations
│   ├── scanner/               Project scanner
│   ├── cli/
│   │   ├── index.mjs          CLI router
│   │   ├── ui.mjs             Terminal UI (ANSI, spinner)
│   │   ├── chat.mjs           Chat command
│   │   ├── code.mjs           Code agent command
│   │   ├── run.mjs            Run command
│   │   └── doctor.mjs         Doctor command
│   └── config/
│       └── index.mjs          Config & paths
└── package.json
```

---

## Memory System

AETHER persists knowledge between sessions in `~/.aether/memory.json`.

```bash
# View all memories
aether memory

# Save a memory manually
aether memory set "project_db" "PostgreSQL on localhost:5432"

# Delete a memory
aether memory delete "project_db"

# Clear all memories
aether memory clear
```

The agent can also read/write memory autonomously using `memory_read` / `memory_write` tools.

---

## Troubleshooting

### "Gagal ekstrak bl/sid" error

AETHER connects to Gemini by scraping the web interface.

1. Open **https://gemini.google.com** in your browser
2. Sign in with your Google account
3. Wait for the page to fully load
4. Run `aether` again

### Slow responses

Gemini's web interface enforces a ~3 second delay between requests. This is normal.

### On Termux

```bash
# If you get permission errors on npm link:
npm install -g .
# or add ~/.npm-global/bin to your PATH
```

---

## Configuration

Config is stored in `~/.aether/config.json`.

| Key | Default | Description |
|---|---|---|
| `maxIterations` | `25` | Max steps per coding session |
| `verbose` | `false` | Debug output |

---

## License

MIT
