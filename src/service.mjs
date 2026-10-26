import { readFile, writeFile, mkdir, lstat, rename, realpath, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { captureReview, validateReview, applyPlan, recordFeedback } from './review.mjs';
import { blockContent, patchLineCount } from './reading.mjs';

const reviewPattern = /^review-[0-9a-f]{24}$/;
const feedbackPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sameTask = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const taskOptions = review => ({base:review.base, baseCommit:review.baseCommit, task:review.task.text, kind:review.task.kind, issue:review.task.issue, ...(review.task.context ? {context:review.task.context} : {})});

export async function createService(cwd) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const root = await realpath(execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {encoding:'utf8', stdio:'pipe', env}).replace(/\n$/, ''));
  const folder = path.join(root, '.code-doctor');
  async function location(relative, createParents = false) {
    if (!/^[A-Za-z0-9._/-]+$/.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid local artifact path.');
    await mkdir(folder, {recursive:true, mode:0o700});
    if ((await lstat(folder)).isSymbolicLink()) throw new Error('.code-doctor must be a real directory, not a symlink.');
    let current = folder;
    const parts = relative.split('/');
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink()) throw new Error('Review storage must not contain a symlink.');
        if (index < parts.length - 1 && !info.isDirectory()) throw new Error('Review storage parent must be a directory.');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (createParents && index < parts.length - 1) await mkdir(current, {mode:0o700});
      }
    }
    const destination = path.relative(root, current);
    const tracked = execFileSync('git', ['-C', root, 'ls-files', '-z', '--', destination], {stdio:'pipe', env});
    if (tracked.length) throw new Error(`Review storage must not be tracked: ${destination}`);
    try { execFileSync('git', ['-C', root, 'check-ignore', '-q', '--', destination], {stdio:'pipe', env}); }
    catch { throw new Error(`Add .code-doctor/ to .gitignore without exceptions before saving a review: ${destination}`); }
    return current;
  }
  async function json(relative) {
    try { return JSON.parse(await readFile(await location(relative), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  }
  async function prepare(relative, value, immutable = false) {
    const file = await location(relative, true);
    const temporary = await location(path.posix.join(path.posix.dirname(relative), `${randomUUID()}.tmp`), true);
    const text = JSON.stringify(value, null, 2) + '\n';
    if (immutable) {
      const old = await json(relative);
      if (old !== undefined) {
        if (JSON.stringify(old) !== JSON.stringify(value)) throw new Error('Archived review content differs for the same identity.');
        return async () => {};
      }
    }
    return async () => {
      try {
        await writeFile(temporary, text, {flag:'wx', mode:0o600});
        await rename(temporary, file);
      } finally { await rm(temporary, {force:true}); }
    };
  }
  async function mutate(action) {
    // The lock also serializes independent CLI, MCP and viewer processes.
    await location('review.json');
    const lock = await location('write.lock');
    try { await mkdir(lock, {mode:0o700}); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const info = await diagnostics();
      throw new Error(`Review storage is busy${info.lock?.pid ? ` (owner PID ${info.lock.pid})` : ''}. Retry after the write finishes. If it exited, inspect doctor and confirm no writer before removing .code-doctor/write.lock.`);
    }
    try {
      await writeFile(await location('write.lock/owner.json'), JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}), {flag:'wx',mode:0o600});
      return await action();
    }
    finally { await rm(lock, {recursive:true, force:true}); }
  }
  function checked(review) {
    const result = validateReview(review);
    if (!result.valid) throw new Error(result.errors.join('\n'));
    if (review.repoRoot !== root) throw new Error('This review belongs to another repository.');
    return review;
  }
  async function latestOptional() {
    const review = await json('review.json');
    return review === undefined ? undefined : checked(review);
  }
  async function read({reviewId, view = 'full'} = {}) {
    if (!['full','outline','guide'].includes(view)) throw new Error('Review view must be full or outline or guide.');
    const latest = await latestOptional();
    if (!latest) throw new Error('No review yet. Capture the repository changes first.');
    let review = latest;
    if (reviewId && latest.id !== reviewId) {
      if (!reviewPattern.test(reviewId)) throw new Error('Invalid review ID.');
      review = await json(`reviews/${reviewId}.json`);
      if (!review) throw new Error('Unknown review revision.');
      if (review.id !== reviewId) throw new Error('Archived review identity does not match.');
      checked(review);
    }
    if (view === 'full') return review;
    return {...review, view, units:review.units.map(({patch,...unit})=>unit),
      blocks:view === 'guide' ? review.blocks.map(block=>({...block,...blockContent(review,block)})) : review.blocks,
      sourceStats:{unitCount:review.units.length,fullPatchLines:review.units.reduce((sum,unit)=>sum + patchLineCount(unit.patch),0)},
      latestReviewId:latest.id, freshness:await freshness(review)};
  }
  async function selected(reviewId) {
    const review = await read();
    if (review.id !== reviewId) throw new Error('Review changed. Read the current review before continuing.');
    return review;
  }
  async function history() {
    const items = await json('history.json') ?? [];
    if (!Array.isArray(items) || items.some(item => !reviewPattern.test(item?.id) || typeof item.summary !== 'string' || !/^[0-9a-f]{64}$/.test(item.fingerprint))) throw new Error('Invalid review history.');
    return items;
  }
  async function diagnostics() {
    const result = {lock:null};
    for (const relative of ['', 'write.lock', 'write.lock/owner.json']) {
      try {
        const info = await lstat(path.join(folder, relative));
        if (info.isSymbolicLink()) throw new Error('Review storage must not contain a symlink.');
      } catch (error) { if (error.code === 'ENOENT') return result; throw error; }
      if (relative === 'write.lock') result.lock = {pid:null,createdAt:null};
    }
    let owner;
    try { owner = JSON.parse(await readFile(path.join(folder,'write.lock/owner.json'),'utf8')); }
    catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return result; throw error; }
    if (!owner || typeof owner !== 'object') return result;
    result.lock = {pid:Number.isSafeInteger(owner.pid) ? owner.pid : null, createdAt:typeof owner.createdAt === 'string' ? owner.createdAt.slice(0,100) : null};
    return result;
  }
  async function save(review) {
    const previous = await latestOptional();
    const entries = await history();
    const updates = [review, ...(previous && previous.id !== review.id ? [previous] : [])];
    const index = [...updates.map(item => ({id:item.id, summary:item.summary, fingerprint:item.fingerprint, task:item.task})), ...entries.filter(item => !updates.some(update => update.id === item.id))];
    // Preflight every actual destination before writing any private patch bytes.
    const currentWrite = await prepare('review.json', review);
    const historyWrite = await prepare('history.json', index);
    const archives = [];
    for (const item of updates) archives.push(await prepare(`reviews/${item.id}.json`, item, true));
    for (const write of archives) await write();
    await historyWrite();
    await currentWrite();
    return review;
  }
  async function freshness(review) {
    try {
      const current = await captureReview({cwd:root, ...taskOptions(review)});
      return {state:current.fingerprint === review.fingerprint ? 'current' : 'changed'};
    } catch (error) { return {state:'unavailable', reason:error.message}; }
  }
  async function feedbackById(id) {
    if (!feedbackPattern.test(id)) throw new Error('Invalid feedback ID.');
    const item = await json(`feedback-${id}.json`);
    if (!item) throw new Error('Unknown feedback.');
    if (item.repoRoot !== root || item.id && item.id !== id || !reviewPattern.test(item.reviewId) || typeof item.text !== 'string') throw new Error('Invalid feedback record.');
    return {...item, id, version:item.version ?? 1, state:item.state ?? 'pending'};
  }
  async function feedbacks({reviewId, state = 'all'} = {}) {
    if (!['all','pending','addressed','dismissed'].includes(state)) throw new Error('Invalid feedback state.');
    await location('review.json');
    const files = (await readdir(folder)).filter(file => /^feedback-[0-9a-f-]+\.json$/.test(file));
    const items = [];
    for (const file of files) items.push(await feedbackById(file.slice(9, -5)));
    return items.filter(item => (!reviewId || item.reviewId === reviewId) && (state === 'all' || item.state === state)).sort((a,b) => a.createdAt.localeCompare(b.createdAt));
  }
  const service = {
    root, read, history, feedbacks, diagnostics,
    async capture(options = {}) {
      return mutate(async () => {
        const previous = await latestOptional();
        const inherited = previous ? taskOptions(previous) : {};
        if (options.base !== undefined) delete inherited.baseCommit;
        const review = await captureReview({...inherited, ...options, cwd:root});
        if (previous && previous.fingerprint === review.fingerprint && sameTask(previous.task, review.task)) return previous;
        return save(review);
      });
    },
    async plan({reviewId, ...plan}) {
      return mutate(async () => {
        const review = await selected(reviewId);
        const current = await captureReview({cwd:root, ...taskOptions(review)});
        if (current.fingerprint !== review.fingerprint) throw new Error('Code changed. Capture a new review before planning.');
        return save(applyPlan(review, plan));
      });
    },
    async block({reviewId, blockId, view = 'focus'} = {}) {
      if (!['focus','full'].includes(view)) throw new Error('Block view must be focus or full.');
      const review = await read({reviewId});
      const index = blockId ? review.blocks.findIndex(item => item.id === blockId) : 0;
      if (blockId && index < 0) throw new Error('Unknown review block.');
      const block = review.blocks[index] ?? null;
      return {reviewId:review.id, latestReviewId:(await read()).id, summary:review.summary, task:review.task, block,
        source:{repoRoot:review.repoRoot,base:review.base,baseCommit:review.baseCommit,headCommit:review.headCommit,fingerprint:review.fingerprint},
        ...blockContent(review,block,view),
        position:{index:block ? index + 1 : 0, total:review.blocks.length, previousId:review.blocks[index - 1]?.id ?? null, nextId:review.blocks[index + 1]?.id ?? null},
        freshness:await freshness(review)};
    },
    async state({reviewId} = {}) {
      const review = await read({reviewId});
      const entries = await history();
      const offset = entries.findIndex(item => item.id === review.id);
      const previous = offset < 0 ? undefined : entries.slice(offset + 1).find(item => item.fingerprint !== review.fingerprint && sameTask(item.task, review.task));
      return {review, latestReviewId:(await read()).id, freshness:await freshness(review), feedbacks:await feedbacks(), history:entries, previousReviewId:previous?.id ?? null};
    },
    async feedback({reviewId, blockId, text}) {
      return mutate(async () => {
        const review = await selected(reviewId);
        const item = {...await recordFeedback({cwd:root, review, blockId, text}), id:randomUUID(), state:'pending', version:1};
        const write = await prepare(`feedback-${item.id}.json`, item);
        await write();
        return {...item, feedbackFile:path.join(folder, `feedback-${item.id}.json`)};
      });
    },
    async resolve({feedbackId, expectedVersion, reviewId, resolution, note}) {
      return mutate(async () => {
        if (!['addressed','dismissed'].includes(resolution)) throw new Error('Resolution must be addressed or dismissed.');
        if (typeof note !== 'string' || !note.trim() || note.length > 8000 || note.includes('\0')) throw new Error('Explain the feedback resolution in at most 8000 characters.');
        const item = await feedbackById(feedbackId);
        if (item.version !== expectedVersion || item.state !== 'pending') throw new Error('Feedback changed. Read the current feedback before resolving it.');
        const review = await selected(reviewId);
        if (!sameTask(item.task, review.task)) throw new Error('Feedback belongs to another task context.');
        if ((await freshness(review)).state !== 'current') throw new Error('Stale review: recapture the revised source before resolving feedback.');
        if (resolution === 'addressed' && item.fingerprint === review.fingerprint) throw new Error('Source has not changed. Capture the actual correction before marking feedback addressed.');
        const next = {...item, state:resolution, version:item.version + 1, resolvedReviewId:review.id, resolvedAt:new Date().toISOString(), note:note.trim()};
        await (await prepare(`feedback-${item.id}.json`, next))();
        return next;
      });
    },
  };
  return service;
}
