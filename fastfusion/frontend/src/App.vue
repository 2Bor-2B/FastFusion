<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import {
  checkHealth,
  generateSkill,
  parseReasoning,
  runBenchmark,
  runModel,
  type AgentSkill,
  type BenchmarkCase,
  type BenchmarkRecord,
  type ParsedReasoning,
  type ReasoningSnippet,
  type RunResult,
} from "./api/backend"

const defaultModels = "nex-agi/nex-n2.5-mini:free\nnex-agi/nex-n2.5-pro:free"
const mode = ref<"run" | "benchmark">("run")
const backendOnline = ref<boolean | null>(null)
const effort = ref("high")
const model = ref("nex-agi/nex-n2.5-mini:free")
const prompt = ref("Alice is older than Bob. Bob is older than Charlie. Who is oldest?")
const runResult = ref<RunResult | null>(null)
const runError = ref("")
const running = ref(false)

const modelsInput = ref(defaultModels)
const cases = ref<BenchmarkCase[]>([
  {
    id: "ordering-01",
    category: "ordering",
    prompt: "Alice is older than Bob. Bob is older than Charlie. Who is oldest? Return only: FINAL: <name>",
    expected_contains: "Alice",
  },
  {
    id: "arithmetic-01",
    category: "math",
    prompt: "A box contains 12 rows of 8 items. How many items are there? Return only: FINAL: <number>",
    expected_contains: "96",
  },
])
const records = ref<BenchmarkRecord[]>([])
const benchmarkErrors = ref<Array<{ model: string; case_id: string; error: string }>>([])
const benchmarkError = ref("")
const benchmarking = ref(false)
const benchmarkDone = ref(false)
const totalRuns = ref(0)
let benchmarkController: AbortController | null = null

interface ReasoningState {
  parsing: boolean
  generating: boolean
  parsed: ParsedReasoning | null
  selectedIds: string[]
  skill: AgentSkill | null
  error: string
}

const reasoningStates = ref<Record<string, ReasoningState>>({})

const models = computed(() => modelsInput.value.split(/[\n,]/).map(value => value.trim()).filter(Boolean))
const completedRuns = computed(() => records.value.length + benchmarkErrors.value.length)

onMounted(async () => {
  backendOnline.value = await checkHealth()
})

async function submitRun() {
  running.value = true
  runError.value = ""
  runResult.value = null
  try {
    runResult.value = await runModel({ model: model.value.trim(), prompt: prompt.value, reasoning_effort: effort.value })
  } catch (error) {
    runError.value = error instanceof Error ? error.message : String(error)
  } finally {
    running.value = false
  }
}

function addCase() {
  cases.value.push({ id: `case-${cases.value.length + 1}`, category: "general", prompt: "", expected_contains: null })
}

async function submitBenchmark() {
  records.value = []
  benchmarkErrors.value = []
  benchmarkError.value = ""
  benchmarkDone.value = false
  reasoningStates.value = {}
  totalRuns.value = models.value.length * cases.value.length
  benchmarking.value = true
  benchmarkController = new AbortController()

  try {
    await runBenchmark(
      { models: models.value, cases: cases.value, reasoning_effort: effort.value },
      event => {
        if (event.type === "result") records.value.push(event.record)
        if (event.type === "error") benchmarkErrors.value.push(event)
        if (event.type === "done") {
          totalRuns.value = event.total_runs
          benchmarkDone.value = true
        }
      },
      benchmarkController.signal,
    )
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      benchmarkError.value = error instanceof Error ? error.message : String(error)
    }
  } finally {
    benchmarking.value = false
    benchmarkController = null
  }
}

function cancelBenchmark() {
  benchmarkController?.abort()
}

function recordKey(record: BenchmarkRecord) {
  return `${record.model}::${record.case_id}`
}

function reasoningState(record: BenchmarkRecord): ReasoningState {
  const key = recordKey(record)
  return reasoningStates.value[key] ??= {
    parsing: false,
    generating: false,
    parsed: null,
    selectedIds: [],
    skill: null,
    error: "",
  }
}

function hasReasoning(record: BenchmarkRecord) {
  if (record.reasoning?.trim()) return true
  if (Array.isArray(record.reasoning_details)) return record.reasoning_details.length > 0
  return Boolean(record.reasoning_details)
}

async function parseRecord(record: BenchmarkRecord) {
  const state = reasoningState(record)
  state.parsing = true
  state.error = ""
  state.skill = null
  try {
    state.parsed = await parseReasoning(record)
    state.selectedIds = []
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error)
  } finally {
    state.parsing = false
  }
}

function selectedSnippets(record: BenchmarkRecord): ReasoningSnippet[] {
  const state = reasoningState(record)
  const selected = new Set(state.selectedIds)
  return state.parsed?.snippets.filter(snippet => selected.has(snippet.id)) ?? []
}

async function createSkill(record: BenchmarkRecord) {
  const state = reasoningState(record)
  const snippets = selectedSnippets(record)
  if (!snippets.length) return
  state.generating = true
  state.error = ""
  state.skill = null
  try {
    state.skill = await generateSkill(record, snippets)
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error)
  } finally {
    state.generating = false
  }
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}
</script>

<template>
  <main>
    <header>
      <div>
        <p class="eyebrow">Reasoning telemetry workbench</p>
        <h1>FastFusion</h1>
      </div>
      <span class="status" :class="{ online: backendOnline }">
        {{ backendOnline === null ? "Checking backend" : backendOnline ? "FastAPI online" : "FastAPI offline" }}
      </span>
    </header>

    <nav aria-label="Workspace">
      <button :class="{ active: mode === 'run' }" @click="mode = 'run'">Single run</button>
      <button :class="{ active: mode === 'benchmark' }" @click="mode = 'benchmark'">Benchmark</button>
      <label>Reasoning effort
        <select v-model="effort"><option>low</option><option>medium</option><option>high</option></select>
      </label>
    </nav>

    <section v-if="mode === 'run'" class="workspace">
      <form class="panel controls" @submit.prevent="submitRun">
        <h2>Run a model</h2>
        <label>Model ID<input v-model="model" required /></label>
        <label>Prompt<textarea v-model="prompt" rows="10" required /></label>
        <button class="primary" :disabled="running">{{ running ? "Running…" : "Run model" }}</button>
        <p v-if="runError" class="error">{{ runError }}</p>
      </form>

      <article class="panel result">
        <h2>Result</h2>
        <p v-if="!runResult" class="muted">The answer and untouched reasoning telemetry will appear here.</p>
        <template v-else>
          <div class="metrics"><span>{{ runResult.model }}</span><strong>{{ runResult.latency_ms }} ms</strong></div>
          <h3>Final answer</h3><pre>{{ runResult.answer ?? "No answer" }}</pre>
          <h3>Reasoning</h3><pre>{{ runResult.reasoning ?? "No plaintext reasoning" }}</pre>
          <details><summary>Raw reasoning_details</summary><pre>{{ formatJson(runResult.reasoning_details) }}</pre></details>
          <details><summary>Usage</summary><pre>{{ formatJson(runResult.usage) }}</pre></details>
        </template>
      </article>
    </section>

    <section v-else>
      <form class="panel benchmark-form" @submit.prevent="submitBenchmark">
        <div class="form-heading"><div><h2>Benchmark setup</h2><p class="muted">One model ID per line</p></div>
          <button type="button" class="secondary" @click="addCase">Add case</button></div>
        <label>Models<textarea v-model="modelsInput" rows="3" required /></label>
        <div v-for="(testCase, index) in cases" :key="index" class="case-grid">
          <input v-model="testCase.id" aria-label="Case ID" placeholder="Case ID" required />
          <input v-model="testCase.category" aria-label="Category" placeholder="Category" required />
          <input v-model="testCase.expected_contains" aria-label="Expected text" placeholder="Expected text (optional)" />
          <textarea v-model="testCase.prompt" aria-label="Prompt" placeholder="Prompt" rows="2" required />
          <button type="button" class="remove" aria-label="Remove case" @click="cases.splice(index, 1)">×</button>
        </div>
        <div class="actions">
          <button class="primary" :disabled="benchmarking || !models.length || !cases.length">{{ benchmarking ? "Benchmarking…" : "Run benchmark" }}</button>
          <button v-if="benchmarking" type="button" class="secondary" @click="cancelBenchmark">Cancel</button>
        </div>
        <p v-if="benchmarkError" class="error">{{ benchmarkError }}</p>
      </form>

      <div class="progress-wrap" aria-live="polite">
        <div><strong>{{ completedRuns }} / {{ totalRuns }}</strong><span>{{ benchmarkDone ? "Complete" : benchmarking ? "Running" : "Ready" }}</span></div>
        <progress :value="completedRuns" :max="totalRuns || 1" />
      </div>

      <div class="results-grid">
        <article v-for="record in records" :key="`${record.model}-${record.case_id}`" class="panel result-card">
          <div class="metrics"><span>{{ record.model }}</span><strong>{{ record.score.total.toFixed(1) }}</strong></div>
          <p class="muted">{{ record.case_id }} · {{ record.category }} · {{ record.latency_ms }} ms</p>
          <h3>Final answer</h3><pre>{{ record.answer ?? "No answer" }}</pre>
          <details><summary>Reasoning</summary><pre>{{ record.reasoning ?? "No plaintext reasoning" }}</pre></details>
          <details><summary>Raw reasoning_details</summary><pre>{{ formatJson(record.reasoning_details) }}</pre></details>
          <details><summary>Score and usage</summary><pre>{{ formatJson({ score: record.score, usage: record.usage }) }}</pre></details>

          <section class="semantic-layer">
            <div class="semantic-heading">
              <h3>Readable reasoning</h3>
              <button
                class="secondary compact"
                :disabled="reasoningState(record).parsing || !hasReasoning(record)"
                @click="parseRecord(record)"
              >{{ reasoningState(record).parsing ? "Parsing…" : reasoningState(record).parsed ? "Parse again" : "Parse reasoning" }}</button>
            </div>
            <p v-if="!hasReasoning(record)" class="muted">This result contains no exposed reasoning telemetry.</p>
            <p v-if="reasoningState(record).error" class="error">{{ reasoningState(record).error }}</p>

            <template v-if="reasoningState(record).parsed">
              <p class="parsed-summary">{{ reasoningState(record).parsed?.summary }}</p>
              <label
                v-for="snippet in reasoningState(record).parsed?.snippets"
                :key="snippet.id"
                class="snippet"
              >
                <input v-model="reasoningState(record).selectedIds" type="checkbox" :value="snippet.id" />
                <span>
                  <span class="snippet-title">{{ snippet.title }} <small>{{ snippet.kind }}</small></span>
                  <span>{{ snippet.summary }}</span>
                  <small>Sources: {{ snippet.source_indices.join(", ") }}</small>
                </span>
              </label>
              <button
                class="primary create-skill"
                :disabled="reasoningState(record).generating || !reasoningState(record).selectedIds.length"
                @click="createSkill(record)"
              >{{ reasoningState(record).generating ? "Creating…" : `Create skill (${reasoningState(record).selectedIds.length})` }}</button>
            </template>

            <article v-if="reasoningState(record).skill" class="skill">
              <p class="eyebrow">Generated skill</p>
              <h2>{{ reasoningState(record).skill?.name }}</h2>
              <p>{{ reasoningState(record).skill?.description }}</p>
              <h3>When to use</h3><ul><li v-for="item in reasoningState(record).skill?.when_to_use" :key="item">{{ item }}</li></ul>
              <h3>Procedure</h3><ol><li v-for="item in reasoningState(record).skill?.procedure" :key="item">{{ item }}</li></ol>
              <h3>Checks</h3><ul><li v-for="item in reasoningState(record).skill?.checks" :key="item">{{ item }}</li></ul>
              <h3>Avoid</h3><ul><li v-for="item in reasoningState(record).skill?.avoid" :key="item">{{ item }}</li></ul>
              <p v-if="reasoningState(record).skill?.example"><strong>Example:</strong> {{ reasoningState(record).skill?.example }}</p>
              <small>Sources: {{ reasoningState(record).skill?.source_snippet_ids.join(", ") }}</small>
            </article>
          </section>
        </article>
        <article v-for="failure in benchmarkErrors" :key="`${failure.model}-${failure.case_id}`" class="panel failure">
          <strong>{{ failure.model }}</strong><p>{{ failure.case_id }}</p><p>{{ failure.error }}</p>
        </article>
      </div>
    </section>
  </main>
</template>
