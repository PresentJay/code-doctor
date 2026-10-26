import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { devNull } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { focusExcerpts } from './reading.mjs';

const exec = promisify(execFile);
const hash = value => createHash('sha256').update(value).digest('hex');
const utf8 = buffer => {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { throw new Error('Non-UTF-8 Git paths or text patches are not supported. No partial review was produced.'); }
};
const importanceValues = new Set(['high', 'normal', 'low']);
const relationValues = new Set(['requested', 'supporting', 'extra', 'unknown']);
const gitOptions = ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.quotePath=true'];
const diffOptions = ['--no-ext-diff', '--no-textconv', '--no-color', '--binary', '--full-index', '--src-prefix=a/', '--dst-prefix=b/'];

async function git(cwd, args, allowedCodes = [0], input) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
  // A caller's shell must not silently redirect a repository-bound review elsewhere.
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_PREFIX']) delete env[key];
  try {
    const operation = exec('git', [...gitOptions, ...args], {
      cwd, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024,
      env,
    });
    operation.child.stdin.on('error', () => {}); // Git's exit status reports a rejected stdin request.
    operation.child.stdin.end(input);
    return (await operation).stdout;
  } catch (error) {
    if (allowedCodes.includes(error.code)) return error.stdout;
    throw new Error(`Git could not capture the review: ${error.stderr?.toString().trim() || error.message}`, { cause: error });
  }
}

function string(value, name, max, allowEmpty = true) {
  if (typeof value !== 'string' || value.length > max || value.includes('\0') || (!allowEmpty && !value.trim())) {
    throw new Error(`${name} must be ${allowEmpty ? 'a' : 'a non-empty'} string of at most ${max} characters.`);
  }
  return value;
}

function record(value) {
  return value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function contextValue(value) {
  if (!record(value) || Object.keys(value).some(key => !['requirements', 'acceptanceCriteria', 'references'].includes(key))) {
    throw new Error('context must be an object containing only requirements, acceptanceCriteria, and references.');
  }
  const list = (items, name, normalize) => {
    if (!Array.isArray(items) || items.length > 100) throw new Error(`${name} must be an array of at most 100 items.`);
    return Array.from(items, normalize);
  };
  const textList = key => list(value[key] === undefined ? [] : value[key], `context.${key}`, item => string(item, `context.${key} item`, 8000, false).trim());
  return {
    requirements: textList('requirements'),
    acceptanceCriteria: textList('acceptanceCriteria'),
    references: list(value.references === undefined ? [] : value.references, 'context.references', item => {
      if (!record(item) || Object.keys(item).some(key => !['title', 'source', 'revision'].includes(key))) {
        throw new Error('Each context reference must be an object containing title, source, and optional revision.');
      }
      return {
        title: string(item.title, 'context reference title', 500, false).trim(),
        source: string(item.source, 'context reference source', 4000, false).trim(),
        ...(item.revision === undefined ? {} : { revision: string(item.revision, 'context reference revision', 500, false).trim() }),
      };
    }),
  };
}

function safeFile(file) {
  if (typeof file !== 'string' || !file || file.includes('\0') || path.isAbsolute(file) || /^[A-Za-z]:/.test(file) || file.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Change paths must stay inside the repository.');
  }
  if (file === '.code-doctor' || file.startsWith('.code-doctor/')) {
    throw new Error('Ignore .code-doctor/ before capturing a review; review artifacts must not include themselves.');
  }
  return file;
}

const source = unit => ({
  stage: unit.stage, file: unit.file, previousFile: unit.previousFile ?? null,
  status: unit.status, oldMode: unit.oldMode, newMode: unit.newMode, patch: unit.patch, binary: unit.binary,
  ...(unit.hunk === undefined ? {} : { hunk: unit.hunk }),
});
const unitId = unit => `u-${hash(JSON.stringify(source(unit))).slice(0, 24)}`;
const fingerprint = review => hash(JSON.stringify({
  repoRoot: review.repoRoot, base: review.base, baseCommit: review.baseCommit,
  headCommit: review.headCommit, units: review.units.map(source),
}));
const reviewId = review => `review-${hash(JSON.stringify({
  schemaVersion: review.schemaVersion, fingerprint: review.fingerprint,
  task: { text: review.task?.text, kind: review.task?.kind, issue: review.task?.issue,
    ...(review.task?.context === undefined ? {} : { context: review.task.context }) },
  summary: review.summary,
  blocks: Array.isArray(review.blocks) ? review.blocks.map(block => ({
    id: block?.id, title: block?.title, comment: block?.comment,
    importance: block?.importance, unitIds: block?.unitIds,
    ...(block?.relation === undefined ? {} : { relation: block.relation }),
    ...(block?.focus === undefined ? {} : { focus: block.focus }),
  })) : null,
})).slice(0, 24)}`;

function splitPatches(text) {
  const starts = [...text.matchAll(/^diff --git /gm)].map(match => match.index);
  return starts.map((start, index) => text.slice(start, starts[index + 1] ?? text.length));
}

function patchHunks(patch) {
  return [...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@[^\n]*(?:\n|$)/gm)].map(match => ({
    start: match.index,
    oldStart: Number(match[1]), oldCount: Number(match[2] ?? 1),
    newStart: Number(match[3]), newCount: Number(match[4] ?? 1),
  }));
}

function changeUnits(entry, patch) {
  const binary = patch.includes('\nGIT binary patch\n') || /^Binary files /m.test(patch);
  const hunks = binary ? [] : patchHunks(patch);
  const header = patch.slice(0, hunks[0]?.start ?? patch.length);
  const units = hunks.length ? hunks.map(({ start, ...range }, index) => ({
    ...entry, patch: header + patch.slice(start, hunks[index + 1]?.start ?? patch.length), binary,
    hunk: { index: index + 1, total: hunks.length, ...range },
  })) : [{ ...entry, patch, binary }];
  return units.map(unit => ({ id: unitId(unit), ...unit }));
}

function parseDiff(buffer, stage) {
  if (!buffer.length) return [];
  const boundary = buffer.indexOf(Buffer.from([0, 0]));
  if (boundary < 0) throw new Error('Unsupported Git diff output: missing raw/patch boundary.');
  const fields = utf8(buffer.subarray(0, boundary)).split('\0');
  const patches = splitPatches(utf8(buffer.subarray(boundary + 2)));
  const entries = [];
  for (let index = 0; index < fields.length;) {
    const match = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([AMDT]|[RC]\d+)$/.exec(fields[index++]);
    if (!match) throw new Error('Unsupported Git change state. Resolve conflicts before reviewing.');
    const [, oldMode, newMode, status] = match;
    if (oldMode === '160000' || newMode === '160000') throw new Error('Submodule changes are not supported yet; review them separately.');
    const firstFile = safeFile(fields[index++]);
    const renamed = /^[RC]/.test(status);
    const file = renamed ? safeFile(fields[index++]) : firstFile;
    entries.push({ stage, file, ...(renamed ? { previousFile: firstFile } : {}), status, oldMode, newMode });
  }
  const patchCount = entries.reduce((count, entry) => count + (entry.status === 'T' ? 2 : 1), 0);
  if (patchCount !== patches.length) throw new Error('Git patch inventory does not match the file inventory.');
  let index = 0;
  return entries.flatMap(entry => {
    if (entry.status !== 'T') return changeUnits(entry, patches[index++]);
    // Git emits a file-type replacement as a deletion and an addition, even though raw has one T entry.
    const removed = patches[index++], added = patches[index++];
    if (!removed.includes(`\ndeleted file mode ${entry.oldMode}\n`) || !added.includes(`\nnew file mode ${entry.newMode}\n`)) {
      throw new Error('Unsupported Git file-type replacement patch order.');
    }
    return [
      ...changeUnits({...entry, status:'D', newMode:'000000'}, removed),
      ...changeUnits({...entry, status:'A', oldMode:'000000'}, added),
    ];
  });
}

async function resolveCommit(cwd, ref) {
  return utf8(await git(cwd, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).trim();
}

async function rejectActiveFilters(repoRoot) {
  const files = await git(repoRoot, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  if (!files.length) return;
  const attributes = utf8(await git(repoRoot, ['check-attr', '--stdin', '-z', 'filter'], [0], files)).split('\0');
  const drivers = new Set();
  for (let index = 0; index + 2 < attributes.length; index += 3) {
    // Git prints literal filter=set like a boolean attribute; inspect its driver too.
    drivers.add(attributes[index + 2]);
  }
  for (const driver of drivers) {
    for (const command of ['clean', 'process']) {
      const configured = await git(repoRoot, ['config', '--null', '--get-all', `filter.${driver}.${command}`], [0, 1]);
      if (utf8(configured).split('\0').some(value => value.length)) {
        throw new Error(`Active Git ${command} filter "${driver}" is not supported: capturing a diff could execute repository code. Disable the applicable filter before reviewing.`);
      }
    }
  }
}

async function snapshot(repoRoot, base, pinnedBaseCommit) {
  const baseCommit = await resolveCommit(repoRoot, pinnedBaseCommit ?? base);
  const headCommit = await resolveCommit(repoRoot, 'HEAD');
  if ((await git(repoRoot, ['ls-files', '--unmerged', '-z'])).length) {
    throw new Error('Resolve index conflicts before capturing a review.');
  }
  const trackedFlags = utf8(await git(repoRoot, ['ls-files', '-v', '-z'])).split('\0').filter(Boolean);
  if (trackedFlags.some(entry => entry[0] === 'S' || /[a-z]/.test(entry[0]))) {
    throw new Error('assume-unchanged and skip-worktree flags can hide changes and are not supported. Clear these flags or use a full checkout before reviewing.');
  }
  await rejectActiveFilters(repoRoot);
  const units = [];
  for (const stage of ['index', 'worktree']) {
    const args = ['diff', '--raw', '-z', '--patch', '--abbrev=64', ...diffOptions, '--find-renames', '--ignore-submodules=none'];
    if (stage === 'index') args.push('--cached', baseCommit);
    units.push(...parseDiff(await git(repoRoot, [...args, '--']), stage));
  }
  const untracked = utf8(await git(repoRoot, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
  for (const file of untracked) {
    safeFile(file);
    const stat = await lstat(path.join(repoRoot, file));
    if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error(`Unsupported untracked entry: ${file}. Nested repositories must be reviewed separately.`);
    const patch = utf8(await git(repoRoot, ['diff', '--no-index', ...diffOptions, '--', devNull, file], [0, 1]));
    const mode = /^new file mode (\d{6})$/m.exec(patch)?.[1] ?? (stat.isSymbolicLink() ? '120000' : '100644');
    units.push(...changeUnits({ stage: 'untracked', file, status: 'A', oldMode: '000000', newMode: mode }, patch));
  }
  const review = { repoRoot, base, baseCommit, headCommit, units };
  return { ...review, fingerprint: fingerprint(review) };
}

/** Capture both base→index and index→worktree, so cancelled staged edits remain visible. */
export async function captureReview({ cwd, base = 'HEAD', baseCommit, task = '', kind = 'change', issue = '', context } = {}) {
  string(cwd, 'cwd', 32768, false);
  string(base, 'base', 1024, false);
  if (baseCommit !== undefined && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(baseCommit)) throw new Error('Pinned baseCommit must be a full commit SHA.');
  string(task, 'task', 8000);
  string(kind, 'kind', 80, false);
  string(issue, 'issue', 2000);
  const normalizedContext = context === undefined ? undefined : contextValue(context);
  const workingDirectory = await realpath(cwd);
  const repoRoot = await realpath(utf8(await git(workingDirectory, ['rev-parse', '--show-toplevel'])).replace(/\n$/, ''));
  const first = await snapshot(repoRoot, base, baseCommit);
  const current = await snapshot(repoRoot, base, baseCommit);
  if (first.fingerprint !== current.fingerprint) throw new Error('The repository changed during capture. Retry after edits finish.');
  const review = {
    schemaVersion: 1, ...current,
    task: { text: task, kind, issue, ...(normalizedContext === undefined ? {} : { context: normalizedContext }) },
    summary: `${current.units.length} change units captured. Reading order and explanations have not been supplied by an agent.`,
    blocks: current.units.map((unit, index) => ({
      id: `block-${index + 1}`, title: `${unit.file} (${unit.stage}${unit.hunk ? `, hunk ${unit.hunk.index}/${unit.hunk.total}` : ''})`,
      comment: 'Read the Git patch for this change unit below. This default block does not judge whether the change meets the request.',
      importance: 'normal', relation: 'unknown', unitIds: [unit.id],
    })),
  };
  review.id = reviewId(review);
  const validation = validateReview(review);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  return review;
}

/** Validate source integrity and exact coverage; it does not judge an agent's explanation. */
export function validateReview(review) {
  const errors = [];
  const counts = new Map();
  const ids = new Set();
  const hunkGroups = new Map();
  if (!review || typeof review !== 'object') return { valid: false, errors: ['Review must be an object.'], uncoveredUnitIds: [] };
  if (review.schemaVersion !== 1) errors.push('Unsupported review schema version.');
  if (typeof review.repoRoot !== 'string' || !path.isAbsolute(review.repoRoot)) errors.push('Review requires an absolute repository root.');
  if (typeof review.base !== 'string' || !review.base.trim() || review.base.includes('\0')) errors.push('Review requires a base ref.');
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(review.baseCommit ?? '') || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(review.headCommit ?? '')) errors.push('Review requires resolved base and HEAD commits.');
  if (!review.task || !['text', 'kind', 'issue'].every(key => typeof review.task[key] === 'string')) errors.push('Review requires task text, kind, and issue strings.');
  if (review.task?.context !== undefined) {
    try { contextValue(review.task.context); } catch (error) { errors.push(error.message); }
  }
  if (typeof review.summary !== 'string') errors.push('Review summary must be a string.');
  if (!Array.isArray(review.units)) errors.push('Review units must be an array.');
  for (const unit of Array.isArray(review.units) ? review.units : []) {
    if (!unit || typeof unit !== 'object') { errors.push('Each unit must be an object.'); continue; }
    try { safeFile(unit.file); if (unit.previousFile !== undefined) safeFile(unit.previousFile); } catch (error) { errors.push(error.message); }
    if (!['index', 'worktree', 'untracked'].includes(unit.stage) || !/^([AMDT]|[RC]\d+)$/.test(unit.status ?? '')) errors.push(`Invalid change metadata: ${unit.id}.`);
    if (!/^\d{6}$/.test(unit.oldMode ?? '') || !/^\d{6}$/.test(unit.newMode ?? '') || typeof unit.patch !== 'string' || typeof unit.binary !== 'boolean') errors.push(`Invalid patch metadata: ${unit.id}.`);
    if (unit.hunk !== undefined) {
      const hunk = unit.hunk;
      const keys = ['index', 'total', 'oldStart', 'oldCount', 'newStart', 'newCount'];
      if (!record(hunk) || Object.keys(hunk).length !== keys.length || !keys.every(key => Number.isSafeInteger(hunk[key]) && hunk[key] >= (key === 'index' || key === 'total' ? 1 : 0)) || hunk.index > hunk.total) {
        errors.push(`Invalid hunk metadata: ${unit.id}.`);
      } else {
        const hunks = typeof unit.patch === 'string' ? patchHunks(unit.patch) : [];
        if (unit.binary || hunks.length !== 1 || !keys.slice(2).every(key => hunk[key] === hunks[0]?.[key])) errors.push(`Hunk metadata does not match its patch: ${unit.id}.`);
        const group = JSON.stringify([unit.stage, unit.file, unit.previousFile, unit.status, unit.oldMode, unit.newMode]);
        const members = hunkGroups.get(group) ?? [];
        members.push(hunk);
        hunkGroups.set(group, members);
      }
    }
    if (unit.id !== unitId(unit)) errors.push(`Source unit changed: ${unit.id}.`);
    if (ids.has(unit.id)) errors.push(`Duplicate source unit: ${unit.id}.`);
    ids.add(unit.id);
  }
  for (const members of hunkGroups.values()) {
    if (members.some(hunk => hunk.total !== members.length) || new Set(members.map(hunk => hunk.index)).size !== members.length) errors.push('Hunk inventory is incomplete or duplicated.');
  }
  if (!Array.isArray(review.blocks)) errors.push('Review blocks must be an array.');
  const blockIds = new Set();
  for (const block of Array.isArray(review.blocks) ? review.blocks : []) {
    if (!block || typeof block !== 'object') { errors.push('Each block must be an object.'); continue; }
    if (typeof block.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(block.id) || blockIds.has(block.id)) errors.push('Block IDs must be unique, short identifiers.');
    blockIds.add(block.id);
    if (typeof block.title !== 'string' || !block.title.trim() || typeof block.comment !== 'string' || !importanceValues.has(block.importance)) errors.push(`Invalid block explanation: ${block.id}.`);
    if (block.relation !== undefined && !relationValues.has(block.relation)) errors.push(`Invalid block relation: ${block.id}.`);
    if (!Array.isArray(block.unitIds) || !block.unitIds.length) { errors.push(`Block ${block.id} must reference at least one unit.`); continue; }
    try { focusExcerpts(Array.isArray(review.units) ? review.units.filter(unit => unit && typeof unit === 'object') : [],block); }
    catch (error) { errors.push(`${error.message} Block: ${block.id}.`); }
    for (const id of block.unitIds) {
      if (!ids.has(id)) errors.push(`Unknown source unit: ${id}.`);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const uncoveredUnitIds = [...ids].filter(id => !counts.has(id));
  for (const id of uncoveredUnitIds) errors.push(`Uncovered source unit: ${id}.`);
  for (const [id, count] of counts) if (count > 1) errors.push(`Source unit assigned more than once: ${id}.`);
  if (Array.isArray(review.units) && review.units.every(unit => unit && typeof unit === 'object')) {
    if (review.fingerprint !== fingerprint(review)) errors.push('Review source fingerprint does not match.');
  }
  if (review.id !== reviewId(review)) errors.push('Review ID does not match its source, task, and reading plan.');
  return { valid: errors.length === 0, errors, uncoveredUnitIds };
}

/** Replace presentation and review identity; source units and fingerprint stay unchanged. */
export function applyPlan(review, plan) {
  const before = validateReview(review);
  if (!before.valid) throw new Error(before.errors.join(' '));
  if (!plan || typeof plan !== 'object' || Object.keys(plan).some(key => !['summary', 'blocks'].includes(key))) throw new Error('A reading plan may only replace summary and blocks.');
  const next = structuredClone({ ...review, summary: plan.summary, blocks: plan.blocks });
  next.id = reviewId(next);
  const validation = validateReview(next);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  return next;
}

/** Return an opinion only. The caller decides where to save or explicitly send it. */
export async function recordFeedback({ cwd, review, blockId, text } = {}) {
  const validation = validateReview(review);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  string(text, 'feedback', 8000, false);
  const block = review.blocks.find(item => item.id === blockId);
  if (!block) throw new Error('Unknown review block.');
  const repoRoot = await realpath(utf8(await git(cwd ?? process.cwd(), ['rev-parse', '--show-toplevel'])).replace(/\n$/, ''));
  if (repoRoot !== review.repoRoot) throw new Error('Stale review: feedback belongs to a different repository.');
  const current = await captureReview({ cwd, base: review.base, baseCommit: review.baseCommit, task: review.task.text, kind: review.task.kind, issue: review.task.issue, context: review.task.context });
  if (current.repoRoot !== review.repoRoot || current.fingerprint !== review.fingerprint) throw new Error('Stale review: repository changes no longer match. Capture a new review before giving feedback.');
  return {
    status: 'saved-not-sent', reviewId: review.id, fingerprint: review.fingerprint,
    repoRoot: review.repoRoot, task: structuredClone(review.task),
    blockId, unitIds: [...block.unitIds], text, createdAt: new Date().toISOString(),
  };
}
