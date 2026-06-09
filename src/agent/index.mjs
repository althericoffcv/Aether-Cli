import { askGemini }                from '../providers/gemini.mjs'
import { buildAgentPrompt,
         buildChatPrompt }          from './prompts.mjs'
import { parseAgentResponse }       from './parser.mjs'
import { Memory }                   from './memory/index.mjs'
import { Reflection }               from './reflection/index.mjs'
import { Planner }                  from './planner/index.mjs'
import { Executor }                 from './executor/index.mjs'
import { scanProject }              from '../scanner/index.mjs'

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ─── Main agent class ─────────────────────────────────────────────────────────
export class AetherAgent {
  constructor(options = {}) {
    const {
      workingDir      = process.cwd(),
      maxIterations   = 25,
      verbose         = false,
      // Lifecycle callbacks — all optional
      onThought       = () => {},
      onAction        = () => {},
      onObservation   = () => {},
      onFinalAnswer   = () => {},
      onError         = () => {},
      onStatus        = () => {},
      onIteration     = () => {},
      // Called BEFORE executing an action — return false to skip
      onBeforeAction  = null,
    } = options

    this.workingDir    = workingDir
    this.maxIterations = maxIterations
    this.verbose       = verbose

    this.cb = {
      onThought, onAction, onObservation, onFinalAnswer,
      onError, onStatus, onIteration, onBeforeAction,
    }

    // Memory is workspace-aware
    this.memory     = new Memory(workingDir)
    this.reflection = new Reflection()
    this.planner    = new Planner()
    this.executor   = new Executor(workingDir)

    this.history     = []
    this.chatHistory = []
  }

  // ══════════════════════════════════════════════════════════════════════════
  // AUTONOMOUS AGENT LOOP
  // ══════════════════════════════════════════════════════════════════════════
  async run(objective) {
    this.history    = []
    this.reflection = new Reflection()
    this.planner.setObjective(objective)

    // ── Load context ──────────────────────────────────────────────────────
    this.cb.onStatus('Loading memory…')
    await this.memory._load()
    const memoryContext = await this.memory.getContextSummary()

    this.cb.onStatus('Scanning project…')
    let projectContext = ''
    try {
      projectContext = await scanProject('.', this.workingDir)
    } catch (err) {
      projectContext = `Project scan failed: ${err.message}`
    }

    // ── Main loop ─────────────────────────────────────────────────────────
    let iteration = 0

    while (iteration < this.maxIterations) {
      iteration++
      this.cb.onIteration(iteration, this.maxIterations)

      // ── Stuck detection ───────────────────────────────────────────────
      if (this.reflection.isStuck(4)) {
        this.cb.onError('Detected repeated failures — injecting recovery hint.')
        this.history.push({
          type:        'system',
          action:      '_system',
          params:      {},
          observation: 'SYSTEM NOTE: The last 4 actions all failed. Try a completely different approach. Re-read relevant files from scratch.',
          thought:     '',
          reflection:  '',
        })
      }

      // ── Build prompt ──────────────────────────────────────────────────
      const prompt = buildAgentPrompt({
        objective,
        projectContext,
        history:           this.history,
        iteration,
        maxIterations:     this.maxIterations,
        memoryContext:     memoryContext || '',
        reflectionSummary: this.reflection.getSummary() || '',
      })

      if (this.verbose) {
        console.error(`\n[AETHER DEBUG] Prompt length: ${prompt.length} chars`)
      }

      // ── Call Gemini ───────────────────────────────────────────────────
      this.cb.onStatus(`Thinking… (step ${iteration}/${this.maxIterations})`)

      let rawResponse
      try {
        rawResponse = await this._callGemini(prompt)
      } catch (err) {
        this.cb.onError(`Gemini error: ${err.message}`)
        if (this._isRateLimit(err)) {
          this.cb.onStatus('Rate limited — waiting 35s…')
          await sleep(35_000)
          iteration--
          continue
        }
        if (this._isConnectionError(err)) {
          this.cb.onError('Connection failed. Check internet + gemini.google.com access.')
          throw err
        }
        await sleep(5_000)
        try { rawResponse = await this._callGemini(prompt) }
        catch (err2) { throw err2 }
      }

      if (this.verbose) {
        console.error(`\n[AETHER DEBUG] Response:\n${rawResponse}\n`)
      }

      // ── Parse ─────────────────────────────────────────────────────────
      const parsed = parseAgentResponse(rawResponse)

      if (parsed.thought) this.cb.onThought(parsed.thought)

      // ── FINAL ANSWER ──────────────────────────────────────────────────
      if (parsed.type === 'final') {
        this.cb.onFinalAnswer(parsed.answer)
        await this.memory.saveSession(objective, this.history)
        return {
          success:    true,
          answer:     parsed.answer,
          iterations: iteration,
          history:    this.history,
        }
      }

      // ── ACTION ────────────────────────────────────────────────────────
      if (parsed.type === 'action') {
        const { toolName, params, thought } = parsed
        this.cb.onAction(toolName, params)

        // ── Optional confirmation hook ─────────────────────────────────
        if (this.cb.onBeforeAction) {
          const confirmed = await this.cb.onBeforeAction(toolName, params)
          if (!confirmed) {
            const obs = 'Action skipped by user.'
            this.cb.onObservation(obs)
            this.history.push({
              type: 'system', action: '_user_skip', params: {},
              thought: '', observation: obs, reflection: '',
            })
            continue
          }
        }

        // Execute
        let observation, execMs = 0
        try {
          const res = await this.executor.run(toolName, params)
          observation = res.result
          execMs      = res.ms
        } catch (err) {
          observation = `EXECUTOR ERROR: ${err.message}`
        }

        this.cb.onObservation(observation)

        // Reflect
        const reflEntry = this.reflection.analyze(iteration, toolName, params, observation)

        // Record history
        this.history.push({
          type: 'action',
          action: toolName,
          params,
          thought,
          observation,
          reflection: reflEntry.insight,
          execMs,
        })

        await sleep(500)
        continue
      }

      // ── UNKNOWN response ──────────────────────────────────────────────
      this.cb.onError('Could not parse response. Retrying with format reminder…')
      this.history.push({
        type: 'system', action: '_parse_error', params: {}, thought: '',
        observation: 'SYSTEM: Your last response could not be parsed. You MUST respond with either:\n<ACTION>tool</ACTION><PARAMS>{...}</PARAMS>\n— or —\n<FINAL_ANSWER>summary</FINAL_ANSWER>',
        reflection: '',
      })
      continue
    }

    // ── Max iterations reached ────────────────────────────────────────────
    const partialSummary = this.history.length
      ? `Reached max iterations (${this.maxIterations}) after ${this.history.length} steps.`
      : 'No actions were taken.'

    await this.memory.saveSession(objective, this.history)
    return {
      success:    false,
      answer:     partialSummary,
      iterations: iteration,
      history:    this.history,
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CHAT MODE — single-turn, fast
  // ══════════════════════════════════════════════════════════════════════════
  async chat(message) {
    await this.memory._load()
    const memoryContext = await this.memory.getContextSummary()

    const prompt = buildChatPrompt({
      message,
      history:       this.chatHistory,
      memoryContext: memoryContext || '',
    })

    const response = await this._callGemini(prompt)

    this.chatHistory.push({ role: 'user',      content: message  })
    this.chatHistory.push({ role: 'assistant', content: response })

    if (this.chatHistory.length > 30) {
      this.chatHistory = this.chatHistory.slice(-30)
    }

    return response
  }

  clearChatHistory() {
    this.chatHistory = []
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ERROR RECOVERY MODE
  // ══════════════════════════════════════════════════════════════════════════
  async recoverFromError(command, errorOutput) {
    this.history    = []
    this.reflection = new Reflection()

    const objective = `Fix the failing command: "${command}"\n\nError:\n${errorOutput}`
    return this.run(objective)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INTERNALS
  // ══════════════════════════════════════════════════════════════════════════
  async _callGemini(prompt) {
    const response = await askGemini(prompt)
    if (!response || !response.trim()) {
      throw new Error('Gemini returned an empty response.')
    }
    return response
  }

  _isRateLimit(err) {
    const msg = err.message?.toLowerCase() ?? ''
    return msg.includes('rate') || msg.includes('429') || msg.includes('quota')
  }

  _isConnectionError(err) {
    const msg = err.message?.toLowerCase() ?? ''
    return msg.includes('fetch') || msg.includes('network') ||
           msg.includes('econnrefused') || msg.includes('enotfound') ||
           msg.includes('session') || msg.includes('timeout') ||
           msg.includes('initialize')
  }
}

export default AetherAgent
