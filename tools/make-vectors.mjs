// Builds vectors/index.json: every test vector, tagged with the rules it exercises.
//
//   node tools/make-vectors.mjs
//
// Invoice vectors come from the upstream test suites and the CLIs (vectors/*).
// Consignment vectors are the files in vectors/v011 and vectors/v012, plus
// single-byte corruptions of them: the engine is run on every corruption,
// each result is classified by the error the reference code raises, and a few
// offsets per rule are kept, spread across the file.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'

import { validateConsignment } from '../engine/src/index.js'

const ROOT = new URL('../', import.meta.url)
const json = p => JSON.parse(readFileSync(new URL(p, ROOT)))
const bytes = p => new Uint8Array(readFileSync(new URL(p, ROOT)))
const vectors = []

// Invoices
const errorRule = {
  Invalid: 'v011-invoice-scheme',
  InvalidScheme: 'v011-invoice-scheme',
  InvalidExpiration: 'v011-invoice-expiry',
  InvalidQueryParam: 'v011-invoice-query',
  InvalidTransport: 'v011-invoice-query',
  Beneficiary: 'v011-invoice-beneficiary'
}
for (const line of ['v011', 'v012']) {
  json(`vectors/${line}/upstream-invoices.json`).vectors.forEach((v, n) => {
    const rule = v.expect === 'ok' ? `${line}-invoice-roundtrip` : errorRule[v.error]
    if (!rule) throw new Error(`no rule for ${line} error ${v.error}`)
    vectors.push({
      id: `${line}-upstream-invoice-${n + 1}`,
      rules: [rule],
      kind: 'invoice',
      line: line === 'v011' ? 'v0.11' : 'v0.12',
      input: v.input,
      expect: v.expect === 'ok' ? 'accept' : 'reject',
      roundtrip: v.roundtrip ?? false,
      source: v.source
    })
  })
}
json('vectors/cli-invoices.json').vectors.forEach((v, n) => {
  const line = v.line === 'v0.11' ? 'v011' : 'v012'
  const other = line === 'v011' ? 'v012' : 'v011'
  vectors.push({
    id: `${line}-cli-invoice-${n + 1}`,
    rules: [`${line}-invoice-fields`, `${line}-invoice-roundtrip`],
    kind: 'invoice',
    line: v.line,
    input: v.input,
    expect: 'accept',
    roundtrip: true,
    fields: v.expect,
    source: v.source
  })
  vectors.push({
    id: `${other}-cross-line-invoice-${n + 1}`,
    rules: [`${other}-invoice-scheme`],
    kind: 'invoice',
    line: other === 'v011' ? 'v0.11' : 'v0.12',
    input: v.input,
    expect: 'reject',
    source: `${v.line} invoice from the CLI, given to the ${other === 'v011' ? 'v0.11' : 'v0.12'} parser`
  })
})

// Consignments
// Every consignment file in vectors/v011 and vectors/v012. Each must be valid
// (and, for v0.12, from a trusted issuer); its contract ID is recorded.
const files = {}
for (const line of ['v011', 'v012']) {
  for (const name of readdirSync(new URL(`vectors/${line}/`, ROOT)).filter(n => n.endsWith('.rgb') && !n.endsWith('.invalid.rgb')).sort()) {
    const path = `vectors/${line}/${name}`
    const r = validateConsignment(bytes(path))
    if (!r.valid || (r.issuer && !r.issuer.trusted)) throw new Error(`${path} is not a valid, trusted consignment: ${r.error ?? 'untrusted issuer'}`)
    files[path] = { line: r.line, contractId: r.contractId }
  }
}
const valid = {
  'v0.11': ['v011-file-header', 'v011-strict-decoding', 'v011-known-schema', 'v011-trusted-types', 'v011-schema-match', 'v011-schema-conformance', 'v011-scripts-present', 'v011-aluvm'],
  'v0.12': ['v012-file-header', 'v012-strict-decoding', 'v012-header-contract', 'v012-genesis-codex', 'v012-codex-libs', 'v012-issuer-trust', 'v012-verify-script', 'v012-seal-definitions']
}
const transferValid = {
  'v0.11': ['v011-consignment-type', 'v011-terminals-present', 'v011-same-contract', 'v011-opid', 'v011-dbc-output', 'v011-anchor', 'v011-seal-closing'],
  'v0.12': ['v012-same-contract', 'v012-witness-known', 'v012-seal-closing']
}

// How a corrupted copy's outcome maps to a rule. First match wins.
const classify = {
  'v0.11': [
    [/^throw: not an RGB|^throw: unsupported v0\.11 file type/, 'v011-file-header'],
    [/^throw: unknown schema/, 'v011-known-schema'],
    [/differs from the trusted|does not match the trusted/, 'v011-trusted-types'],
    [/^throw: /, 'v011-strict-decoding'],
    [/invalid consignment type/, 'v011-consignment-type'],
    [/terminal bundle id .* is not present/, 'v011-terminals-present'],
    [/provided for the consignment validation doesn't match/, 'v011-schema-match'],
    [/is under a different contract/, 'v011-same-contract'],
    [/claims ID .* differs/, 'v011-opid'],
    [/uses invalid global state type|uses invalid assignment type|invalid number of assignment entries|invalid global state value/, 'v011-schema-conformance'],
    [/commits to a missing script/, 'v011-scripts-present'],
    [/evaluation of AluVM script/, 'v011-aluvm'],
    [/has no taproot or OP_RETURN output/, 'v011-dbc-output'],
    [/not properly anchored/, 'v011-anchor'],
    [/doesn't close seal/, 'v011-seal-closing'],
    [/^differs: contract/, 'v011-contract-id'],
    [/^differs: terminals/, 'v011-terminals-hint'],
    [/^differs: (state|witnesses)/, 'v011-state-shows-changes']
  ],
  'v0.12': [
    [/^throw: not an RGB|^throw: unsupported consignment file version|future consignment version|reserved byte value/, 'v012-file-header'],
    [/used by the contract codex verifiers but absent/, 'v012-codex-libs'],
    [/^throw: /, 'v012-strict-decoding'],
    // The header still names the old ID: the articles now commit to a different contract.
    [/header names contract/, ['v012-header-contract', 'v012-contract-id']],
    [/genesis names codex/, 'v012-genesis-codex'],
    [/doesn't belong to the current contract/, 'v012-same-contract'],
    [/verification script failure|verifier .* is not present in the codex/, 'v012-verify-script'],
    [/unknown seal definition|reported to be defined by the operation/, 'v012-seal-definitions'],
    [/no witness known/, 'v012-witness-known'],
    [/single-use seals are not closed properly/, 'v012-seal-closing'],
    [/^differs: contract/, 'v012-contract-id'],
    [/^differs: issuer/, 'v012-issuer-trust'],
    [/^differs: (state|witnesses)/, 'v012-state-shows-changes']
  ]
}

function outcome (base, bad) {
  let r
  try { r = validateConsignment(bad) } catch (e) {
    if (/unreachable|RuntimeError/.test(e.message)) throw new Error(`wasm trap: ${e.message}`)
    // Classify by the upstream reason: rgbjs prefixes what the input wasn't
    // ("not a valid consignment: …"), which says nothing about which rule failed.
    const reason = e.message.replace(/^not a valid consignment: /, '')
    return { kind: 'throw: ' + reason, expect: 'reject', message: e.message }
  }
  if (!r.valid) return { kind: 'invalid: ' + r.error, expect: 'reject', message: r.error }
  if (r.contractId !== base.contractId) return { kind: 'differs: contract', expect: 'differs', differs: 'contractId' }
  if (r.issuer && !r.issuer.trusted) return { kind: 'differs: issuer', expect: 'differs', differs: 'issuer.trusted' }
  if (JSON.stringify(r.terminals) !== JSON.stringify(base.terminals)) return { kind: 'differs: terminals', expect: 'differs', differs: 'terminals' }
  if (JSON.stringify(r.witnesses) !== JSON.stringify(base.witnesses)) return { kind: 'differs: witnesses', expect: 'differs', differs: 'witnesses' }
  if (JSON.stringify(r.state) !== JSON.stringify(base.state)) return { kind: 'differs: state', expect: 'differs', differs: 'state' }
  return { kind: 'same' }
}

const PER_RULE = 3
const sweeps = {}
const unclassified = new Set()
for (const [path, meta] of Object.entries(files)) {
  const file = bytes(path)
  const base = validateConsignment(file)
  if (!base.valid || base.contractId !== meta.contractId) throw new Error(`${path} is not the expected valid consignment`)
  const name = path.split('/').pop()
  const transfer = base.kind === 'transfer' || base.operations > 0
  vectors.push({
    id: `${meta.line === 'v0.11' ? 'v011' : 'v012'}-${name}-valid`,
    rules: [...valid[meta.line], ...(transfer ? transferValid[meta.line] : [])],
    kind: 'consignment',
    line: meta.line,
    file: path,
    expect: 'accept',
    contractId: meta.contractId,
    source: `vectors/${path.split('/')[1]}/SOURCES.md`
  })

  const hits = {}
  for (let i = 0; i < file.length; i++) {
    const bad = file.slice()
    bad[i] ^= 0x01
    const o = outcome(base, bad)
    if (o.kind === 'same') throw new Error(`${path} byte ${i}: corruption not detected`)
    const found = classify[meta.line].find(([re]) => re.test(o.kind))?.[1]
    const rule = Array.isArray(found) ? found.join('+') : found
    if (!rule) { unclassified.add(`${meta.line} ${o.kind.split('\n')[0].replace(/[0-9a-f]{64}/g, 'H').replace(/\d+/g, 'N').slice(0, 110)}`); continue }
    ;(hits[rule] ??= []).push({ byte: i, ...o })
  }
  sweeps[path] = { bytes: file.length, byRule: Object.fromEntries(Object.entries(hits).map(([r, l]) => [r.split('+')[0], l.length])) }
  for (const [rule, list] of Object.entries(hits)) {
    const picks = PER_RULE >= list.length ? list : [0, Math.floor(list.length / 2), list.length - 1].map(k => list[k])
    for (const h of picks) {
      vectors.push({
        id: `${rule.split('+')[0]}-${name}-byte-${h.byte}`,
        rules: rule.split('+'),
        kind: 'mutation',
        line: meta.line,
        file: path,
        byte: h.byte,
        xor: 1,
        expect: h.expect,
        ...(h.expect === 'reject' ? { message: h.message.split('\n')[0].slice(0, 160) } : { differs: h.differs })
      })
    }
    console.log(`${name}: ${rule} ${list.length} corruptions, kept ${picks.length}`)
  }
}

if (unclassified.size) {
  for (const u of unclassified) console.error('unclassified:', u)
  process.exit(1)
}

// Consignments that must be rejected as they are (*.invalid.rgb), with the
// rule the reference code rejects them under.
const invalidRule = { 'pfa-unsigned.invalid.rgb': 'v011-aluvm' }
for (const line of ['v011', 'v012']) {
  for (const name of readdirSync(new URL(`vectors/${line}/`, ROOT)).filter(n => n.endsWith('.invalid.rgb')).sort()) {
    const path = `vectors/${line}/${name}`
    const rule = invalidRule[name]
    if (!rule) throw new Error(`${path}: no rule for this invalid consignment`)
    let r
    try { r = validateConsignment(bytes(path)) } catch (e) { r = { valid: false, error: e.message } }
    if (r.valid) throw new Error(`${path} should be invalid`)
    vectors.push({
      id: `${rule}-${name}`,
      rules: [rule],
      kind: 'consignment',
      line: line === 'v011' ? 'v0.11' : 'v0.12',
      file: path,
      expect: 'reject',
      message: r.error.split('\n')[0].slice(0, 160),
      source: `vectors/${line}/SOURCES.md`
    })
  }
}

// A forged length prefix: the corruptions that made unpatched strict_encoding
// 2.9.1 pre-allocate ~4.4 GB (see rules/v012.jsonld, bounded allocation).
// The NftDemo one overflowed capacity in unpatched strict_types 2.9.1, which
// also crashes the pinned rgb-wallet's `rgb accept`.
for (const [file, byte, expect] of [
  ['TransferDemo.transfer.rgb', 7072, 'reject'], ['TransferDemo.transfer.rgb', 7127, 'reject'],
  ['TransferDemo.transfer.rgb', 7168, 'reject'], ['NftDemo.contract.rgb', 7958, 'differs']
]) {
  vectors.push({
    id: `v012-bounded-allocation-${file}-byte-${byte}`,
    rules: ['v012-bounded-allocation'],
    kind: 'mutation',
    line: 'v0.12',
    file: `vectors/v012/${file}`,
    byte,
    xor: 1,
    expect,
    noTrap: true,
    ...(expect === 'differs' ? { differs: 'state' } : {})
  })
}

writeFileSync(new URL('vectors/index.json', ROOT), JSON.stringify({ comment: 'Generated by tools/make-vectors.mjs. Do not edit by hand.', engine: readFileSync(new URL('engine/VERSION', ROOT), 'utf8').trim(), sweeps, vectors }, null, 1) + '\n')
console.log(`${vectors.length} vectors`)
