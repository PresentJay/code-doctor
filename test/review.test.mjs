import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyPlan, captureReview, recordFeedback, validateReview } from '../src/review.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
async function fixture(t, message = 'Initial fixture') {
  const cwd = await mkdtemp(path.join(tmpdir(), 'code-doctor-test-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  git(cwd, 'init', '-q');
  git(cwd, 'config', 'user.name', 'Code Doctor Test');
  git(cwd, 'config', 'user.email', 'test@example.invalid');
  await writeFile(path.join(cwd, '.gitignore'), '.code-doctor/\nignored.txt\n');
  await writeFile(path.join(cwd, 'tracked.txt'), 'original\n');
  await writeFile(path.join(cwd, 'delete.txt'), 'delete me\n');
  await writeFile(path.join(cwd, 'rename.txt'), 'rename me\n');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-qm', message);
  return cwd;
}

test('file-type replacements retain both sides and neighboring changes in index and worktree', async t => {
  for (const direction of ['file-to-link', 'link-to-file']) for (const stage of ['index', 'worktree']) {
    await t.test(`${direction} ${stage}`, async t => {
      const cwd = await fixture(t);
      const target = path.join(cwd, 'tracked.txt');
      if (direction === 'link-to-file') {
        await rm(target); await symlink('rename.txt', target);
        git(cwd, 'add', '.'); git(cwd, 'commit', '-qm', 'original link');
      }
      await rm(target);
      if (direction === 'file-to-link') await symlink('rename.txt', target);
      else await writeFile(target, 'replacement\n');
      await writeFile(path.join(cwd, 'delete.txt'), 'neighbor\n');
      if (stage === 'index') git(cwd, 'add', '.');
      const review = await captureReview({cwd});
      assert.equal(validateReview(review).valid, true);
      const sides = review.units.filter(unit => unit.file === 'tracked.txt');
      assert.deepEqual(sides.map(unit => unit.status), ['D', 'A']);
      assert.ok(sides.every(unit => unit.stage === stage));
      const [oldMode, newMode] = direction === 'file-to-link' ? ['100644','120000'] : ['120000','100644'];
      assert.deepEqual(sides.map(unit => [unit.oldMode, unit.newMode]), [[oldMode,'000000'],['000000',newMode]]);
      assert.match(sides[0].patch, direction === 'file-to-link' ? /-original/ : /-rename.txt/);
      assert.match(sides[1].patch, direction === 'file-to-link' ? /\+rename.txt/ : /\+replacement/);
      assert.match(review.units.find(unit => unit.file === 'delete.txt').patch, /\+neighbor/);
      assert.deepEqual(review.blocks.flatMap(block => block.unitIds).sort(), review.units.map(unit => unit.id).sort());
    });
  }
});

test('captures staged, unstaged, cancelled staged, renamed, deleted, binary, and untracked files without ignored artifacts', async t => {
  const cwd = await fixture(t);
  await writeFile(path.join(cwd, 'tracked.txt'), 'staged\n');
  await rename(path.join(cwd, 'rename.txt'), path.join(cwd, 'renamed.txt'));
  await rm(path.join(cwd, 'delete.txt'));
  git(cwd, 'add', '-A');
  await writeFile(path.join(cwd, 'tracked.txt'), 'original\n');
  await writeFile(path.join(cwd, 'new\tfile.txt'), 'new\n');
  await writeFile(path.join(cwd, '-option.txt'), 'not an option\n');
  await writeFile(path.join(cwd, 'empty.txt'), '');
  await writeFile(path.join(cwd, 'binary.bin'), Buffer.from([0, 1, 255, 2]));
  await writeFile(path.join(cwd, 'ignored.txt'), 'do not include\n');
  await mkdir(path.join(cwd, '.code-doctor'));
  await writeFile(path.join(cwd, '.code-doctor', 'review.json'), '{}');
  const review = await captureReview({ cwd, task: 'Return an error', kind: 'fix', issue: '#12' });
  assert.equal(validateReview(review).valid, true);
  assert.deepEqual(review.task, { text: 'Return an error', kind: 'fix', issue: '#12' });
  assert.equal(review.units.length, 8);
  assert.equal(review.units.filter(unit => unit.file === 'tracked.txt').length, 2);
  const renamed = review.units.find(unit => unit.file === 'renamed.txt');
  assert.equal(renamed.previousFile, 'rename.txt');
  assert.match(renamed.patch, /rename from rename.txt\nrename to renamed.txt/);
  assert.equal(review.units.find(unit => unit.file === 'delete.txt').status, 'D');
  assert.equal(review.units.find(unit => unit.file === 'binary.bin').binary, true);
  assert.match(review.units.find(unit => unit.file === 'binary.bin').patch, /GIT binary patch/);
  assert.equal(review.units.some(unit => /ignored|code-doctor/.test(unit.file)), false);
  assert.equal((await captureReview({ cwd })).fingerprint, review.fingerprint);
});

test('a reading plan preserves all original sources and rejects omission, duplication, fabrication and source replacement', async t => {
  const cwd = await fixture(t);
  await writeFile(path.join(cwd, 'tracked.txt'), 'changed\n');
  await writeFile(path.join(cwd, 'extra.txt'), 'new\n');
  const review = await captureReview({ cwd });
  const blocks = [...review.blocks].reverse().map(block => ({ ...block, importance: 'high', comment: 'Explain why this is needed.' }));
  const planned = applyPlan(review, { summary: 'Read behavior before support code.', blocks });
  assert.deepEqual(planned.units, review.units);
  assert.equal(planned.fingerprint, review.fingerprint);
  assert.notEqual(planned.id, review.id);
  assert.notEqual(planned.blocks[0].id, review.blocks[0].id);
  assert.equal(review.blocks[0].importance, 'normal');
  assert.throws(() => applyPlan(review, { summary: '', blocks: blocks.slice(1) }), /Uncovered/);
  assert.throws(() => applyPlan(review, { summary: '', blocks: [...blocks, { ...blocks[0], id: 'duplicate' }] }), /more than once/);
  assert.throws(() => applyPlan(review, { summary: '', blocks: [{ ...blocks[0], unitIds: ['invented'] }] }), /Unknown/);
  assert.throws(() => applyPlan(review, { summary: '', blocks, units: [] }), /only replace/);
  const forged = structuredClone(review);
  forged.units[0].patch = 'fake code';
  assert.equal(validateReview(forged).valid, false);
  forged.units[0].file = '../outside';
  assert.match(validateReview(forged).errors.join(' '), /inside the repository/);
  assert.equal(validateReview(null).valid, false);
  assert.equal(validateReview({ units: [null], blocks: [null] }).valid, false);
  assert.equal(validateReview({ ...review, fingerprint: 42 }).valid, false);
  assert.match(validateReview({ ...planned, id: review.id }).errors.join(' '), /Review ID/);
});

test('separated renamed-file and worktree hunks reconstruct the full Git patches and cannot be partially assigned', async t => {
  const cwd = await fixture(t);
  const lines = Array.from({ length: 90 }, (_, index) => `line ${index + 1}`);
  await writeFile(path.join(cwd, 'tracked.txt'), lines.join('\n'));
  git(cwd, 'add', 'tracked.txt');
  git(cwd, 'commit', '-qm', 'Long text fixture');
  await rename(path.join(cwd, 'tracked.txt'), path.join(cwd, 'renamed-long.txt'));
  for (const index of [1, 43, 89]) lines[index] += ' staged';
  await writeFile(path.join(cwd, 'renamed-long.txt'), lines.join('\n'));
  git(cwd, 'add', '-A');
  for (const index of [2, 44, 89]) lines[index] += ' worktree';
  await writeFile(path.join(cwd, 'renamed-long.txt'), lines.join('\n'));
  const review = await captureReview({ cwd });
  assert.equal(review.units.length, 6);
  assert.equal(validateReview(review).valid, true);
  for (const stage of ['index', 'worktree']) {
    const units = review.units.filter(unit => unit.stage === stage);
    assert.equal(units.length, 3);
    const header = units[0].patch.slice(0, units[0].patch.search(/^@@ /m));
    assert.equal(header.startsWith(`diff --git a/${stage === 'index' ? 'tracked.txt' : 'renamed-long.txt'} b/renamed-long.txt\n`), true);
    if (stage === 'index') {
      assert.match(header, /rename from tracked.txt\nrename to renamed-long.txt/);
      assert.equal(units.every(unit => unit.previousFile === 'tracked.txt'), true);
    }
    let reconstructed = header;
    for (const [index, unit] of units.entries()) {
      assert.equal(unit.patch.startsWith(header), true);
      assert.equal([...unit.patch.matchAll(/^@@ /gm)].length, 1);
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/m.exec(unit.patch);
      assert.deepEqual(unit.hunk, {
        index: index + 1, total: 3,
        oldStart: Number(match[1]), oldCount: Number(match[2] ?? 1),
        newStart: Number(match[3]), newCount: Number(match[4] ?? 1),
      });
      reconstructed += unit.patch.slice(header.length);
    }
    const args = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--binary', '--full-index', '--src-prefix=a/', '--dst-prefix=b/', '--find-renames'];
    if (stage === 'index') args.push('--cached', 'HEAD');
    assert.equal(reconstructed, git(cwd, ...args, '--'));
    assert.match(reconstructed, /\\ No newline at end of file/);
    execFileSync('git', ['apply', '--check', '--reverse', ...(stage === 'index' ? ['--cached'] : []), '-'], { cwd, input: reconstructed });
  }
  const blocks = [{ ...review.blocks[0], unitIds: review.units.map(unit => unit.id) }];
  assert.equal(validateReview(applyPlan(review, { summary: 'All hunks in one block.', blocks })).valid, true);
  assert.throws(() => applyPlan(review, { summary: '', blocks: [{ ...blocks[0], unitIds: blocks[0].unitIds.slice(1) }] }), /Uncovered/);
  assert.throws(() => applyPlan(review, { summary: '', blocks: [{ ...blocks[0], unitIds: [...blocks[0].unitIds, blocks[0].unitIds[0]] }] }), /more than once/);
  const tampered = structuredClone(review);
  tampered.units[0].hunk.oldCount += 1;
  assert.match(validateReview(tampered).errors.join(' '), /Hunk metadata does not match/);
  assert.match(validateReview(tampered).errors.join(' '), /Source unit changed/);
  for (const hunk of [null, {}, { ...review.units[0].hunk, index: 0 }, { ...review.units[0].hunk, total: 0 }, { ...review.units[0].hunk, oldCount: 1.5 }, { ...review.units[0].hunk, newStart: '1' }, { ...review.units[0].hunk, extra: 1 }]) {
    const malformed = structuredClone(review);
    malformed.units[0].hunk = hunk;
    assert.match(validateReview(malformed).errors.join(' '), /Invalid hunk metadata/);
  }
  const stripped = structuredClone(review);
  delete stripped.units[0].hunk;
  assert.match(validateReview(stripped).errors.join(' '), /Source unit changed/);
  const missing = structuredClone(review);
  missing.units.splice(1, 1);
  assert.match(validateReview(missing).errors.join(' '), /Hunk inventory is incomplete/);
});

test('binary, rename-only, mode-only and empty changes retain complete units without hunk metadata', async t => {
  const cwd = await fixture(t);
  await rename(path.join(cwd, 'rename.txt'), path.join(cwd, 'renamed.txt'));
  await chmod(path.join(cwd, 'tracked.txt'), 0o755);
  git(cwd, 'add', '-A');
  await writeFile(path.join(cwd, 'empty.txt'), '');
  await writeFile(path.join(cwd, 'binary.bin'), Buffer.from([0, 255, 42]));
  const review = await captureReview({ cwd });
  assert.equal(review.units.length, 4);
  assert.equal(review.units.every(unit => unit.hunk === undefined), true);
  assert.match(review.units.find(unit => unit.file === 'renamed.txt').patch, /similarity index 100%/);
  const mode = review.units.find(unit => unit.file === 'tracked.txt');
  assert.equal(mode.oldMode, '100644');
  assert.equal(mode.newMode, '100755');
  assert.match(mode.patch, /old mode 100644\nnew mode 100755/);
  assert.equal(review.units.find(unit => unit.file === 'empty.txt').status, 'A');
  assert.match(review.units.find(unit => unit.file === 'binary.bin').patch, /GIT binary patch/);
  assert.equal(validateReview(review).valid, true);
});

test('task context is normalized, bound to review identity only, and preserved in feedback', async t => {
  const cwd = await fixture(t);
  await writeFile(path.join(cwd, 'tracked.txt'), 'changed\n');
  const marker = path.join(cwd, 'REFERENCE_MUST_NOT_EXECUTE');
  const context = {
    requirements: [' Keep the requested behavior. '],
    acceptanceCriteria: [' Reject the invalid request. '],
    references: [{ title: ' Issue ', source: ` $(touch ${marker}) `, revision: ' abc123 ' }],
  };
  const review = await captureReview({ cwd, context });
  const expected = {
    requirements: ['Keep the requested behavior.'], acceptanceCriteria: ['Reject the invalid request.'],
    references: [{ title: 'Issue', source: `$(touch ${marker})`, revision: 'abc123' }],
  };
  assert.deepEqual(review.task.context, expected);
  assert.equal((await captureReview({ cwd, context: expected })).id, review.id);
  const without = await captureReview({ cwd });
  assert.equal(Object.hasOwn(without.task, 'context'), false);
  assert.equal(without.fingerprint, review.fingerprint);
  assert.notEqual(without.id, review.id);
  const variants = [
    { ...expected, requirements: ['Different requirement'] },
    { ...expected, acceptanceCriteria: ['Different criterion'] },
    ...['title', 'source', 'revision'].map(key => ({ ...expected, references: [{ ...expected.references[0], [key]: 'Different reference' }] })),
  ];
  for (const variant of variants) {
    const next = await captureReview({ cwd, context: variant });
    assert.equal(next.fingerprint, review.fingerprint);
    assert.notEqual(next.id, review.id);
    assert.match(validateReview({ ...review, task: next.task }).errors.join(' '), /Review ID/);
  }
  context.requirements[0] = 'Mutated caller input';
  assert.deepEqual(review.task.context, expected);
  const opinion = await recordFeedback({ cwd, review, blockId: review.blocks[0].id, text: 'Keep the requested behavior.' });
  assert.deepEqual(opinion.task.context, expected);
  opinion.task.context.requirements[0] = 'Mutated opinion';
  assert.deepEqual(review.task.context, expected);
  assert.deepEqual((await captureReview({ cwd, context: {} })).task.context, { requirements: [], acceptanceCriteria: [], references: [] });
  await assert.rejects(access(marker), { code: 'ENOENT' });
});

test('context rejects malformed objects, arrays, references, blank strings and every exceeded bound', async t => {
  const cwd = await fixture(t);
  const review = await captureReview({ cwd });
  const invalid = [null, [], 'context', new Date(), { extra: [] }];
  for (const key of ['requirements', 'acceptanceCriteria', 'references']) {
    for (const value of [null, 'array', {}, Array(101).fill('item')]) invalid.push({ [key]: value });
  }
  for (const key of ['requirements', 'acceptanceCriteria']) {
    for (const value of [null, 42, '', '  ', 'nul\0text', 'x'.repeat(8001)]) invalid.push({ [key]: [value] });
    invalid.push({ [key]: Array(1) });
  }
  for (const item of [null, [], 'reference', {}, { title: 'Title', source: 'source', extra: 'x' }]) invalid.push({ references: [item] });
  for (const [key, max] of [['title', 500], ['source', 4000], ['revision', 500]]) {
    for (const value of [null, 42, '', '  ', 'nul\0text', 'x'.repeat(max + 1)]) {
      invalid.push({ references: [{ title: 'Title', source: 'source', [key]: value }] });
    }
  }
  for (const context of invalid) {
    await assert.rejects(captureReview({ cwd, context }), /context/i);
    assert.match(validateReview({ ...review, task: { ...review.task, context } }).errors.join(' '), /context/i);
  }
  const boundary = await captureReview({ cwd, context: {
    requirements: Array(100).fill('x'.repeat(8000)), acceptanceCriteria: Array(100).fill('y'.repeat(8000)),
    references: Array(100).fill({ title: 'x'.repeat(500), source: 'y'.repeat(4000), revision: 'z'.repeat(500) }),
  } });
  assert.equal(validateReview(boundary).valid, true);
  assert.match(validateReview({ ...boundary, task: { ...boundary.task, context: null } }).errors.join(' '), /context/);
});

test('block relations are optional, validate their vocabulary, and change review identity without source changes', async t => {
  const cwd = await fixture(t);
  await writeFile(path.join(cwd, 'tracked.txt'), 'changed\n');
  const review = await captureReview({ cwd });
  assert.equal(review.blocks[0].relation, 'unknown');
  const ids = new Set();
  for (const relation of ['requested', 'supporting', 'extra', 'unknown']) {
    const next = applyPlan(review, { summary: review.summary, blocks: [{ ...review.blocks[0], relation }] });
    assert.equal(next.fingerprint, review.fingerprint);
    assert.equal(validateReview(next).valid, true);
    ids.add(next.id);
  }
  assert.equal(ids.size, 4);
  for (const relation of [null, '', 'approve', 1, {}]) {
    assert.throws(() => applyPlan(review, { summary: review.summary, blocks: [{ ...review.blocks[0], relation }] }), /block relation/);
  }
  const block = { ...review.blocks[0] };
  delete block.relation;
  assert.equal(validateReview(applyPlan(review, { summary: review.summary, blocks: [block] })).valid, true);
});

test('existing schema1 reviews without context, relation or hunk fields retain their original identities', async t => {
  const cwd = await fixture(t);
  const lines = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`);
  await writeFile(path.join(cwd, 'tracked.txt'), lines.join('\n'));
  git(cwd, 'add', 'tracked.txt');
  git(cwd, 'commit', '-qm', 'Legacy long text fixture');
  lines[0] = 'first changed';
  lines[39] = 'last changed';
  await writeFile(path.join(cwd, 'tracked.txt'), lines.join('\n'));
  const review = await captureReview({ cwd });
  assert.equal(review.units.length, 2);
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const legacySource = unit => ({
    stage: unit.stage, file: unit.file, previousFile: unit.previousFile ?? null,
    status: unit.status, oldMode: unit.oldMode, newMode: unit.newMode, patch: unit.patch, binary: unit.binary,
  });
  const header = review.units[0].patch.slice(0, review.units[0].patch.search(/^@@ /m));
  review.units[0].patch = header + review.units.map(unit => unit.patch.slice(header.length)).join('');
  review.units = [review.units[0]];
  review.blocks = [review.blocks[0]];
  delete review.units[0].hunk;
  review.units[0].id = `u-${digest(legacySource(review.units[0])).slice(0, 24)}`;
  delete review.blocks[0].relation;
  review.blocks[0].unitIds = [review.units[0].id];
  review.fingerprint = digest({
    repoRoot: review.repoRoot, base: review.base, baseCommit: review.baseCommit,
    headCommit: review.headCommit, units: review.units.map(legacySource),
  });
  review.id = `review-${digest({
    schemaVersion: review.schemaVersion, fingerprint: review.fingerprint,
    task: { text: review.task.text, kind: review.task.kind, issue: review.task.issue },
    summary: review.summary,
    blocks: review.blocks.map(({ id, title, comment, importance, unitIds }) => ({ id, title, comment, importance, unitIds })),
  }).slice(0, 24)}`;
  assert.equal(validateReview(review).valid, true);
});

test('review IDs bind task and block assignments while feedback still checks the unchanged source fingerprint', async t => {
  const cwd = await fixture(t);
  await writeFile(path.join(cwd, 'tracked.txt'), 'changed\n');
  await writeFile(path.join(cwd, 'extra.txt'), 'new\n');
  const review = await captureReview({ cwd, task: 'First task' });
  const secondTask = await captureReview({ cwd, task: 'Different task' });
  assert.equal(secondTask.fingerprint, review.fingerprint);
  assert.notEqual(secondTask.id, review.id);
  assert.match(validateReview({ ...review, task: secondTask.task }).errors.join(' '), /Review ID/);
  const blocks = review.blocks.map((block, index) => ({ ...block, unitIds: review.blocks[1 - index].unitIds }));
  const planned = applyPlan(review, { summary: review.summary, blocks });
  assert.equal(planned.blocks[0].id, review.blocks[0].id);
  assert.notDeepEqual(planned.blocks[0].unitIds, review.blocks[0].unitIds);
  assert.equal(planned.fingerprint, review.fingerprint);
  assert.notEqual(planned.id, review.id);
  await assert.rejects(recordFeedback({ cwd, review: { ...planned, id: review.id }, blockId: planned.blocks[0].id, text: 'old review opinion' }), /Review ID/);
  const opinion = await recordFeedback({ cwd, review: planned, blockId: planned.blocks[0].id, text: 'new review opinion' });
  assert.equal(opinion.reviewId, planned.id);
  assert.deepEqual(opinion.unitIds, planned.blocks[0].unitIds);
});

test('feedback accepts the same snapshot, rejects stale code and HEAD movement, and never writes source', async t => {
  const cwd = await fixture(t);
  await writeFile(path.join(cwd, 'tracked.txt'), 'changed\n');
  const review = await captureReview({ cwd });
  const before = git(cwd, 'status', '--porcelain=v1');
  const opinion = await recordFeedback({ cwd, review, blockId: review.blocks[0].id, text: ' Keep only the requested behavior. ' });
  assert.equal(opinion.status, 'saved-not-sent');
  assert.equal(opinion.text, ' Keep only the requested behavior. ');
  assert.deepEqual(opinion.unitIds, review.blocks[0].unitIds);
  assert.equal(git(cwd, 'status', '--porcelain=v1'), before);
  assert.equal(await readFile(path.join(cwd, 'tracked.txt'), 'utf8'), 'changed\n');
  await assert.rejects(recordFeedback({ cwd, review, blockId: 'missing', text: 'x' }), /Unknown/);
  await assert.rejects(recordFeedback({ cwd, review, blockId: review.blocks[0].id, text: ' ' }), /non-empty/);
  for (const text of ['x'.repeat(8001),'text\0']) await assert.rejects(recordFeedback({cwd,review,blockId:review.blocks[0].id,text}),/at most/);
  await writeFile(path.join(cwd, 'tracked.txt'), 'changed again\n');
  await assert.rejects(recordFeedback({ cwd, review, blockId: review.blocks[0].id, text: 'x' }), /Stale/);
  await writeFile(path.join(cwd, 'tracked.txt'), 'changed\n');
  const staged = await captureReview({ cwd });
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-qm', 'Changed HEAD');
  await assert.rejects(recordFeedback({ cwd, review: staged, blockId: staged.blocks[0].id, text: 'x' }), /Stale/);
});

test('untracked symlinks are reviewed as links without reading their target', async t => {
  const cwd = await fixture(t);
  const outside = await mkdtemp(path.join(tmpdir(), 'code-doctor-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, 'secret'), 'TARGET_CONTENT_MUST_NOT_APPEAR');
  await symlink(path.join(outside, 'secret'), path.join(cwd, 'link'));
  const review = await captureReview({ cwd });
  assert.equal(review.units[0].newMode, '120000');
  assert.match(review.units[0].patch, /secret/);
  assert.doesNotMatch(review.units[0].patch, /TARGET_CONTENT_MUST_NOT_APPEAR/);
});

test('bad refs, missing artifact ignores, conflicts and changed submodules fail explicitly', async t => {
  const cwd = await fixture(t);
  await assert.rejects(captureReview({ cwd, base: '--output=/tmp/should-not-exist' }), /Git could not capture/);
  await assert.rejects(captureReview({ cwd, base: 'HEAD\0x' }), /base must/);
  await writeFile(path.join(cwd, '.gitignore'), 'ignored.txt\n');
  await mkdir(path.join(cwd, '.code-doctor'));
  await writeFile(path.join(cwd, '.code-doctor', 'review.json'), '{}');
  await assert.rejects(captureReview({ cwd }), /Ignore .code-doctor/);
  await rm(path.join(cwd, '.code-doctor'), { recursive: true });
  const commit = git(cwd, 'rev-parse', 'HEAD').trim();
  git(cwd, 'update-index', '--add', '--cacheinfo', `160000,${commit},submodule`);
  await assert.rejects(captureReview({ cwd }), /Submodule changes/);
  git(cwd, 'reset', '-q', 'HEAD');
  const blob = git(cwd, 'rev-parse', 'HEAD:tracked.txt').trim();
  execFileSync('git', ['update-index', '--index-info'], { cwd, input: `0 ${'0'.repeat(40)}\ttracked.txt\n100644 ${blob} 1\ttracked.txt\n100644 ${blob} 2\ttracked.txt\n100644 ${blob} 3\ttracked.txt\n` });
  await assert.rejects(captureReview({ cwd }), /Resolve index conflicts/);
});

test('clean repositories have zero blocks and still validate', async t => {
  const cwd = await fixture(t);
  const review = await captureReview({ cwd });
  assert.deepEqual(review.units, []);
  assert.deepEqual(review.blocks, []);
  assert.equal(validateReview(review).valid, true);
});

test('repository environment overrides cannot redirect capture or accept feedback from another repository', async t => {
  const cwd = await fixture(t);
  const other = await fixture(t, 'Independent repository history');
  await writeFile(path.join(cwd, 'tracked.txt'), 'belongs to cwd\n');
  const previous = process.env.GIT_WORK_TREE;
  process.env.GIT_WORK_TREE = other;
  let review;
  try { review = await captureReview({ cwd }); }
  finally {
    if (previous === undefined) delete process.env.GIT_WORK_TREE;
    else process.env.GIT_WORK_TREE = previous;
  }
  assert.match(review.units[0].patch, /belongs to cwd/);
  assert.throws(() => git(other, 'cat-file', '-e', review.baseCommit));
  await assert.rejects(recordFeedback({ cwd: other, review, blockId: review.blocks[0].id, text: 'x' }), /Stale.*different repository/);
  assert.equal((await recordFeedback({cwd, review, blockId:review.blocks[0].id, text:'x'})).repoRoot, review.repoRoot);
});

test('hidden index flags and non-UTF-8 text fail instead of producing incomplete reviews', async t => {
  const cwd = await fixture(t);
  git(cwd, 'update-index', '--assume-unchanged', 'tracked.txt');
  await writeFile(path.join(cwd, 'tracked.txt'), 'hidden change\n');
  await assert.rejects(captureReview({ cwd }), /can hide changes/);
  git(cwd, 'update-index', '--no-assume-unchanged', 'tracked.txt');
  const visible = await captureReview({ cwd });
  assert.match(visible.units[0].patch, /hidden change/);
  git(cwd, 'update-index', '--skip-worktree', 'tracked.txt');
  await assert.rejects(captureReview({ cwd }), /skip-worktree/);
  git(cwd, 'update-index', '--no-skip-worktree', 'tracked.txt');
  await writeFile(path.join(cwd, 'tracked.txt'), Buffer.from([255, 254, 65, 10]));
  await assert.rejects(captureReview({ cwd }), /Non-UTF-8/);
});

test('active clean/process filters cannot execute code during capture, while unused drivers do not block ordinary repositories', async t => {
  const cwd = await fixture(t);
  const marker = path.join(cwd, 'FILTER_EXECUTED');
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  const command = `touch ${quote(marker)}; cat`;
  git(cwd, 'config', 'filter.review_probe.clean', command);
  await writeFile(path.join(cwd, 'tracked.txt'), 'changed\n');
  const unused = await captureReview({ cwd });
  assert.match(unused.units[0].patch, /changed/);
  await assert.rejects(access(marker), { code: 'ENOENT' });
  await writeFile(path.join(cwd, '.gitattributes'), 'tracked.txt filter=review_probe\n');
  await assert.rejects(captureReview({ cwd }), /Active Git clean filter/);
  await assert.rejects(access(marker), { code: 'ENOENT' });
  git(cwd, 'config', '--unset', 'filter.review_probe.clean');
  git(cwd, 'config', 'filter.review_probe.process', command);
  await assert.rejects(captureReview({ cwd }), /Active Git process filter/);
  await assert.rejects(access(marker), { code: 'ENOENT' });
  git(cwd, 'config', '--unset', 'filter.review_probe.process');
  const safe = await captureReview({ cwd });
  assert.equal(validateReview(safe).valid, true);
  assert.match(safe.units.find(unit => unit.file === 'tracked.txt').patch, /changed/);
  await assert.rejects(access(marker), { code: 'ENOENT' });
  git(cwd, 'config', 'filter.set.clean', command);
  await writeFile(path.join(cwd, '.gitattributes'), 'tracked.txt filter=set\n');
  await assert.rejects(captureReview({ cwd }), /Active Git clean filter "set"/);
  await assert.rejects(access(marker), { code: 'ENOENT' });
});
