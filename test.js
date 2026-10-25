// Runs the conformance suite in Node: `node test.js`. Exits non-zero on any failure.
import { readFileSync } from 'node:fs'

import * as engine from './engine/src/index.js'
import { coverage, loadRules, run } from './lib/runner.js'

const json = async p => JSON.parse(readFileSync(new URL(p, import.meta.url)))
const bytes = async p => new Uint8Array(readFileSync(new URL(p, import.meta.url)))

const modules = await loadRules(json)
const { vectors } = await json('vectors/index.json')
const problems = coverage(modules, vectors)
for (const p of problems) console.error('coverage:', p)

const { pass, fail, results } = await run({ engine, json, bytes })
for (const r of results.filter(r => !r.pass)) console.error(`FAIL ${r.vector.id}: ${r.detail.split('\n')[0]}`)
console.log(`${pass} passed, ${fail} failed, ${modules.flatMap(m => m.sets.flatMap(s => s.rules)).length} rules`)
process.exit(fail || problems.length ? 1 : 0)
