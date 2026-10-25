// Runs the conformance vectors against an engine. Works in Node and browsers:
// the caller supplies `json(path)` and `bytes(path)` loaders.
//
// An engine has the rgbjs shape: { v011, v012, validateConsignment } where each
// line exposes parseInvoice(string) and validateConsignment(Uint8Array).
// The verdict is what counts (accept, reject, or "accepted but visibly
// different"); error messages are shown, not compared, so other
// implementations can conform with their own wording.

export const RULE_FILES = ['rules/v011.jsonld', 'rules/v012.jsonld']

// v0.12 known deviation (AluVM/sonic#27): contract:tb@contract:<id> prints for contract:tb@<id>.
const fold = s => s.replace(/@contract:/, '@')

export async function loadRules (json) {
  const modules = []
  for (const file of RULE_FILES) {
    const doc = await json(file)
    const graph = doc['@graph']
    const module = graph.find(n => n['@type'] === 'Module')
    const sets = graph.filter(n => n['@type'] === 'RuleSet')
    modules.push({ ...module, file, sets })
  }
  return modules
}

export function ruleIndex (modules) {
  const rules = new Map()
  for (const m of modules) for (const s of m.sets) for (const r of s.rules) rules.set(r['@id'].replace(/^rgb:/, ''), { ...r, set: s, module: m })
  return rules
}

function check (engine, v, file, base) {
  const lib = v.line === 'v0.11' ? engine.v011 : engine.v012
  if (v.kind === 'invoice') {
    if (v.expect === 'reject') {
      try { lib.parseInvoice(v.input) } catch (e) { return { pass: true, detail: `rejected: ${e.message}` } }
      return { pass: false, detail: 'accepted, but the reference code rejects it' }
    }
    let inv
    try { inv = lib.parseInvoice(v.input) } catch (e) { return { pass: false, detail: `rejected: ${e.message}` } }
    if (v.roundtrip) {
      const same = v.line === 'v0.12' ? fold(inv.invoice) === fold(v.input) : inv.invoice === v.input
      if (!same) return { pass: false, detail: `printed back as ${inv.invoice}` }
    }
    for (const [k, want] of Object.entries(v.fields || {})) {
      if (JSON.stringify(inv[k]) !== JSON.stringify(want)) return { pass: false, detail: `${k}: got ${JSON.stringify(inv[k])}, want ${JSON.stringify(want)}` }
    }
    return { pass: true, detail: JSON.stringify(inv, null, 2) }
  }

  if (v.kind === 'consignment' && v.expect === 'reject') {
    let r
    try { r = lib.validateConsignment(file) } catch (e) { return { pass: true, detail: `rejected: ${e.message}` } }
    return r.valid
      ? { pass: false, detail: 'accepted, but the reference code rejects it' }
      : { pass: true, detail: `invalid: ${r.error}${v.message ? `\nreference: ${v.message}` : ''}` }
  }

  if (v.kind === 'consignment') {
    let r
    try { r = lib.validateConsignment(file) } catch (e) { return { pass: false, detail: `rejected: ${e.message}` } }
    if (!r.valid) return { pass: false, detail: `invalid: ${r.error}` }
    if (r.contractId !== v.contractId) return { pass: false, detail: `contract ID ${r.contractId}, want ${v.contractId}` }
    if (r.issuer && !r.issuer.trusted) return { pass: false, detail: 'issuer not trusted' }
    return { pass: true, detail: JSON.stringify(r, null, 2) }
  }

  // mutation: one byte of a valid consignment, XORed
  const bad = file.slice()
  bad[v.byte] ^= v.xor
  let r
  try { r = lib.validateConsignment(bad) } catch (e) {
    if (v.noTrap && /unreachable|RuntimeError|out of memory/i.test(e.message)) return { pass: false, detail: `crashed: ${e.message}` }
    return { pass: true, detail: `rejected: ${e.message}${v.message ? `\nreference: ${v.message}` : ''}` }
  }
  if (!r.valid) return { pass: true, detail: `invalid: ${r.error}${v.message ? `\nreference: ${v.message}` : ''}` }
  if (v.expect === 'reject') return { pass: false, detail: 'accepted, but the reference code rejects it' }
  // expect 'differs': accepted is fine only if the result shows the change.
  const shows = r.contractId !== base.contractId ||
    (r.issuer && !r.issuer.trusted) ||
    JSON.stringify([r.terminals, r.witnesses, r.state]) !== JSON.stringify([base.terminals, base.witnesses, base.state])
  return shows
    ? { pass: true, detail: `accepted, and the result shows the change (${v.differs})` }
    : { pass: false, detail: 'accepted as the same contract with the same result' }
}

/**
 * Runs every vector. Calls onResult({ vector, pass, detail }) as it goes and
 * resolves to { pass, fail, results }.
 */
export async function run ({ engine, json, bytes, onResult = () => {} }) {
  const { vectors } = await json('vectors/index.json')
  const files = new Map()
  const bases = new Map()
  const results = []
  let pass = 0
  let fail = 0
  for (const v of vectors) {
    let file, base
    if (v.file) {
      if (!files.has(v.file)) {
        const f = await bytes(v.file)
        files.set(v.file, f)
        let base = null
        try { base = engine.validateConsignment(f) } catch {}
        bases.set(v.file, base)
      }
      file = files.get(v.file)
      base = bases.get(v.file)
    }
    let res
    try { res = check(engine, v, file, base) } catch (e) { res = { pass: false, detail: `harness error: ${e.message}` } }
    res.pass ? pass++ : fail++
    const out = { vector: v, ...res }
    results.push(out)
    onResult(out)
  }
  return { pass, fail, results }
}

/** Every rule needs a vector, and every vector a known rule. Returns problems. */
export function coverage (modules, vectors) {
  const rules = ruleIndex(modules)
  const problems = []
  const used = new Set()
  for (const v of vectors) {
    for (const r of v.rules) {
      if (!rules.has(r)) problems.push(`vector ${v.id} names unknown rule ${r}`)
      used.add(r)
    }
  }
  for (const id of rules.keys()) if (!used.has(id)) problems.push(`rule ${id} has no vector`)
  return problems
}
