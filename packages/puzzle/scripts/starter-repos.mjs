#!/usr/bin/env node
// Writes the starter repos in REPOS (magic-spells/<repo>) from the starters
// this CLI embeds (`npm run starter-repos`). Each folder is what
// `puzzle init <repo> --template <name> --typescript=<bool> --yes` writes plus
// this package's MIT LICENSE.txt, and nothing else: no host config, since a
// clone can deploy anywhere and its README names `npx puzzle add deploy`. The
// licence is added here, not in starters/, because an app made with `puzzle
// init` is its owner's to license. The repos are output: nobody edits them by
// hand. Change starters/ here, and run this after a release is published.
//
//   node scripts/starter-repos.mjs [--bin <puzzle>] [--out <dir>] [--push]
//
//   --bin   the CLI to run (default: this checkout's, through `go run`)
//   --out   where to write the folders (default: a new temp folder)
//   --push  commit each folder on top of its repo's main branch as
//           "puzzle <version>", replacing the old files, and push it. Without
//           it nothing leaves the machine: the script says what it would push.

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const REPOS = [
	{ repo: 'puzzle-starter', template: 'default', typescript: false },
	{ repo: 'puzzle-starter-ts', template: 'default', typescript: true },
	{ repo: 'puzzle-starter-static', template: 'static', typescript: false },
	{ repo: 'puzzle-starter-static-ts', template: 'static', typescript: true },
];

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
	options: { bin: { type: 'string' }, out: { type: 'string' }, push: { type: 'boolean' } },
});
const out = resolve(values.out ?? mkdtempSync(join(tmpdir(), 'puzzle-starters-')));

// runs a command and returns its trimmed stdout; stderr goes to the terminal
const run = (cmd, args, cwd) =>
	execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const puzzle = (...args) =>
	values.bin
		? run(resolve(values.bin), args)
		: run('go', ['run', './compiler/cmd/puzzle', ...args], repoRoot);

const version = puzzle('version').split(' ').pop();

for (const { repo, template, typescript } of REPOS) {
	const dir = join(out, repo);
	puzzle('init', dir, '--template', template, `--typescript=${typescript}`, '--yes');
	copyFileSync(join(repoRoot, 'LICENSE.txt'), join(dir, 'LICENSE.txt'));
	console.log(`wrote ${dir} (puzzle ${version})`);
}

for (const { repo } of REPOS) {
	const dir = join(out, repo);
	const url = `https://github.com/magic-spells/${repo}`;
	if (!values.push) {
		console.log(`would push ${dir} to ${url} (main) as "puzzle ${version}"`);
		continue;
	}
	const git = (...args) => run('git', args, dir);
	git('init', '-q', '-b', 'main');
	// the new files go on top of the repo's history, replacing the old ones
	if (git('ls-remote', '--heads', url, 'main')) {
		git('fetch', '-q', url, 'main');
		git('reset', '-q', '--soft', 'FETCH_HEAD');
	}
	git('add', '-A');
	if (!git('status', '--porcelain')) {
		console.log(`${url} already has puzzle ${version}`);
		continue;
	}
	git('commit', '-q', '-m', `puzzle ${version}`);
	git('push', '-q', url, 'main');
	console.log(`pushed ${url} (puzzle ${version})`);
}
