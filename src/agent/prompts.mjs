import registry from '../tools/index.mjs'

// ─── Agent loop prompt ────────────────────────────────────────────────────────
export function buildAgentPrompt({
  objective,
  projectContext,
  history,
  iteration,
  maxIterations,
  memoryContext,
  reflectionSummary,
}) {
  const toolsSchema    = registry.schema()
  const recentHistory  = (history ?? []).slice(-12)
  const sections       = []

  sections.push(`\
You are AETHER, an expert autonomous software engineering agent.
Your job: complete the given objective by calling tools one step at a time.
You are methodical, precise, and always verify your work.
You write production-quality code — clean, correct, and complete.`)

  // ── Tools ──────────────────────────────────────────────────────────────────
  sections.push(`\
━━━ AVAILABLE TOOLS ━━━
${toolsSchema}`)

  // ── Response format ────────────────────────────────────────────────────────
  sections.push(`\
━━━ RESPONSE FORMAT (follow EXACTLY) ━━━

To use a tool:
<THOUGHT>
One or two sentences of reasoning. Do NOT include source code in THOUGHT.
</THOUGHT>
<ACTION>tool_name</ACTION>
<PARAMS>
{
  "param1": "value1",
  "param2": "value2"
}
</PARAMS>

When the ENTIRE task is fully complete:
<THOUGHT>
The objective is done.
</THOUGHT>
<FINAL_ANSWER>
A concise summary of what was accomplished. Do NOT include full source code here.
List the key files created/modified and what the user should do next (e.g. run npm install).
</FINAL_ANSWER>

CRITICAL RULES:
1. ONE tool call per response — never multiple.
2. PARAMS must be valid JSON with double-quoted keys and string values.
3. Always read_file BEFORE edit_file — never edit blindly.
4. After execute_command, check OBSERVATION for errors and fix if needed.
5. Use list_directory or project_scan to understand the structure first.
6. When the objective is 100% done, respond with FINAL_ANSWER.
7. FINAL_ANSWER must NOT contain source code — just a description of what was done.
8. Do NOT output anything outside the XML tags.`)

  // ── Context (only if non-empty) ───────────────────────────────────────────
  if (projectContext?.trim()) {
    sections.push(`━━━ PROJECT CONTEXT ━━━\n${projectContext}`)
  }

  if (memoryContext?.trim()) {
    sections.push(`━━━ MEMORY ━━━\n${memoryContext}`)
  }

  if (recentHistory.length > 0) {
    sections.push(`━━━ EXECUTION HISTORY (last ${recentHistory.length} steps) ━━━\n${formatHistory(recentHistory)}`)
  }

  if (reflectionSummary?.trim()) {
    sections.push(`━━━ SELF-REFLECTION ━━━\n${reflectionSummary}`)
  }

  // ── Objective ──────────────────────────────────────────────────────────────
  const nearingLimit = iteration >= (maxIterations ?? 25) - 3
  sections.push(`\
━━━ OBJECTIVE ━━━
${objective}

━━━ ITERATION ━━━
Step ${iteration} of ${maxIterations ?? 25}
${nearingLimit ? '\n⚠ NEARING LIMIT — if the task is substantially done, issue FINAL_ANSWER now.' : ''}

What is your next action?`)

  return sections.join('\n\n')
}

// ─── Chat prompt ──────────────────────────────────────────────────────────────
export function buildChatPrompt({ message, history, memoryContext }) {
  const historyText = (history ?? [])
    .slice(-16)
    .map(h => `${h.role === 'user' ? 'User' : 'AETHER'}: ${h.content}`)
    .join('\n')

  return `\
You are AETHER, an expert AI coding assistant and development partner.
You are concise, helpful, and accurate about software development, architecture, and debugging.
You explain clearly, give working code examples when asked, and acknowledge uncertainty honestly.
You speak in the same language as the user (English or Indonesian).
${memoryContext ? `\nYour persistent memory:\n${memoryContext}\n` : ''}
${historyText ? `Conversation so far:\n${historyText}\n` : ''}
User: ${message}

AETHER:`
}

// ─── Error recovery prompt ────────────────────────────────────────────────────
export function buildRecoveryPrompt({ command, errorOutput, projectContext }) {
  return `\
You are AETHER, an expert software engineer fixing a failing command.

Failed command: ${command}

Error output:
${errorOutput}

${projectContext ? `Project context:\n${projectContext}\n` : ''}
━━━ RESPONSE FORMAT ━━━

<THOUGHT>reasoning</THOUGHT>
<ACTION>tool_name</ACTION>
<PARAMS>{"key": "value"}</PARAMS>

When fixed:
<FINAL_ANSWER>Root cause and fix applied. How to verify.</FINAL_ANSWER>

Analyze the error → find root cause → apply fix → re-run to verify.
What is your first action?`
}

// ─── Format history for prompt ────────────────────────────────────────────────
function formatHistory(history) {
  return history.map((entry, i) => {
    const lines = [`[Step ${i + 1}]`]

    if (entry.thought) lines.push(`THOUGHT: ${entry.thought.slice(0, 300)}`)
    lines.push(`ACTION: ${entry.action}`)

    // Summarise params — omit large content fields
    const params = { ...entry.params }
    if (params.content && String(params.content).length > 120) {
      params.content = `[${String(params.content).length} chars]`
    }
    lines.push(`PARAMS: ${JSON.stringify(params)}`)

    const obs     = String(entry.observation ?? '').trim()
    const obsMax  = 600
    const obsShow = obs.length > obsMax
      ? obs.slice(0, obsMax) + `\n... [${obs.length - obsMax} chars truncated]`
      : obs
    lines.push(`OBSERVATION:\n${obsShow}`)

    if (entry.reflection) lines.push(`REFLECTION: ${entry.reflection}`)
    return lines.join('\n')
  }).join('\n\n' + '─'.repeat(40) + '\n\n')
}
