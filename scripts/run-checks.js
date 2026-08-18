#!/usr/bin/env node
// npm run check — walks every experiments/**/check.js, runs the checks and
// prints a ✓/✗ table grouped by category, with per-check execution time
// (performance-regression detection with no dedicated benchmark infra).
//
// It also runs the CATALOGUE checks first: the standard-figure vocabulary
// (core/figures.js) and the scene → view references. Those two are what the
// registry enforces at load time; running them here means a rename that
// breaks the catalogue fails in the harness, before the browser and long
// before a lecture hall.

import { readdirSync, existsSync } from 'node:fs';
import { join, resolve, sep, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { normalizeViews } from '../src/core/figures.js';
import * as dsp from '../src/core/dsp.js';
import * as la from '../src/core/linalg.js';
import { fft, median, medianInPlace } from '../src/core/numeric.js';
import { validateScene, validateSceneIds } from '../src/core/scenes.js';
import { castParam, parseHash, decodeQuery, encodeHash, patchHashQuery } from '../src/core/router.js';

const ROOT = resolve(process.cwd(), 'src/experiments');

function findChecks(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findChecks(p));
    else if (entry.name === 'check.js') out.push(p);
  }
  return out;
}

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;

let pass = 0;
let fail = 0;

/**
 * One catalogue check, reported. Every catalogue check ends the same way — a
 * section label, then either the list of offences or the one-line summary of
 * what was proved — and that ending was pasted twelve times, drifting a little
 * each time. Callers push COMPLETE sentences into `bad`; `cap` bounds how many
 * are shown when a broken sweep would otherwise print hundreds.
 */
function report(section, bad, ok, { cap = Infinity } = {}) {
  console.log(`  ${dim(section)}`);
  if (bad.length) {
    for (const b of bad.slice(0, cap)) console.log(`    ${red('✗')} ${b}`);
    if (bad.length > cap) console.log(`    ${dim(`… and ${bad.length - cap} more`)}`);
    fail++;
  } else {
    console.log(`    ${green('✓')} ${ok}`);
    pass++;
  }
}

/* ------------------------------------------------------------- catalogue --
   The vocabulary and the scene references, replayed exactly as the registry
   does it — but outside Vite, so `npm run check` catches them too. */
/**
 * Principle 4, made checkable: THE CORE KNOWS NO EXPERIMENT. It discovers
 * them by glob and never by name — so no file of src/core/ may import
 * anything under src/experiments/, in either direction of the path.
 *
 * Until the subject-specific modules moved next to their subject, this rule
 * lived only in prose. A `bode.js` sitting in core/ could have reached into
 * control/ and nothing would have said a word.
 */
function checkLayering() {
  const bad = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js') || e.name.endsWith('.svelte')) {
        const src = readFileSync(p, 'utf8');
        for (const m of src.matchAll(/from\s+'([^']+)'/g))
          if (/experiments\//.test(m[1])) bad.push(`core imports an experiment: ${p} → ${m[1]}`);
      }
    }
  };
  walk(resolve(process.cwd(), 'src/core'));
  report('layering', bad, `no file of core/ imports experiments/  ${dim('(principle 4)')}`);
}

/**
 * The info panel deep-links every experiment's DIRECTORY on GitHub, built from
 * the subject and the id rather than from anything the manifest declares — and
 * its tooltip promises the four-file contract by name: compute, scenes,
 * manifest, checks. So all four are required here, not just the science: a
 * link that under-delivers on its own tooltip is the one breakage a reader
 * cannot diagnose — the page loads, the figure is fine, and only the promise
 * is a lie.
 */
function checkSourceLinks() {
  const EXP = resolve(process.cwd(), 'src/experiments');
  const FILES = ['compute.js', 'scenes.js', 'manifest.js', 'check.js'];
  const bad = [];
  let n = 0;
  for (const subject of readdirSync(EXP, { withFileTypes: true })) {
    if (!subject.isDirectory() || subject.name.startsWith('_')) continue;
    for (const exp of readdirSync(join(EXP, subject.name), { withFileTypes: true })) {
      if (!exp.isDirectory() || exp.name.startsWith('_')) continue;
      n++;
      for (const f of FILES)
        if (!existsSync(join(EXP, subject.name, exp.name, f)))
          bad.push(`${subject.name}/${exp.name}: the source link promises ${f} and it is missing`);
    }
  }
  report('source links', bad, `every experiment carries its four files  ${dim(`(${n} experiments)`)}`);
}

/**
 * `random: true` must say the truth, in both directions.
 *
 * The seed exists so a draw can be replayed; an experiment that draws
 * NOTHING — a Bode plot, a convolution, a pole map — used to carry the dice
 * button, the seed field and `?seed=` all the same, and pressing the dice
 * provably changed nothing. Half the catalogue was in that state.
 *
 * mulberry32 is the only generator the project allows (CLAUDE.md), so
 * "this experiment draws" is exactly "its compute reaches core/rng.js",
 * directly or through anything it imports. That is a fact about the source,
 * not a promise in a manifest, which is why it can be checked rather than
 * trusted: a manifest declaring `random: true` without a generator, or
 * using one without declaring it, fails here.
 */
function checkRandomness() {
  const EXP = resolve(process.cwd(), 'src/experiments');
  const cache = new Map();
  const reachesRng = (file, seen = new Set()) => {
    const abs = resolve(file);
    if (seen.has(abs)) return false;
    seen.add(abs);
    if (cache.has(abs)) return cache.get(abs);
    if (!existsSync(abs)) return false;
    const src = readFileSync(abs, 'utf8');
    let hit = /from\s+'[^']*core\/rng\.js'/.test(src);
    if (!hit)
      for (const m of src.matchAll(/from\s+'(\.[^']+\.js)'/g))
        if (reachesRng(resolve(dirname(abs), m[1]), seen)) {
          hit = true;
          break;
        }
    cache.set(abs, hit);
    return hit;
  };

  const bad = [];
  let n = 0;
  for (const sub of readdirSync(EXP, { withFileTypes: true })) {
    if (!sub.isDirectory()) continue;
    for (const exp of readdirSync(join(EXP, sub.name), { withFileTypes: true })) {
      if (!exp.isDirectory()) continue;
      const dir = join(EXP, sub.name, exp.name);
      if (!existsSync(join(dir, 'manifest.js'))) continue;
      n++;
      // `random: true,` followed by an explanatory comment is normal and
      // wanted — the pattern anchors on the comma, never on the line end.
      const declared = /^\s*random:\s*true\s*,/m.test(readFileSync(join(dir, 'manifest.js'), 'utf8'));
      const draws = reachesRng(join(dir, 'compute.js'));
      if (declared && !draws)
        bad.push(`${sub.name}/${exp.name}: declares random: true but never reaches core/rng.js`);
      if (!declared && draws)
        bad.push(`${sub.name}/${exp.name}: uses core/rng.js but does not declare random: true`);
    }
  }
  report('randomness', bad, `random: true matches the generator in all ${n} experiments`);
}

/**
 * Every `var(--x)` resolves to a token that is actually declared.
 *
 * A CSS custom property that does not exist is not an error anywhere: the
 * declaration is dropped and the element quietly inherits. `--muted-foreground`
 * — the shadcn spelling, and not this project's, which is `--muted-fg` — got
 * three declarations into the statline and the frozen value simply failed to
 * go grey. It looked fine. It looked exactly like a value that had not been
 * styled yet, which is what it was.
 *
 * Cheap, and it covers the SVG too: `stroke="var(--foreground)"` in a component
 * fails the same silent way.
 */
function checkCssTokens() {
  const declared = new Set();
  const used = new Map();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(css|svelte)$/.test(e.name)) {
        const src = readFileSync(p, 'utf8');
        for (const m of src.matchAll(/(^|[;{\s])(--[a-z0-9-]+)\s*:/gi)) declared.add(m[2]);
        for (const m of src.matchAll(/var\(\s*(--[a-z0-9-]+)/g))
          if (!used.has(m[1])) used.set(m[1], p.slice(p.indexOf('src/')));
      }
    }
  };
  walk(resolve(process.cwd(), 'src'));
  const bad = [...used]
    .filter(([name]) => !declared.has(name))
    .map(([name, where]) => `${where}: var(${name}) is not declared anywhere`);
  report('tokens', bad, `all ${used.size} CSS custom properties used are declared`);
}

/**
 * A custom view that draws <Axes> hands it the MARGIN it drew with.
 *
 * The axis NAMES are placed inside the margin — the y one rotated against the
 * left edge, the x one below the ticks — and until there were two canvases
 * those offsets could be constants. There are two now (ui/plots/frame.js), and
 * a view that lets `m` default to the wide margin puts its y name six units
 * from the edge of the phone canvas, where it is clipped mid-letter. On the
 * desktop it looks perfect, which is exactly why this is checked rather than
 * noticed: five views were doing it and the only symptom was on a phone.
 */
function checkAxesMargin() {
  const bad = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.svelte')) {
        const src = readFileSync(p, 'utf8');
        for (const m of src.matchAll(/<Axes\b[^>]*>/g))
          // `m={M}` or the shorthand `{m}` — both hand it down
          if (!/\bm=\{|\{m\}/.test(m[0])) bad.push(p.slice(p.indexOf('src/')));
      }
    }
  };
  walk(resolve(process.cwd(), 'src'));
  report(
    'canvas',
    [...new Set(bad)].map((b) => `${b}: <Axes> without m={…} — its axis names clip on the phone canvas`),
    'every <Axes> is placed from the margin it was drawn with'
  );
}

/**
 * WHO IS WHO: a view that draws several series names each of them. The legend
 * is built from labels, so an unlabeled series in a multi-series view is a
 * curve the room cannot identify — the one question a projected figure must
 * never raise. The unit of the rule is the VISUAL IDENTITY (type + color +
 * dash): a pair drawn identically (an envelope's two halves) may share one
 * label, since two chips saying the same thing only lengthen the legend.
 * Stack panels are exempt — their y-axis label IS their name — but every
 * stack overlay, drawn across all panels, must say what it is.
 */
function checkLegends(manifest, key, bad) {
  const DATA = new Set(['line', 'scatter', 'histogram', 'bars', 'stem', 'density', 'band']);
  const groups = [];
  for (const v of manifest.views ?? []) {
    const name = `${key}/${v.id ?? v.figure}`;
    if (v.kind === 'plot') {
      groups.push([name, [v.spec, ...(v.spec.overlays ?? [])].filter((l) => DATA.has(l.type))]);
    } else if (v.kind === 'plane') {
      groups.push([
        name,
        [
          ...(v.spec.clouds ?? []).map((c) => ({ type: 'scatter', ...c })),
          ...(v.spec.curves ?? []).map((c) => ({ type: 'line', ...c })),
          ...(v.spec.markers ? [{ type: 'scatter', ...v.spec.markers }] : []),
        ],
      ]);
    } else if (v.kind === 'stack') {
      for (const o of v.spec.overlays ?? [])
        if (DATA.has(o.type) && !o.label)
          bad.push(`${name}: stack overlay '${o.source}' has no label`);
    }
  }
  for (const [name, layers] of groups) {
    if (layers.length < 2) continue;
    const byLook = new Map();
    for (const l of layers) {
      const look = `${l.type}, ${l.color ?? 'default color'}${l.dashed ? ', dashed' : ''}`;
      if (!byLook.has(look)) byLook.set(look, []);
      byLook.get(look).push(l);
    }
    for (const [look, ls] of byLook)
      if (!ls.some((l) => l.label))
        bad.push(
          `${name}: '${ls.map((l) => l.source).join("', '")}' (${look}) has no legend label`
        );
  }
}

/**
 * Every declarative axis carries a name.
 *
 * An unlabelled axis is still TICKED: it therefore reads as if it measured
 * something, and the reader looks for a meaning that does not exist. It happened
 * once — the ordinate of a view carried a random offset, put there to spread the
 * points out, and nobody could have guessed it. The rule is stronger than "name
 * the axes": if an axis cannot be named, it should not be drawn.
 */
function checkAxisLabels(manifest, key, bad) {
  const text = (a) => (typeof a === 'string' ? a : (a?.label ?? ''));
  for (const v of manifest.views ?? []) {
    const name = v.title ?? v.figure ?? v.id;
    // A stack declares the abscissa once and an ordinate per panel — and the
    // per-panel ordinate is the ONE name the reader needs, since "Re" above
    // "Im" is the whole reason the panels are apart.
    if (v.kind === 'stack') {
      if (!text(v.spec.axes?.x).trim()) bad.push(`${key}, view '${name}': axis x has no name`);
      v.spec.panels.forEach((p, i) => {
        if (!text(p.axes?.y).trim()) bad.push(`${key}, view '${name}': panel ${i + 1} axis y has no name`);
      });
      continue;
    }
    const ax = v.spec?.axes ?? v.plot?.axes;
    if (!ax) continue;
    for (const k of ['x', 'y']) {
      if (!text(ax[k]).trim())
        bad.push(`${key}, view '${name}': axis ${k} has no name`);
    }
  }
}

/**
 * The call layer of the computes (core/dsp.js) is verified ONCE here, not once
 * per experiment. That is the whole point of having extracted it: nineteen
 * hand-written sinusoids are nineteen chances to get an index wrong; a single
 * function is an identity that can be pinned.
 *
 * The two identities that matter most are here: ifft∘fft = identity, and
 * dbAmp(x) = dbPower(x²) — the latter because confusing the two scales has
 * already cost a factor 2 on a perfectly plausible plot.
 */
function checkDsp() {
  const bad = [];
  const N = 256;
  const FS = 1000;
  const worst = (n, f) => Math.max(...Array.from({ length: n }, (_, i) => Math.abs(f(i))));

  // ifft ∘ fft = identity
  const x = dsp.tone(N, 50, { fs: FS, amp: 1.7, phase: 0.3 });
  const re = Float64Array.from(x);
  const im = new Float64Array(N);
  fft(re, im);
  dsp.ifft(re, im);
  const idErr = Math.max(worst(N, (i) => re[i] - x[i]), worst(N, (i) => im[i]));
  if (idErr > 1e-12) bad.push(`ifft∘fft : ${idErr.toExponential(1)}`);

  // dbAmp(x) = dbPower(x²), exactement
  const dbErr = worst(60, (i) => {
    const v = 10 ** (i / 10 - 3);
    return dsp.dbAmp(v) - dsp.dbPower(v * v);
  });
  if (dbErr > 1e-9) bad.push(`dbAmp/dbPower : ${dbErr.toExponential(1)}`);

  // a line on a bin: right position, and amplitude A·N/2 (rectangular window)
  const A = 1.3;
  const fBin = (FS * 8) / N; // pile sur le bin 8
  const mag = dsp.magSpectrum(dsp.tone(N, fBin, { fs: FS, amp: A }), { nfft: N });
  let kMax = 0;
  for (let k = 0; k < mag.length; k++) if (mag[k] > mag[kMax]) kMax = k;
  if (kMax !== 8) bad.push(`raie au bin ${kMax} au lieu de 8`);
  if (Math.abs(mag[8] - (A * N) / 2) > 1e-9)
    bad.push(`amplitude ${mag[8].toFixed(4)} au lieu de ${(A * N) / 2}`);

  // the half-spectrum runs to Nyquist INCLUSIVE, and so does the axis
  const f = dsp.freqAxis(N, FS);
  if (f.length !== N / 2 + 1 || f[f.length - 1] !== FS / 2)
    bad.push(`freqAxis : ${f.length} points, dernier ${f[f.length - 1]}`);
  if (mag.length !== N / 2 + 1) bad.push(`magSpectrum : ${mag.length} points`);

  // σ² = P/10^(SNR/10), exactement
  const sErr = worst(5, (i) => {
    const snr = i * 10 - 10;
    return dsp.noiseSigma(0.5, snr) ** 2 - 0.5 / 10 ** (snr / 10);
  });
  if (sErr > 1e-15) bad.push(`noiseSigma : ${sErr.toExponential(1)}`);

  // linspace: exact bounds, no error accumulation
  const g = dsp.linspace(-3, 7, 101);
  if (g[0] !== -3 || g[100] !== 7) bad.push(`linspace : [${g[0]}, ${g[100]}]`);

  report('dsp', bad, 'ifft∘fft, dbAmp = dbPower∘square, line on bin, Nyquist included, σ(SNR), linspace');
}

/**
 * Principle 6, made checkable: THE CATALOGUE IS WRITTEN IN ENGLISH.
 *
 * The conversion to English swept comments, notes and titles — and missed seven
 * strings, because they were neither prose nor comments: five param names
 * (`algorithme`, `famille` twice, `méthode`, `étape`, `poursuite`), two view
 * titles (`Spectrogramme`, `Plan I/Q`) and a symbol (`fe`, for *fréquence
 * d'échantillonnage*). They sat in the interface for months. Prose is what gets
 * re-read; a one-word select label is not.
 *
 * Three rules, each catching a different way the French comes back:
 *
 *   1. FRENCH FUNCTION WORDS anywhere in a user-visible string. Fifty-seven
 *      words that are unambiguously not English — the list is checked to give
 *      zero hits on the 1300 strings the catalogue has today, so any hit is a
 *      regression and not a judgement call. This is the guard for the docs,
 *      which are the most-edited pedagogical prose in the repository.
 *   2. ACCENTED WORDS outside a whitelist. `moiré` and `Cramér` are English
 *      (a loanword and a proper noun); `fréquence` and `méthode` are not.
 *   3. WORD-SHAPED PARAM NAMES against a CLOSED LIST. A param `name` is meant to
 *      be a symbol; when it is a word instead — which is the convention for a
 *      select — it must be one the catalogue already uses. This is the rule that
 *      catches the five that got through, and it doubles as the terminology
 *      guard the project asks for: one word per concept, chosen once.
 *
 * What it does NOT catch, stated so nobody trusts it further than it goes: a
 * French word with no accent inside free prose, such as a view title reading
 * "Spectrogramme". Titles are open text and no closed list can hold them.
 */
// The French this catalogue can still be caught speaking. Two families, and
// they fail differently.
//
// GRAMMAR words are what a translated SENTENCE leaves behind — a note rewritten
// in English keeping "le" or "dont". They are unmistakable and cheap.
//
// DOMAIN words are what a translated LABEL leaves behind, and they are the ones
// that survived two passes of this check: "SER empirique", "gain statique",
// "BER sans codage" contain no grammar at all. Twenty-one of them were sitting
// under the plots, read by the room off every statline, because the check only
// ever looked at manifests and scenes — the labels live in compute.js and were
// never opened. Every word below is French and NOT an English word, so the
// list can grow without ever becoming a source of false alarms; the ones that
// are both (image, dense, final, distance, note, orange, simple) are exactly
// the ones it must not contain.
// The French this catalogue can still be caught speaking. Two families, and
// they fail differently.
//
// GRAMMAR words are what a translated SENTENCE leaves behind — a note rewritten
// in English keeping "le" or "dont". They are unmistakable and cheap.
//
// DOMAIN words are what a translated LABEL leaves behind, and they are the ones
// that survived two passes of this check: "SER empirique", "gain statique",
// "BER sans codage" contain no grammar at all. Twenty-one of them were sitting
// under the plots, read by the room off every statline, because the check only
// ever looked at manifests and scenes — the labels live in compute.js, which
// this walk never opened.
//
// EVERY WORD BELOW IS FRENCH AND NOT AN ENGLISH WORD. That is what lets the
// list grow without ever raising a false alarm, and it is also this check's
// honest limit: `canal`, `grille`, `dents`, `lobe`, `image`, `dense` are French
// AND English, so they cannot be caught here at any threshold. Those are what
// TERMINOLOGY.md and a pair of eyes are for — a list that cried wolf on "Time
// signal" would be turned off within a week, and then nothing would be checked
// at all.
const FRENCH_WORDS =
  // grammar
  'le|la|les|des|du|une|dans|avec|pour|qui|que|dont|être|était|sont|cette|ces|leur|leurs|' +
  'nous|vous|ils|elles|aussi|donc|alors|encore|entre|chaque|même|ainsi|selon|chez|sous|' +
  'depuis|pendant|avant|après|jamais|toujours|rien|celui|celle|ceux|aux|très|trop|beaucoup|' +
  'comme|mais|parce|lorsque|tandis|plusieurs|ensuite|puis|déjà|ici|sans|hors|vers|' +
  // quantities and readings
  'moyenne|écart|écart-type|erreur|erreurs|valeur|valeurs|mesure|mesures|niveau|seuil|' +
  'puissance|largeur|hauteur|longueur|profondeur|durée|vitesse|pente|somme|nombre|taille|' +
  'taux|ordre|degré|instable|marginalement|' +
  // signals, systems, communications
  'bruit|signaux|onde|porteuse|codage|décodage|filtrage|repliement|échantillon|trame|trames|' +
  'échantillonnage|fenêtre|fenêtrage|spectre|fréquence|secondaire|secondaires|principale|' +
  'retard|entrée|sortie|réponse|impulsionnelle|indicielle|fréquentielle|temporelle|' +
  'statique|dynamique|ouverture|fermeture|maillage|treillis|' +
  // statistics, estimation, learning
  'loi|tirage|tirages|réalisation|estimateur|biais|vraisemblance|empirique|empiriques|' +
  'théorique|théoriques|apprentissage|entraînement|échec|réussite|couverture|confiance|' +
  'ajustement|' +
  // judgements a label makes
  'dur|dure|souple|douce|faible|grande|petite|courte|lente|vraie|fausse|bonne|mauvaise|' +
  'apparente|attendue|obtenue|choisie|comparaison|domaine|capteur';
const ACCENTED_OK = new Set(['moiré', 'Cramér']);
/**
 * Symbols the catalogue has RETIRED, and what they became. A symbol is not a
 * word, so the list above cannot see one: `Fe` is *fréquence d'échantillonnage*
 * wearing an English coat, and it sat in one experiment's params, its axis
 * labels and its view title long after TERMINOLOGY.md said in bold that the
 * sampling rate is `Fs` everywhere and in that spelling. A rule
 * written down and not checked is a rule that holds until someone is in a
 * hurry.
 */
const RETIRED_SYMBOLS = new Map([
  ['fe', 'Fs'],
  ['Fe', 'Fs'],
]);
/** Word-shaped param names, the closed list. A symbol is not a word. */
const NAME_WORDS = new Set([
  'activation', 'algorithm', 'basis', 'code', 'dataset', 'den', 'distribution', 'dither',
  'equalizer', 'family', 'function', 'grid', 'image', 'input', 'kernel', 'mapping', 'method',
  'mode', 'modulation', 'order', 'shape',
  'key', 'num', 'outlier', 'output', 'pulse', 'signal', 'source', 'sources', 'stage', 'standardize',
  'structure', 'system', 'table', 'target', 'tracking', 'wavelet', 'window', 'zero-padding',
]);

function checkLanguage(strings, names) {
  const bad = [];
  const fr = new RegExp(`\\b(${FRENCH_WORDS})\\b`, 'i');
  const accented = /\b\w*[éèêàùûôîçëï]\w*\b/gi;
  for (const [where, s] of strings) {
    const m = fr.exec(s);
    if (m) bad.push(`${where}: French word '${m[0]}' in ${JSON.stringify(s.slice(0, 52))}`);
    for (const a of s.match(accented) ?? [])
      if (!ACCENTED_OK.has(a)) bad.push(`${where}: '${a}' is not an English word`);
  }
  for (const [where, name] of names) {
    const became = RETIRED_SYMBOLS.get(name);
    if (became) bad.push(`${where}: '${name}' is a retired symbol — the catalogue writes '${became}'`);
    // Symbols are exempt, and the test is the shape: a WORD here is all
    // lower-case latin letters, three or more. That leaves out the greek
    // (σ, μ, Δf), the short ones (f, N, h) and the acronyms (SNR, BER), which
    // are symbols and belong to their field rather than to a house list.
    if (!/^[a-z][a-z-]{2,}$/.test(name)) continue;
    if (!NAME_WORDS.has(name.toLowerCase()))
      bad.push(`${where}: param name '${name}' is a word but not one the catalogue uses`);
  }
  report(
    'language',
    bad,
    `no French in ${strings.length} visible strings, every word-shaped param name is on the list, no retired symbol`,
    { cap: 10 }
  );
}

/**
 * medianInPlace agrees with median, EXACTLY, on every shape of input.
 *
 * A median is an order statistic, so selecting the middle rank and sorting for
 * it cannot legitimately disagree — which makes this a bit-for-bit identity
 * rather than a tolerance, and the only honest way to buy the faster one. The
 * inputs below are the ones that break a careless quickselect: already sorted
 * and reverse sorted (the quadratic pivot cases), all-equal, two values, and
 * both parities of length.
 */
function checkMedian() {
  const bad = [];
  const rand = (() => {
    let s = 12345;
    return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  })();
  const shapes = {
    sorted: (n) => Float64Array.from({ length: n }, (_, i) => i),
    reversed: (n) => Float64Array.from({ length: n }, (_, i) => n - i),
    equal: (n) => new Float64Array(n).fill(3.5),
    twoValued: (n) => Float64Array.from({ length: n }, (_, i) => (i % 2 ? 1 : -1)),
    random: (n) => Float64Array.from({ length: n }, () => rand() * 20 - 10),
    spiky: (n) => Float64Array.from({ length: n }, (_, i) => (i === 0 ? 1e9 : rand())),
  };
  for (const [shape, make] of Object.entries(shapes)) {
    for (let n = 1; n <= 65; n++) {
      const a = make(n);
      const want = median(a); // copies and sorts
      const got = medianInPlace(Float64Array.from(a)); // selects, in place
      if (!Object.is(want, got)) bad.push(`${shape} n=${n}: ${got} ≠ ${want}`);
    }
  }
  // and it really does leave the input alone when called through `median`
  const src = Float64Array.from([5, 1, 4, 2, 3]);
  median(src);
  if (String(src) !== '5,1,4,2,3') bad.push(`median mutated its input: ${src}`);

  report('median', bad, `select = sort, bit for bit, on 6 shapes × n = 1…65  ${dim('(390 cases)')}`, { cap: 6 });
}

/**
 * The core's linear algebra (core/linalg.js), verified through its IDENTITIES —
 * once, here, rather than once per subject.
 *
 * The module deliberately holds only what experiments use (see its header). This
 * check is the counterpart of that rule: every function that goes in must arrive
 * with an identity that can be written down, or it does not go in.
 */
function checkLinalg() {
  const bad = [];
  const n = 5;
  const worst = (k, f) => Math.max(...Array.from({ length: k }, (_, i) => Math.abs(f(i))));

  // matvec : A = I laisse x intact, et A quelconque redonne le produit
  const I = new Float64Array(n * n);
  for (let i = 0; i < n; i++) I[i * n + i] = 1;
  const x = Float64Array.from({ length: n }, (_, i) => 1.7 - 0.4 * i);
  if (worst(n, (i) => la.matvec(I, x, n, n)[i] - x[i]) > 0) bad.push('matvec(I, x) ≠ x');

  // a symmetric test matrix, positive definite (AᵀA + I)
  const R = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) R[i * n + j] = 1 / (1 + Math.abs(i - j)) + (i === j ? 1 : 0);

  // quadForm: xᵀRx = Σ x_i (Rx)_i, and Σ λ_k ⟨v_k, x⟩² through the decomposition
  const Rx = la.matvec(R, x, n, n);
  let direct = 0;
  for (let i = 0; i < n; i++) direct += x[i] * Rx[i];
  if (Math.abs(la.quadForm(R, x, n) - direct) > 1e-12) bad.push('quadForm ≠ xᵀ(Rx)');

  const eig = la.jacobiSym(Float64Array.from(R), n);
  let spectral = 0;
  for (let k = 0; k < n; k++) {
    let p = 0;
    for (let i = 0; i < n; i++) p += eig.vectors[i * n + k] * x[i];
    spectral += eig.values[k] * p * p;
  }
  if (Math.abs(spectral - direct) > 1e-12) bad.push(`Σλ⟨v,x⟩² : ${Math.abs(spectral - direct)}`);

  // jacobiSym: VᵀV = I, and Rv = λv
  for (let a = 0; a < n; a++)
    for (let b = 0; b < n; b++) {
      let d = 0;
      for (let i = 0; i < n; i++) d += eig.vectors[i * n + a] * eig.vectors[i * n + b];
      if (Math.abs(d - (a === b ? 1 : 0)) > 1e-12) bad.push('VᵀV ≠ I');
    }
  for (let k = 0; k < n; k++) {
    const v = Float64Array.from({ length: n }, (_, i) => eig.vectors[i * n + k]);
    const Rv = la.matvec(R, v, n, n);
    if (worst(n, (i) => Rv[i] - eig.values[k] * v[i]) > 1e-12) bad.push(`Rv ≠ λv (k=${k})`);
  }

  // solveLinearSystem: solve(A, A·x) returns x, including when the first pivot
  // is zero — that is where a missing partial pivot would show
  const A = [
    [0, 2, 1],
    [1, -1, 3],
    [2, 4, -1],
  ];
  const xs = [1.5, -2, 0.75];
  const b = A.map((r) => r[0] * xs[0] + r[1] * xs[1] + r[2] * xs[2]);
  const sol = la.solveLinearSystem(A.map((r) => r.slice()), b.slice());
  if (worst(3, (i) => sol[i] - xs[i]) > 1e-12) bad.push('solve(A, Ax) ≠ x');

  // normalEquations + ridgeSolve: on EXACTLY polynomial data, λ = 0 recovers the
  // coefficients; and λ > 0 shrinks the solution
  const xs2 = Array.from({ length: 40 }, (_, i) => -1 + (2 * i) / 39);
  const truth = [0.5, -1.25, 2];
  const ys = xs2.map((t) => truth[0] + truth[1] * t + truth[2] * t * t);
  const { AtA, Aty } = la.normalEquations(
    xs2.length,
    3,
    (i, row) => {
      row[0] = 1;
      row[1] = xs2[i];
      row[2] = xs2[i] * xs2[i];
    },
    ys
  );
  const w0 = la.ridgeSolve(AtA, Aty, 0);
  if (worst(3, (i) => w0[i] - truth[i]) > 1e-10) bad.push('exact least squares missed');
  const wR = la.ridgeSolve(AtA, Aty, 5);
  const norm = (w) => Math.hypot(...w);
  if (!(norm(wR) < norm(w0))) bad.push('ridge does not shrink');
  // and continuity: λ → 0 gives back the least squares
  const wEps = la.ridgeSolve(AtA, Aty, 1e-9);
  if (worst(3, (i) => wEps[i] - w0[i]) > 1e-6) bad.push('ridge discontinue en 0');
  // the inputs are NOT modified: two calls give the same result
  const again = la.ridgeSolve(AtA, Aty, 0);
  if (worst(3, (i) => again[i] - w0[i]) > 0) bad.push('ridgeSolve modifies its inputs');

  report('linalg', bad, 'matvec, xᵀRx = Σλ⟨v,x⟩², VᵀV = I, Rv = λv, solve(A,Ax) = x, ridge exact and continuous at 0');
}

/**
 * The URL contract (core/router.js), which is the ONE contract nothing else can
 * catch. A wrong formula fails a numeric check; a wrong URL cast produces a
 * plausible plot of the wrong thing, in bounds, with nobody to object.
 *
 * The header of router.js promises that an out-of-bounds or unparsable value
 * "silently falls back to the default (a hand-edited URL must never produce an
 * invalid state or a crash)". That promise had never been tested, and it was
 * half true: nothing crashed, but `parseFloat`/`parseInt` stop at the first
 * unreadable character, so '12abc' decoded to 12 and '0x10' to 0 instead of
 * falling back. Pinned here, both halves.
 *
 * Also pinned: encode → decode is the identity on every param type. That is
 * "one link = one reproducible scene" written as an equation, and it is the
 * reason the whole instrument can be driven by a URL.
 */
function checkRouter() {
  const bad = [];
  const N = { type: 'int', min: 2, max: 200 };
  const A = { type: 'float', min: 0, max: 2 };
  const SNR = { type: 'log', min: 1e-3, max: 1e3 };
  const B = { type: 'bool' };
  const S = { type: 'select', options: [{ value: false }, { value: true }] };
  const C = { type: 'coeffs', maxLen: 4 };

  // ACCEPTED: what a lecturer legitimately types, exponents and signs included
  for (const [spec, str, want] of [
    [N, '30', 30],
    [N, ' 7 ', 7],
    [A, '0.5', 0.5],
    [A, '.5', 0.5],
    [A, '+1.5', 1.5],
    [SNR, '1e-3', 1e-3],
    [B, 'true', true],
    [B, 'false', false],
    [S, 'false', false],
  ]) {
    const got = castParam(spec, str);
    if (got !== want) bad.push(`'${str}' → ${JSON.stringify(got)}, expected ${want}`);
  }
  const coeffs = castParam(C, '1,-2.5,1e2');
  if (String(coeffs) !== '1,-2.5,100') bad.push(`coeffs '1,-2.5,1e2' → ${coeffs}`);

  // REJECTED: everything else falls back to the default (undefined), and the
  // first three are the regressions this check exists for
  for (const [spec, str] of [
    [N, '12abc'],
    [A, '0.5abc'],
    [A, '0x10'],
    [N, ''],
    [A, ''],
    [A, 'Infinity'],
    [A, 'NaN'],
    [N, '30.7'],
    [N, '1'], // below min
    [A, '9'], // above max
    [B, 'TRUE'],
    [B, '1'],
    [S, 'maybe'],
    [C, '1,,2'],
    [C, '1,0x10'],
    [C, '1,2,3,4,5'], // longer than maxLen
  ]) {
    const got = castParam(spec, str);
    if (got !== undefined) bad.push(`'${str}' → ${JSON.stringify(got)}, expected fallback`);
  }

  // EMBED rides the query like drawer, in both directions
  {
    const m2 = { params: {}, presets: [], views: [{ id: 'v' }] };
    const dec = decodeQuery({ embed: '1' }, m2);
    if (dec.embed !== true) bad.push(`decodeQuery embed=1 → ${JSON.stringify(dec.embed)}, expected true`);
    const rej = decodeQuery({ embed: '2' }, m2);
    if ('embed' in rej) bad.push(`decodeQuery embed=2 accepted — only '1' is the flag`);
    const eh = encodeHash('a/b', {
      params: {}, base: {}, paramSpecs: {}, view: 'v', defaultView: 'v', embed: true,
    });
    if (eh !== '#/a/b?embed=1') bad.push(`encodeHash embed → '${eh}'`);
  }

  // PATCH: add, replace, drop — path and neighbours untouched, position-blind.
  // The embed chip and the embed mint both lean on this; a regex there once
  // depended on where the encoder put the parameter.
  for (const [hash, patch, want] of [
    ['#/a/b?N=30', { embed: '1' }, '#/a/b?N=30&embed=1'],
    ['#/a/b?embed=1&N=30', { embed: null }, '#/a/b?N=30'],
    ['#/a/b?N=30&embed=1', { embed: null }, '#/a/b?N=30'],
    ['#/a/b?embed=1', { embed: null }, '#/a/b'],
    ['#/a/b', { embed: null }, '#/a/b'],
    ['#/a/b?drawer=1&N=2', { embed: '1', drawer: null }, '#/a/b?N=2&embed=1'],
  ]) {
    const got = patchHashQuery(hash, patch);
    if (got !== want) bad.push(`patch ${hash} ${JSON.stringify(patch)} → '${got}', expected '${want}'`);
  }

  // NEVER THROWS: a truncated or mangled hash is a state, not a crash
  for (const h of ['', '#', '#/', '#/a/b?', '#/a/b?=&&x', '#/a/b?N=%E0%A4%A', '#///']) {
    try {
      parseHash(h);
    } catch (e) {
      bad.push(`parseHash('${h}') threw ${e.message}`);
    }
  }

  // encode → decode = identity, on every type at once
  const specs = { N, A, SNR, B, S, C };
  const params = { N: 30, A: 0.3, SNR: 0.001, B: true, S: false, C: [1, -2.5] };
  const manifest = {
    params: specs,
    presets: [{ id: 'scene-2' }],
    views: [{ id: 'time' }, { id: 'spectrum' }],
  };
  const hash = encodeHash('stats/demo', {
    params,
    base: {}, // nothing equals its base, so every param is serialized
    paramSpecs: specs,
    view: 'spectrum',
    defaultView: 'time',
    preset: 'scene-2',
    defaultPreset: 'scene-1',
    drawer: true,
    defaultDrawer: false,
  });
  const { path, query } = parseHash(hash);
  if (path !== 'stats/demo') bad.push(`round trip: path '${path}'`);
  const back = decodeQuery(query, manifest);
  for (const k of Object.keys(params)) {
    const a = String(params[k]);
    const b = String(back.params[k]);
    if (a !== b) bad.push(`round trip ${k}: ${a} → ${b}`);
  }
  if (back.view !== 'spectrum') bad.push(`round trip view: ${back.view}`);
  if (back.preset !== 'scene-2') bad.push(`round trip preset: ${back.preset}`);
  if (back.drawer !== true) bad.push(`round trip drawer: ${back.drawer}`);

  // and a hash pointing at a view/preset that no longer exists is dropped,
  // not carried into the app as a dangling id
  const stale = decodeQuery({ view: 'gone', preset: 'gone' }, manifest);
  if ('view' in stale || 'preset' in stale) bad.push('stale view/preset survived decode');

  report('url', bad, 'strict casts, fallback on anything unparsable, parseHash never throws, encode∘decode = id, embed and patch round-trip');
}

/**
 * The catalogue's ORDER, checked rather than trusted.
 *
 * `order` is what makes the sidebar and the palette read a subject in the
 * order the course meets its demos, and it is the one declarative key with no
 * validation anywhere: fields, views, figures and scenes all throw at load
 * time, `order` was a bare number nobody looked at. Two experiments claiming
 * rank 2 do not fail — they sort by whatever the engine happens to do, which
 * is exactly the failure the project refuses elsewhere ("a typo is caught at
 * load time, never silently ignored"). This check exists because the ML
 * subject had shipped with two 1s and two 2s.
 *
 * An ABSENT order stays legal, and deliberately so (CLAUDE.md: the experiment
 * lands at the end of its subject, alphabetically, so adding one modifies
 * nothing else). What is refused is a declared rank that is not a positive
 * integer, and two siblings claiming the same one.
 */
function checkOrdering(subjectRanks, expRanks) {
  const bad = [];
  const scan = (label, entries) => {
    const seen = new Map();
    for (const [name, order] of entries) {
      if (order === undefined) continue;
      if (!Number.isInteger(order) || order < 1) {
        bad.push(`${label}${name}: order ${JSON.stringify(order)} is not a positive integer`);
        continue;
      }
      if (seen.has(order)) bad.push(`${label}{${seen.get(order)}, ${name}} both claim order ${order}`);
      else seen.set(order, name);
    }
  };
  scan('', subjectRanks);
  for (const [sub, entries] of expRanks) scan(`${sub}/`, entries);

  const n = [...expRanks.values()].reduce((s, e) => s + e.length, 0);
  report(
    'order',
    bad,
    `every declared rank is unique inside its subject  ${dim(`(${subjectRanks.length} subjects, ${n} experiments)`)}`
  );
}

async function checkCatalogue() {
  console.log(bold('catalogue'));
  checkLayering();
  checkSourceLinks();
  checkAxesMargin();
  checkCssTokens();
  checkRandomness();
  checkDsp();
  checkLinalg();
  checkMedian();
  checkRouter();
  console.log(`  ${dim('vocabulary')}`);
  let figuresOk = true;
  let scenesOk = true;
  const axisBad = [];
  const legendBad = [];
  let nViews = 0;
  let nScenes = 0;
  const subjectRanks = [];
  const expRanks = new Map();
  const visible = []; // every string a listener can read, for the language check
  const paramNames = [];
  for (const sub of readdirSync(ROOT, { withFileTypes: true })) {
    if (!sub.isDirectory()) continue;
    const dir = join(ROOT, sub.name);
    const subjectFile = join(dir, '_subject.js');
    const subject = existsSync(subjectFile)
      ? (await import(pathToFileURL(subjectFile).href)).default
      : {};
    subjectRanks.push([sub.name, subject.order]);
    expRanks.set(sub.name, []);
    for (const exp of readdirSync(dir, { withFileTypes: true })) {
      const mf = join(dir, exp.name, 'manifest.js');
      if (!exp.isDirectory() || !existsSync(mf)) continue;
      const key = `${sub.name}/${exp.name}`;
      let views;
      let manifest;
      try {
        manifest = (await import(pathToFileURL(mf).href)).default;
        views = normalizeViews(manifest.views, subject, key);
        nViews += views.length;
      } catch (err) {
        figuresOk = false;
        console.log(`    ${red('✗')} ${err.message}`);
        continue;
      }
      checkAxisLabels(manifest, key, axisBad);
      checkLegends(manifest, key, legendBad);
      expRanks.get(sub.name).push([exp.name, manifest.order]);
      visible.push([key, manifest.title ?? ''], [key, manifest.subtitle ?? ''], [key, manifest.doc ?? '']);
      for (const [pk, p] of Object.entries(manifest.params ?? {})) {
        if (p.name) paramNames.push([`${key}.${pk}`, String(p.name)]);
        if (p.description) visible.push([`${key}.${pk}`, p.description]);
        for (const o of p.options ?? []) if (o.label) visible.push([`${key}.${pk}`, String(o.label)]);
      }
      for (const v of views) if (v.title) visible.push([`${key}/${v.id}`, v.title]);
      // axes and legend labels are projected text too — the French axes of
      // one spectrum view survived every sweep because nothing harvested them
      for (const v of manifest.views ?? []) {
        const axis = (a, w) => {
          const s = typeof a === 'string' ? a : a?.label;
          if (s) visible.push([w, s]);
        };
        const layerText = (l, w) => {
          if (l?.label) visible.push([w, String(l.label)]);
          axis(l?.axes?.x, w);
          axis(l?.axes?.y, w);
        };
        const w = `${key}/${v.id ?? v.figure}`;
        if (v.kind === 'plot') {
          layerText(v.spec, w);
          for (const o of v.spec.overlays ?? []) layerText(o, w);
        } else if (v.kind === 'plane') {
          axis(v.spec.axes?.x, w);
          axis(v.spec.axes?.y, w);
          for (const c of [...(v.spec.clouds ?? []), ...(v.spec.curves ?? [])]) layerText(c, w);
          if (v.spec.markers) layerText(v.spec.markers, w);
        } else if (v.kind === 'stack') {
          axis(v.spec.axes?.x, w);
          for (const pnl of v.spec.panels ?? []) layerText(pnl, w);
          for (const o of v.spec.overlays ?? []) layerText(o, w);
        }
      }
      // `derived` readings are FUNCTIONS, so their text only exists once
      // evaluated — which is how a drawer reading "oui (L_cp ≥ L−1)" survived
      // the conversion and this check's first version alike. Evaluated here on
      // the manifest's own defaults, and on their negations where the value is
      // a boolean-ish choice, so both branches of a ternary are seen.
      const defaults = {};
      for (const [pk, p] of Object.entries(manifest.params ?? {})) defaults[pk] = p.default;
      for (const [dk, d] of Object.entries(manifest.derived ?? {})) {
        if (d.label) visible.push([`${key}.${dk}`, d.label]);
        for (const probe of [defaults, ...Object.keys(defaults).map((pk) => ({
          ...defaults,
          [pk]: typeof defaults[pk] === 'number' ? defaults[pk] * 3 + 1 : defaults[pk],
        }))]) {
          try {
            const out = d.calc?.(probe);
            if (typeof out === 'string') visible.push([`${key}.${dk}`, out]);
          } catch {
            /* a derived that throws on a probed value is not this check's business */
          }
        }
      }
      // THE STATLINE. An observable's `meta.label` and `meta.unit` are read by
      // the room off the bottom of every plot, and until now nothing looked at
      // them: they live in compute.js, which this walk never opened, so "SER
      // empirique" and "ouverture de l'œil" sat under the figures through two
      // language passes. A `text` observable — a regime name, a verdict — is
      // the same reading and is harvested with them, by its VALUE.
      //
      // One compute per experiment, on the manifest's defaults. Cheap next to
      // the checks that follow, and it is the only way to see a string that
      // does not exist until the science has run.
      const cf = join(dir, exp.name, 'compute.js');
      if (existsSync(cf)) {
        try {
          const { compute } = await import(pathToFileURL(cf).href);
          const obs = compute({ seed: 34, ...defaults })?.observables ?? {};
          for (const [ok, o] of Object.entries(obs)) {
            if (typeof o === 'string') visible.push([`${key}:${ok}`, o]);
            if (o === null || typeof o !== 'object') continue;
            if (typeof o.value === 'string') visible.push([`${key}:${ok}`, o.value]);
            for (const f of ['label', 'unit'])
              if (typeof o.meta?.[f] === 'string') visible.push([`${key}:${ok}.${f}`, o.meta[f]]);
          }
        } catch {
          /* a compute that will not run on its own defaults is a different
             failure, and the experiment's own checks are where it belongs */
        }
      }

      const sf = join(dir, exp.name, 'scenes.js');
      if (!existsSync(sf)) continue;
      const scenes = (await import(pathToFileURL(sf).href)).default ?? [];
      try {
        validateSceneIds(scenes, key);
      } catch (err) {
        scenesOk = false;
        console.log(`    ${red('✗')} ${err.message}`);
      }
      for (const [i, sc] of scenes.entries()) {
        nScenes++;
        visible.push([`${key}#${sc.id}`, sc.title ?? '']);
        try {
          validateScene(sc, i, { views, params: manifest.params, random: manifest.random }, key);
        } catch (err) {
          scenesOk = false;
          console.log(`    ${red('✗')} ${err.message}`);
        }
      }
    }
  }
  if (figuresOk)
    console.log(`    ${green('✓')} standard figures: id, title and order  ${dim(`(${nViews} views)`)}`);
  checkOrdering(subjectRanks, expRanks);
  checkLanguage(visible.filter(([, s]) => s), paramNames);
  report('axes', axisBad, 'every declarative axis carries a name');
  report('legends', legendBad, 'every multi-series view names each visual identity', { cap: 40 });
  console.log(`  ${dim('scenes')}`);
  if (scenesOk)
    console.log(
      `    ${green('✓')} keys, types, view and param references  ${dim(`(${nScenes} scenes)`)}`
    );
  figuresOk ? pass++ : fail++;
  scenesOk ? pass++ : fail++;
  console.log('');
}

await checkCatalogue();

const files = findChecks(ROOT);

if (files.length === 0) {
  console.error('no check.js found under src/experiments/');
  process.exit(1);
}

for (const file of files) {
  const relKey = file.slice(ROOT.length + 1).split(sep).slice(0, -1).join('/');
  console.log(`\n${bold(relKey)}`);
  let checks;
  try {
    ({ checks } = await import(pathToFileURL(file).href));
  } catch (err) {
    console.log(`  ${red('✗')} failed to load: ${err.message}`);
    fail++;
    continue;
  }
  const byCategory = new Map();
  for (const c of checks ?? []) {
    const cat = c.category ?? 'numeric';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(c);
  }
  for (const [category, list] of byCategory) {
    console.log(`  ${dim(category)}`);
    for (const c of list) {
      const t0 = performance.now();
      let res;
      try {
        res = c.run();
      } catch (err) {
        res = { ok: false, detail: String(err?.message ?? err) };
      }
      const ms = (performance.now() - t0).toFixed(1);
      res.ok ? pass++ : fail++;
      const mark = res.ok ? green('✓') : red('✗');
      console.log(`    ${mark} ${c.name}  ${dim(`${res.detail ?? ''}  (${ms} ms)`)}`);
    }
  }
}

console.log(`\n${pass} passed, ${fail === 0 ? '0 failed' : red(`${fail} failed`)}`);
process.exit(fail ? 1 : 0);
