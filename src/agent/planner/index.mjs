/**
 * Planner — tracks the high-level plan derived from the objective.
 * The plan itself is generated and updated by the AI; this class
 * just stores it and tracks progress.
 */
export class Planner {
  constructor() {
    this.objective   = null
    this.steps       = []
    this.currentStep = 0
    this.notes       = []
  }

  setObjective(objective) {
    this.objective   = objective
    this.steps       = []
    this.currentStep = 0
    this.notes       = []
  }

  setPlan(steps) {
    this.steps       = Array.isArray(steps) ? steps : [steps]
    this.currentStep = 0
  }

  advanceStep() {
    if (this.currentStep < this.steps.length) this.currentStep++
  }

  addNote(note) {
    this.notes.push({ note, ts: new Date().toISOString() })
  }

  current() {
    return this.steps[this.currentStep] ?? null
  }

  isDone() {
    return this.steps.length > 0 && this.currentStep >= this.steps.length
  }

  progress() {
    if (!this.steps.length) return null
    return `${this.currentStep}/${this.steps.length} steps`
  }

  /** Pretty summary for logging */
  render() {
    if (!this.steps.length) return `Objective: ${this.objective ?? '(none)'}`
    const lines = [`Objective: ${this.objective}`, 'Plan:']
    this.steps.forEach((s, i) => {
      const marker = i < this.currentStep ? '✅' : i === this.currentStep ? '→' : '○'
      lines.push(`  ${marker} ${i + 1}. ${s}`)
    })
    if (this.notes.length) {
      lines.push('Notes:')
      this.notes.slice(-3).forEach(n => lines.push(`  • ${n.note}`))
    }
    return lines.join('\n')
  }
}

export default Planner
