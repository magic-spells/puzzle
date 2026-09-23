import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Static guards for the two CSS-animated loading pieces, spinner and
// shimmer-text. The motion itself is keyframes in each file's <style> block and
// is judged by eye in the docs site; what can regress here is the contract
// around it — the manifests, the demo copies, the ring staying byte-stable for
// existing callers, the accessible root, and "CSS only, reduced motion covered".

const readText = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const readJSON = async (path) => JSON.parse(await readText(path));

const PIECES = [
  { name: 'spinner', file: 'Spinner.pzl' },
  { name: 'shimmer-text', file: 'ShimmerText.pzl' },
];

const style = (source) => source.slice(source.indexOf('\n<style>'));
const script = (source) => source.slice(source.indexOf('<script>'), source.indexOf('</script>'));

for (const { name, file } of PIECES) {
  const src = `../registry/ui/${name}/${file}`;

  test(`${name}: manifest, registry.json row and demo copy agree`, async () => {
    const [piece, registry, source, copy] = await Promise.all([
      readJSON(`../registry/ui/${name}/piece.json`),
      readJSON('../registry/registry.json'),
      readText(src),
      readText(`../demo/app/components/ui/${file}`),
    ]);
    assert.deepEqual(piece.files, [file]);
    assert.deepEqual(piece.registryDependencies, []);
    assert.deepEqual(piece.dependencies, []);
    const row = registry.pieces.find((p) => p.name === name);
    assert.deepEqual(row, piece, `registry.json's ${name} row has drifted from piece.json`);
    assert.equal(copy, source, `demo/app/components/ui/${file} has drifted`);
  });

  test(`${name}: animation is CSS only`, async () => {
    const source = await readText(src);
    for (const js of ['requestAnimationFrame', 'setTimeout', 'setInterval', '.animate(', 'customElements']) {
      assert.equal(source.includes(js), false, `${file} uses ${js}`);
    }
    assert.match(source, /@keyframes /);
  });

  test(`${name}: the <style> block sits in layer(components) and covers reduced motion`, async () => {
    const css = style(await readText(src));
    assert.match(css, /@layer components \{/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    // every class the block animates is stopped again under reduced motion
    const at = css.indexOf('@media (prefers-reduced-motion: reduce)');
    const reduced = css.slice(at);
    const animated = [...css.slice(0, at).matchAll(/\.([a-z-]+) \{([^{}]*)\}/g)]
      .filter((m) => /\banimation\s*:/.test(m[2]))
      .map((m) => m[1]);
    assert.ok(animated.length > 0);
    for (const cls of animated) {
      assert.match(reduced, new RegExp(`\\.${cls}\\b`), `.${cls} keeps moving under reduced motion`);
    }
  });

  test(`${name}: tokens only — no hex colours and no raw arbitrary-value classes`, async () => {
    const source = await readText(src);
    assert.equal(/#[0-9a-f]{3,8}\b/i.test(source), false, `${file} contains a hex colour`);
    assert.equal(/\b[a-z-]+-\[[^\]]+\]/.test(script(source)), false, `${file} uses an arbitrary-value class`);
    assert.match(source, /motion-reduce:animate-pulse/);
  });
}

test('spinner: ring is the default and keeps its original classes', async () => {
  const source = await readText('../registry/ui/spinner/Spinner.pzl');
  assert.match(source, /VARIANTS\.includes\(props\.variant\) \? props\.variant : 'ring'/);
  const ring = source.match(/const RING = '([^']+)';/)[1].split(' ');
  for (const cls of ['inline-block', 'animate-spin', 'rounded-full', 'border-2', 'border-border', 'border-t-brand']) {
    assert.ok(ring.includes(cls), `the ring lost ${cls}`);
  }
  assert.match(source, /const SIZE = \{ sm: 'size-4', md: 'size-6', lg: 'size-10' \};/);
});

test('spinner: one role=status root with the label; every inner part is aria-hidden', async () => {
  const source = await readText('../registry/ui/spinner/Spinner.pzl');
  const template = source.slice(0, source.indexOf('</puzzle-view>'));
  assert.match(template, /<puzzle-view>\n {2}<span class=\{ rootClass \} role="status" aria-label=\{ label \}>/);
  assert.match(source, /label: props\.label \|\| 'Loading'/);
  // the direct children of the root: each opening tag one indent in
  const parts = [...template.matchAll(/^ {6,8}<(span|svg)\b[^>]*>/gm)].map((m) => m[0]);
  assert.ok(parts.length >= 7);
  for (const tag of parts) assert.match(tag, /aria-hidden="true"/, `${tag.trim()} is not aria-hidden`);
  for (const variant of ['ticks', 'trace', 'dots', 'snap', 'spark', 'heartbeat']) {
    assert.match(template, new RegExp(`variant === '${variant}'`), `no ${variant} branch`);
  }
});

test('spinner: staggers come from a per-part --i, not a keyframe per part', async () => {
  const source = await readText('../registry/ui/spinner/Spinner.pzl');
  assert.match(source, /style: `--i:\$\{i\}`/);
  assert.match(style(source), /animation-delay: calc\(var\(--i\) \* -?\d+ms\)/);
});
