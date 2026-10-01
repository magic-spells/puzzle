import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Static guards for the hamburger piece. The motion is CSS transitions in the
// file's <style> block and is judged by eye in the docs site; what can regress
// here is the contract around it — manifest, demo copy, the accessible button
// root, and "CSS only, gated behind reduced motion and animate".

const readText = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const readJSON = async (path) => JSON.parse(await readText(path));

const SRC = '../registry/ui/hamburger/Hamburger.pzl';
const style = (source) => source.slice(source.indexOf('\n<style>'));
const script = (source) => source.slice(source.indexOf('<script>'), source.indexOf('</script>'));
const template = (source) => source.slice(0, source.indexOf('</puzzle-view>'));

test('hamburger: manifest, registry.json row and demo copy agree', async () => {
  const [piece, registry, source, copy] = await Promise.all([
    readJSON('../registry/ui/hamburger/piece.json'),
    readJSON('../registry/registry.json'),
    readText(SRC),
    readText('../demo/app/components/ui/Hamburger.pzl'),
  ]);
  assert.deepEqual(piece.files, ['Hamburger.pzl']);
  assert.deepEqual(piece.registryDependencies, []);
  assert.deepEqual(piece.dependencies, []);
  const row = registry.pieces.find((p) => p.name === 'hamburger');
  assert.deepEqual(row, piece, "registry.json's hamburger row has drifted from piece.json");
  assert.equal(copy, source, 'demo/app/components/ui/Hamburger.pzl has drifted');
});

test('hamburger: a real button root with string aria-expanded and three aria-hidden bars', async () => {
  const source = await readText(SRC);
  const markup = template(source);
  assert.match(markup, /<puzzle-view>\n {2}<button\n {4}type="button"/);
  assert.match(markup, /aria-expanded=\{ expandedAttr \}/);
  assert.match(source, /expandedAttr: open \? 'true' : 'false'/);
  const bars = [...markup.matchAll(/<span\b[^>]*>/g)].map((m) => m[0]);
  assert.equal(bars.length, 3);
  for (const bar of bars) assert.match(bar, /aria-hidden="true"/);
  // sibling spans, never pseudo-elements
  assert.equal(/::?(before|after)\b/.test(style(source)), false);
});

test('hamburger: optional-controlled — `open` detection, @change is not a prop name', async () => {
  const source = await readText(SRC);
  assert.match(source, /this\.props\.open !== undefined/);
  assert.match(source, /change\(next, event\)/);
});

test('hamburger: motion is CSS transitions on translate/rotate, gated on no-preference and animate', async () => {
  const source = await readText(SRC);
  for (const js of ['requestAnimationFrame', 'setTimeout', 'setInterval', '.animate(', 'customElements']) {
    assert.equal(source.includes(js), false, `Hamburger.pzl uses ${js}`);
  }
  const css = style(source);
  assert.match(css, /@layer components \{/);
  assert.equal(/\btransform\s*:/.test(css), false, 'bars must move with translate/rotate, not transform');
  // every transition lives inside the no-preference block, keyed on data-animate
  const at = css.indexOf('@media (prefers-reduced-motion: no-preference)');
  assert.ok(at > 0);
  assert.equal(/\btransition[a-z-]*\s*:/.test(css.slice(0, at)), false, 'a transition sits outside the motion gate');
  for (const m of css.slice(at).matchAll(/([^{}]+)\{[^{}]*\btransition[a-z-]*\s*:/g)) {
    assert.match(m[1], /\[data-animate='true'\]/);
  }
});

test('hamburger: tokens only — no hex colours and no raw arbitrary-value classes', async () => {
  const source = await readText(SRC);
  assert.equal(/#[0-9a-f]{3,8}\b/i.test(source), false, 'Hamburger.pzl contains a hex colour');
  assert.equal(/\b[a-z-]+-\[[^\]]+\]/.test(script(source)), false, 'Hamburger.pzl uses an arbitrary-value class');
});
