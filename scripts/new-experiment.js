#!/usr/bin/env node
// npm run new:experiment — interactive scaffold. Writes the four canonical
// files (manifest.js, scenes.js, compute.js, check.js) so the experiment
// appears in the sidebar and runs immediately, before any domain code.
// Modifies no existing file. No dependencies beyond node built-ins.

import { readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import readline from 'node:readline/promises';

const EXP_ROOT = resolve(process.cwd(), 'src/experiments');

// Interactive on a TTY; consumes piped lines otherwise (scriptable/CI-safe).
async function makeAsker() {
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return {
      ask: async (q, fallback = '') => (await rl.question(q)).trim() || fallback,
      close: () => rl.close(),
    };
  }
  const raw = await new Promise((res) => {
    let data = '';
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => res(data));
  });
  const lines = raw.split('\n');
  let i = 0;
  return {
    ask: async (q, fallback = '') => {
      const v = (lines[i++] ?? '').trim();
      console.log(q + v);
      return v || fallback;
    },
    close: () => {},
  };
}

const { ask, close } = await makeAsker();

const subjects = readdirSync(EXP_ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

console.log(`Existing subjects: ${subjects.join(', ')}`);
const subject = await ask('Subject (existing or new): ');
const id = await ask('Experiment id (kebab-case): ');
const title = await ask('Title (course language): ', id);
const template = await ask('Template [monte-carlo | parametric-curve] (monte-carlo): ', 'monte-carlo');
close();

if (!/^[a-z][a-z0-9-]*$/.test(subject) || !/^[a-z][a-z0-9-]*$/.test(id)) {
  console.error('subject and id must be kebab-case ([a-z0-9-])');
  process.exit(1);
}
if (!['monte-carlo', 'parametric-curve'].includes(template)) {
  console.error(`unknown template '${template}'`);
  process.exit(1);
}

const dir = join(EXP_ROOT, subject, id);
if (existsSync(dir)) {
  console.error(`${dir} already exists`);
  process.exit(1);
}

if (!subjects.includes(subject)) {
  mkdirSync(join(EXP_ROOT, subject), { recursive: true });
  writeFileSync(
    join(EXP_ROOT, subject, '_subject.js'),
    `export default { title: '${subject}', order: 99 };\n`
  );
  console.log(`created subject '${subject}' — edit its _subject.js title/order`);
}
mkdirSync(dir, { recursive: true });

const isMc = template === 'monte-carlo';

const manifest = isMc
  ? `import { int, float } from '../../../core/fields.js';
import { view, histogram, vline } from '../../../core/views.js';

/** @type {import('../../../core/types').ExperimentManifest} */
export default {
  id: '${id}',
  // this template draws: the seed, the dice and R exist because of this line
  random: true,
  title: '${title}',
  subtitle: 'TODO — one line about the experiment',
  tags: [],

  doc: \`TODO — what the experiment demonstrates, in prose, for the info
panel (I). Two to four paragraphs separated by blank lines; keep the measured
numbers, drop the stage directions.\`,

  params: {
    N: int('N', { description: 'number of realizations', min: 10, max: 5000, step: 10, default: 500 }),
    mu: float('μ', { description: 'mean', min: -3, max: 3, step: 0.1, default: 0 }),
    // seed is injected by the core, because of random: true above
  },

  views: [
    view(
      'histogram',
      'Histogram',
      histogram('values', {
        overlays: [vline('mu', { color: '#EDB120', dashed: true, label: 'μ' })],
        axes: { x: 'x', y: 'density' },
      })
    ),
  ],
};
`
  : `import { float } from '../../../core/fields.js';
import { view, line } from '../../../core/views.js';

/** @type {import('../../../core/types').ExperimentManifest} */
export default {
  id: '${id}',
  title: '${title}',
  subtitle: 'TODO — one line about the experiment',
  tags: [],

  doc: \`TODO — what the experiment demonstrates, in prose, for the info
panel (I). Two to four paragraphs separated by blank lines; keep the measured
numbers, drop the stage directions.\`,

  params: {
    a: float('a', { description: 'parameter of the curve', min: 0.5, max: 5, step: 0.1, default: 2 }),
    // no random: true — this template draws nothing, so it gets no seed,
    // no dice button and no ?seed= in its URL
  },

  views: [
    view('curve', 'Curve', line('curve', { axes: { x: 'x', y: 'y' } })),
  ],
};
`;

const scenes = `// Lecture script. Auto-discovered by the registry.
export default [
  {
    id: 'scene-1',
    title: 'Scene 1 — TODO',
    params: {},
    visible: ['${isMc ? 'N' : 'a'}'],
  },
];
`;

const compute = isMc
  ? `// TODO — replace the dummy draw with the experiment's science.
// PURE, stateless, seeded — runs in a worker; deterministic at fixed seed.
import { mulberry32, gaussFrom } from '../../../core/rng.js';
import { mean } from '../../../core/numeric.js';

/** @param {{N: number, mu: number, seed: number}} params */
export function compute({ N, mu, seed }) {
  const gauss = gaussFrom(mulberry32(seed));
  const values = new Float64Array(N);
  for (let i = 0; i < N; i++) values[i] = mu + gauss();
  return {
    observables: {
      values,
      xbar: { value: mean(values), meta: { label: 'x̄', precision: 3 } },
    },
  };
}
`
  : `// TODO — replace the dummy curve with the experiment's science.
// PURE and stateless — runs in a worker. Fully deterministic: no generator,
// hence no 'random: true' in the manifest and no seed in the signature.

/** @param {{a: number}} params */
export function compute({ a }) {
  const ng = 201;
  const x = new Float64Array(ng);
  const y = new Float64Array(ng);
  for (let i = 0; i < ng; i++) {
    x[i] = i / (ng - 1);
    y[i] = Math.sin(2 * Math.PI * a * x[i]);
  }
  return {
    observables: {
      curve: { x, y },
      peak: { value: 1, meta: { label: 'max', precision: 2 } },
    },
  };
}
`;

const check = isMc
  ? `import { compute } from './compute.js';
import { standardChecks } from '../../../core/checks.js';

const BASE = { N: 500, mu: 0, seed: 1 };

export const checks = [
  {
    name: 'empirical mean ≈ μ',
    category: 'statistical',
    run() {
      const { observables: o } = compute({ ...BASE });
      const err = Math.abs(o.xbar.value - BASE.mu);
      const tol = 4 / Math.sqrt(BASE.N);
      return { ok: err < tol, detail: \`|x̄−μ|=\${err.toFixed(4)} < \${tol.toFixed(4)}\` };
    },
  },
  standardChecks.determinism(compute, { ...BASE }, 'values'),
];
`
  : `import { compute } from './compute.js';
import { standardChecks } from '../../../core/checks.js';

const BASE = { a: 2 };

export const checks = [
  {
    name: 'curve value at x = 0 is exactly 0',
    category: 'numeric',
    run() {
      const { observables: o } = compute({ ...BASE });
      return { ok: Math.abs(o.curve.y[0]) < 1e-12, detail: \`y(0)=\${o.curve.y[0]}\` };
    },
  },
  standardChecks.determinism(compute, { ...BASE }, 'curve'),
];
`;

writeFileSync(join(dir, 'manifest.js'), manifest);
writeFileSync(join(dir, 'scenes.js'), scenes);
writeFileSync(join(dir, 'compute.js'), compute);
writeFileSync(join(dir, 'check.js'), check);

console.log(`
created src/experiments/${subject}/${id}/
  manifest.js  scenes.js  compute.js  check.js

next steps:
  npm run dev     → the experiment is already in the sidebar and runs
  npm run check   → its checks already pass
  then replace the TODOs with the actual science.`);
