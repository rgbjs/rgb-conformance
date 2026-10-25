// Generates spec.html from the rules (rules/*.jsonld) and vectors (vectors/index.json).
//
//   node build.js          write spec.html
//   node build.js --check  fail if spec.html is stale or any rule lacks a vector
//
// The rules in §4 are the source of truth: the specification is rendered from
// them, so the words and the running suite can't drift apart.
import { readFileSync, writeFileSync } from 'node:fs'

import { coverage, loadRules, ruleIndex } from './lib/runner.js'

const ROOT = new URL('./', import.meta.url)
const json = async p => JSON.parse(readFileSync(new URL(p, ROOT)))
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const code = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>')

const modules = await loadRules(json)
const index = await json('vectors/index.json')
const { vectors, sweeps, engine } = index
const pkg = await json('package.json')
const problems = coverage(modules, vectors)
if (problems.length) {
  for (const p of problems) console.error('coverage:', p)
  process.exit(1)
}

const rules = ruleIndex(modules)
const perRule = {}
for (const v of vectors) for (const r of v.rules) perRule[r] = (perRule[r] || 0) + 1
const count = n => vectors.filter(v => v.kind === n).length
const levels = { upstream: 0, rgbjs: 0, informative: 0 }
for (const r of rules.values()) levels[r.level]++

let sec = 0
const toc = []
const section = (title, id, body) => { sec++; toc.push(`<li><a href="#${id}">${sec}. ${esc(title)}</a></li>`); return `<h2 id="${id}">${sec}. ${esc(title)}</h2>\n${body}` }

const rulesBody = modules.map((m, mi) => {
  const line = m.line === 'v0.11' ? 'v011' : 'v012'
  return `<h3 id="${m['@id'].replace('rgb:', '')}">4.${mi + 1} ${esc(m.label)}</h3>
<p>${esc(m.comment)}</p>
${m.sets.map((s, si) => `<h4 id="${s['@id'].replace('rgb:', '')}">4.${mi + 1}.${si + 1} ${esc(s.label)} <span class="pill ${line}">${esc(m.line)}</span></h4>
<p>${code(s.comment)}</p>
<div class="table-wrap"><table>
<tr><th>Rule</th><th>Requirement</th><th>Level</th><th>Error</th><th>Source</th><th>Vectors</th></tr>
${s.rules.map(r => { const id = r['@id'].replace('rgb:', ''); return `<tr id="${id}"><td class="id"><code>${id}</code></td><td>${code(r.comment)}<br><span class="muted mono">${esc(r.check)}</span></td><td><span class="pill ${r.level}">${r.level}</span></td><td class="mono">${esc(r.errorCode)}</td><td class="mono">${esc(r.source)}</td><td><a href="index.html#${id}">${perRule[id] || 0}</a></td></tr>` }).join('\n')}
</table></div>`).join('\n')}`
}).join('\n')

const sweepRows = Object.entries(sweeps).map(([file, s]) =>
  `<tr><td class="mono">${esc(file)}</td><td>${s.bytes}</td><td>${Object.entries(s.byRule).sort((a, b) => b[1] - a[1]).map(([r, n]) => `<a href="#${r}"><code>${r}</code></a>&nbsp;${n}`).join(', ')}</td></tr>`).join('\n')

const body = [
  section('Abstract', 'abstract', `<p>This document specifies the rules an implementation of RGB applies when it reads invoices and validates consignments, for both RGB lines: v0.11 (RGB Protocol Association) and v0.12 (RGB-WG). Each rule comes with test vectors. The rules are data (<a href="rules/v011.jsonld"><code>rules/v011.jsonld</code></a>, <a href="rules/v012.jsonld"><code>rules/v012.jsonld</code></a>); §4 is generated from them, and the <a href="index.html">live suite</a> runs every vector in your browser.</p>`),
  section('Status of this document', 'status', `<p>A living document, version ${esc(pkg.version)}, generated from source on each build. It is an independent community project, not affiliated with or endorsed by the RGB Protocol Association, RGB-WG or LNP/BP. It describes the rules as the reference crates implement them at the versions named in each rule, plus a few checks the rgbjs implementation adds (marked <span class="pill rgbjs">rgbjs</span>). Where this document and the reference code disagree, the reference code is right and this document is wrong. It is early work: not for real funds.</p>`),
  section('Conformance', 'conformance', `<p>The key words MUST, MUST NOT, SHOULD and MAY are to be read as in RFC 2119.</p>
<p>Each rule has a level:</p>
<ul>
<li><span class="pill upstream">upstream</span>: the reference code enforces it. A conforming implementation MUST reject input that violates it.</li>
<li><span class="pill rgbjs">rgbjs</span>: the reference code doesn't enforce it, but accepting such input is unsafe or misleading. A conforming implementation SHOULD reject it.</li>
<li><span class="pill informative">informative</span>: such input can be valid, but it is not the same as the original. A conforming implementation MAY accept it but MUST NOT report it as the original: its result MUST show a different contract ID, an untrusted issuer, or different terminals, witnesses or state.</li>
</ul>
<p>An implementation conforms if, for every vector in §5, its verdict matches: <em>accept</em>, <em>reject</em>, or for informative vectors <em>reject or visibly different</em>. Error messages are shown but not compared, so implementations may word them differently. Implementations MUST NOT crash on any vector: a decode error is a verdict, an abort is not.</p>`),
  section('Rules', 'rules', `<p>${rules.size} rules: ${levels.upstream} upstream, ${levels.rgbjs} rgbjs, ${levels.informative} informative. Each row links to its vectors in the live suite.</p>\n${rulesBody}`),
  section('Test vectors', 'vectors', `<p>${vectors.length} vectors (<a href="vectors/index.json"><code>vectors/index.json</code></a>), all copied into this repository; nothing is fetched at runtime.</p>
<ul>
<li><strong>${count('invoice')} invoice vectors.</strong> Every case in the invoice tests of <code>rgb-invoicing</code> 0.11.1 and <code>sonic-callreq</code> 0.12.0, real invoices printed by <code>rgb-cmd</code> 0.11.1 and <code>rgb-wallet</code> 0.12.0-rc.3, and each of those given to the other line's parser.</li>
<li><strong>${count('consignment')} consignments.</strong> A contract and a transfer for each line, from the pinned CLIs and from offline generators that drive the reference wallet libraries (<a href="vectors/v011/SOURCES.md">v0.11</a>, <a href="vectors/v012/SOURCES.md">v0.12</a>).</li>
<li><strong>${count('mutation')} corruptions.</strong> Every single-byte change (one bit flipped) of each consignment was run through the reference code and classified by the rule it breaks; up to three per rule and file are kept as vectors. No corruption is accepted as the same contract with the same result.</li>
</ul>
<div class="table-wrap"><table><tr><th>Consignment</th><th>Bytes, all swept</th><th>Corruptions caught, by rule</th></tr>
${sweepRows}</table></div>`),
  section('Implementations', 'implementations', `<p><a href="https://github.com/rgbjs/rgbjs">rgbjs</a> (${esc(engine)}): each line's Rust crates compiled to WebAssembly, run in Node and the browser. A copy is in <code>engine/</code>. Other implementations can run the suite with <code>lib/runner.js</code>, which needs <code>parseInvoice</code> and <code>validateConsignment</code> for each line.</p>`),
  section('References', 'references', `<ul>
<li>RGB v0.11 crates: <a href="https://github.com/rgb-protocol">github.com/rgb-protocol</a></li>
<li>RGB v0.12 crates: <a href="https://github.com/RGB-WG">github.com/RGB-WG</a>, <a href="https://github.com/AluVM">github.com/AluVM</a></li>
<li>The two RGB lines: <a href="https://rgb-docs.github.io/getting-started/two-rgbs">rgb-docs.github.io</a></li>
<li>RFC 2119: <a href="https://www.rfc-editor.org/rfc/rfc2119">Key words for use in RFCs to Indicate Requirement Levels</a></li>
<li>Inspired by <a href="https://bitcoin-kernel.com/spec.html">bitcoin-kernel</a>'s conformance specification.</li>
</ul>`)
].join('\n\n')

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RGB conformance specification</title>
<meta name="description" content="Rules for reading RGB invoices and validating consignments on both RGB lines, generated from a machine-readable ruleset, with test vectors.">
<link rel="canonical" href="https://rgbjs.github.io/rgb-conformance/spec.html">
<meta property="og:type" content="article">
<meta property="og:site_name" content="RGB conformance">
<meta property="og:url" content="https://rgbjs.github.io/rgb-conformance/spec.html">
<meta property="og:title" content="RGB conformance specification">
<meta property="og:description" content="${rules.size} rules for both RGB lines, generated from JSON-LD, with ${vectors.length} test vectors.">
<meta property="og:image" content="https://rgbjs.github.io/rgb-conformance/img/og-spec.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://rgbjs.github.io/rgb-conformance/img/og-spec.png">
<link rel="stylesheet" href="style.css">
</head>
<body>
<header class="top"><nav><a class="brand" href="index.html">RGB conformance</a><a href="index.html">Test suite</a><a href="spec.html">Specification</a><a href="https://github.com/rgbjs/rgb-conformance">Source</a></nav></header>
<main>
<h1>RGB conformance specification</h1>
<p class="lede">Rules for reading RGB invoices and validating consignments, for both RGB lines, with conformance test vectors.</p>
<p class="muted">Version ${esc(pkg.version)} · ${rules.size} rules · ${vectors.length} vectors · generated from the ruleset · living document</p>
<div class="note">Independent and early. Not affiliated with RGB-WG, the RGB Protocol Association or LNP/BP, and not for real funds.</div>
<ol>${toc.join('')}</ol>
${body}
<footer>Generated by <code>build.js</code> from <code>rules/*.jsonld</code> and <code>vectors/index.json</code>.</footer>
</main>
</body>
</html>
`

const out = new URL('spec.html', ROOT)
if (process.argv.includes('--check')) {
  let old = ''
  try { old = readFileSync(out, 'utf8') } catch {}
  if (old !== html) { console.error('spec.html is stale: run node build.js'); process.exit(1) }
  console.log('spec.html is up to date')
} else {
  writeFileSync(out, html)
  console.log(`spec.html: ${rules.size} rules, ${vectors.length} vectors`)
}
