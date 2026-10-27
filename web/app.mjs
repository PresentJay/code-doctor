import { createTranslator, resolveLocale, translateDocument } from './i18n.mjs';
import { focusExcerpts, patchLineCount, patchRows } from './reading.mjs';

let locale = resolveLocale(new URLSearchParams(location.hash.slice(1)).get('lang'));
let msg = createTranslator(locale);
let feedbackStates, relations, importance, stages, kinds;
function refreshLabels() {
  feedbackStates = { pending: msg("Pending changes"), addressed: msg("Addressed"), dismissed: msg("Not applied") };
  relations = { requested: msg("Requested change"), supporting: msg("Supporting change"), extra: msg("Additional change"), unknown: msg("Relation to request unknown") };
  importance = { high: msg("Read first"), normal: msg("Change details"), low: msg("Supporting details") };
  stages = { index: msg("Index"), worktree: msg("Worktree"), staged: msg("Index"), unstaged: msg("Worktree"), untracked: msg("New file") };
  kinds = { change: msg("Change"), feature: msg("Feature"), planned: msg("Planned work"), fix: msg("Fix"), incident: msg("Incident"), experiment: msg("Experiment"), research: msg("Research"), unknown: msg("Unknown") };
}
refreshLabels();
const $ = id => document.getElementById(id);
const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
window.addEventListener('hashchange', () => {
  const next = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
  if (next !== token) location.reload();
});
const annotation = document.oai?.annotation;
const canAnnotate = typeof annotation?.request === 'function';
const drafts = new Map();
let state = null;
let latest = null;
let index = 0;
let busy = false;
let online = true;
let polling = false;
let saving = false;
let requestEpoch = 0;
let fallbackFeedback = null;
let collectedSignature = '';

function text(element, value) {
  const next = String(value ?? '');
  if (element.textContent !== next) element.textContent = next;
}

function el(tag, value, className) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = String(value);
  if (className) node.className = className;
  return node;
}

function shortId(id) { return String(id ?? '').replace(/^(?:review|feedback)-/, '').slice(0, 8); }
function block() { return state?.review?.blocks?.[index]; }
function latestId() { return latest?.latestReviewId ?? latest?.review?.id ?? state?.latestReviewId; }
function draftKey() {
  return `${state.review.id}:${state.review.fingerprint ?? ''}:${block().id}`;
}
function isCurrent() {
  return !!state?.review && state.review.id === latestId() && state.freshness?.state === 'current' && online;
}

function setStatus(message = '', error = false, batch = false) {
  const pageStatus = !batch && $('selected-block').hidden;
  text($('action-status'), pageStatus || batch ? '' : message);
  text($('page-status'), pageStatus ? message : '');
  text($('batch-status'), batch ? message : '');
  $('page-status').hidden = !pageStatus || !message;
  $('action-status').classList.toggle('error', error);
  $('batch-status').classList.toggle('error', error);
  $('page-status').classList.toggle('error', error);
}

async function api(path, data) {
  const response = await fetch(path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'X-Code-Doctor-Token': token, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    cache: 'no-store',
  });
  let result;
  try { result = await response.json(); }
  catch { throw new Error(msg("Could not read the server response. Check the local server and reconnect.")); }
  if (!response.ok) {
    const detail = typeof result.error === 'string' ? result.error : result.error?.message ?? result.message ?? msg("Could not complete the request.");
    const error = new Error(result.code === 'busy'
      ? msg("Another request is being saved. Your draft is still here. Try again shortly.")
      : response.status === 409 && result.code === 'stale'
        ? msg("The code or reading plan changed. Recapture before saving this opinion. {0}",detail)
        : response.status === 401 || response.status === 403
          ? msg("This review is not authorized. Reopen the review link supplied by your agent.")
          : detail);
    error.status = response.status;
    error.code = result.code;
    throw error;
  }
  return result;
}

function matchingFeedback() {
  if (!block()) return null;
  const value = $('opinion').value;
  return (state.feedbacks ?? []).findLast(item => item.reviewId === state.review.id && item.blockId === block().id && item.text === value) ?? null;
}

function pendingFeedback(saved) {
  return !!saved && state?.feedbacks?.some(item => item.id === saved.id && item.state === 'pending' && (item.version ?? 1) === (saved.version ?? 1));
}

function collectedFeedback() {
  return (state?.feedbacks ?? []).filter(item => item.reviewId === state?.review?.id && item.state === 'pending');
}

function unsavedBlocks() {
  if (!state?.review) return [];
  return state.review.blocks.filter(item => {
    const value = drafts.get(`${state.review.id}:${state.review.fingerprint ?? ''}:${item.id}`);
    return value?.trim() && !(state.feedbacks ?? []).some(saved => saved.reviewId === state.review.id && saved.blockId === item.id && saved.text === value);
  });
}

function canCopy(items, reviewId, all) {
  if (state?.review?.id !== reviewId || !items.length || !items.every(pendingFeedback)) return false;
  return !all || (isCurrent() && !unsavedBlocks().length && collectedFeedback().length === items.length);
}

function clearCopyFallback() {
  fallbackFeedback = null;
  $('copy-fallback').hidden = true;
  $('followup-text').value = '';
}

function updateControls() {
  const selected = block();
  const current = isCurrent();
  $('previous').disabled = !selected || index === 0 || busy || saving;
  $('next').disabled = !selected || index >= state.review.blocks.length - 1 || busy || saving;
  $('save-feedback').disabled = !selected || !current || busy || saving || !$('opinion').value.trim() || !!matchingFeedback();
  $('copy-followup').disabled = !selected || matchingFeedback()?.state !== 'pending' || busy;
  $('copy-all-feedback').disabled = !isCurrent() || busy || saving || !collectedFeedback().length || !!unsavedBlocks().length;
  $('submit-feedback').disabled = !state?.sessionBound || !current || busy || saving || (!collectedFeedback().length && !unsavedBlocks().length);
  $('submit-feedback').hidden = !state?.sessionBound;
  $('copy-all-feedback').hidden = !!state?.sessionBound;
  $('copy-followup').hidden = !!state?.sessionBound;
  $('native-annotation').hidden = !canAnnotate || !!state?.sessionBound;
  $('native-annotation').disabled = !selected || !current || matchingFeedback()?.state !== 'pending' || busy;
  $('recapture').disabled = busy || saving;
  $('refresh-review').disabled = busy || saving;
  $('review-history').disabled = busy || saving;
  $('previous-review').disabled = busy || saving;
  $('open-latest').disabled = busy || saving;
  text($('save-feedback'), saving ? msg("Saving…") : msg("Save opinion"));
  renderCollectedFeedback();
}

function renderCollectedFeedback() {
  const items = collectedFeedback();
  const unsaved = unsavedBlocks();
  $('batch-feedback').hidden = !state?.review;
  text($('batch-count'), msg("Pending opinions: {0}{1}",items.length,unsaved.length ? msg(" · unsaved: {0}",unsaved.length) : ''));
  text($('batch-help'), unsaved.length
    ? state?.sessionBound ? msg("Submitting saves your drafts and sends them together.") : msg("Unsaved opinions: {0}. Save or clear them in their blocks before copying.",unsaved.map(item => item.title).join(', '))
    : !isCurrent()
      ? msg("Batch copy requires current code and the latest review. Older opinions remain available in their blocks.")
      : state?.sessionBound ? msg("Submit once, then ask the original agent to apply your opinions.") : msg("This review is not linked to an agent session. Ask the agent to reopen it with its session ID."));
  const list = $('batch-list');
  const signature = JSON.stringify([state?.review?.id, items.map(({id, version, blockId, text}) => [id, version, blockId, text])]);
  if (signature !== collectedSignature) {
    collectedSignature = signature;
    list.replaceChildren();
    for (const item of items) {
      const position = state.review.blocks.findIndex(value => value.id === item.blockId);
      const li = el('li');
      const button = el('button', state.review.blocks[position]?.title ?? item.blockId, 'text-button');
      button.type = 'button';
      button.addEventListener('click', () => selectBlock(position, true));
      li.append(button, el('p', item.text));
      list.append(li);
    }
  }
  if (fallbackFeedback && !canCopy(fallbackFeedback.items, fallbackFeedback.reviewId, fallbackFeedback.all)) {
    clearCopyFallback();
    setStatus();
  }
}

function updateFreshness() {
  if (!state) return;
  const archived = !!state.review && !!latestId() && state.review.id !== latestId();
  const fresh = state.freshness?.state;
  const notice = !online || (!archived && state.review && fresh !== 'current');
  $('freshness-notice').hidden = !notice;
  text($('freshness-message'), !online
    ? msg("Disconnected from the local server. Your draft is still here. Check the connection and retry.")
    : fresh === 'changed'
      ? msg("The code changed. This explanation describes older code. Recapture before leaving feedback.")
      : msg("Could not verify this against the current code.{0}",state.freshness?.reason ? ` ${state.freshness.reason}` : ''));
  $('revision-notice').hidden = !archived;
  text($('revision-message'), archived
    ? msg("A newer review is available. Opinions and drafts stay with this version. Open the newer review when ready.") : '');
  $('opinion').disabled = !block() || busy;
  text($('opinion-help'), archived
    ? msg("This is an older version. Saving is disabled; drafts stay with this version.")
    : !isCurrent()
      ? msg("You can keep drafting. Saving requires matching code and review versions.")
      : state?.sessionBound ? msg("Write opinions on any blocks, then submit them together below.") : msg("Save opinions on several blocks, then copy them together below."));
  text($('connection-status'), !online
    ? msg("Could not reach the server. Saving is paused.")
    : state?.sessionBound
      ? msg("The original agent can read submitted opinions when you ask it to apply them.")
    : canAnnotate
      ? msg("This host can attach the selected code to the conversation. Saving is not execution or approval.")
      : msg("Collect opinions and send them together to the original conversation. Saving is not execution or approval."));
  updateControls();
}

function addContextList(target, heading, items) {
  if (!Array.isArray(items) || !items.length) return;
  target.append(el('h3', heading));
  const list = el('ul');
  for (const value of items) list.append(el('li', value));
  target.append(list);
}

function renderContext(review) {
  const task = review.task ?? {};
  text($('task-text'), task.text ?? msg("The original request was not recorded."));
  text($('context-label'), msg("{0} · Original request and criteria",kinds[task.kind] ?? task.kind ?? msg("Unknown task type")));
  $('task-meta').replaceChildren();
  if (task.issue) $('task-meta').append(el('dt', msg("Source")), el('dd', task.issue));
  const context = task.context ?? {};
  const target = $('context-details');
  target.replaceChildren();
  addContextList(target, msg("Requirements"), context.requirements);
  addContextList(target, msg("Acceptance criteria"), context.acceptanceCriteria);
  if (context.references?.length) {
    target.append(el('h3', msg("References")));
    const list = el('ul');
    for (const ref of context.references) {
      const item = el('li');
      let url;
      try { url = new URL(ref.source); } catch { /* A source may be a repository path. */ }
      if (url && ['http:', 'https:'].includes(url.protocol)) {
        const link = el('a', ref.title || ref.source);
        link.href = url.href;
        link.target = '_blank';
        link.rel = 'noreferrer noopener';
        item.append(link);
        if (ref.title) item.append(document.createTextNode(` · ${ref.source}`));
      } else item.textContent = `${ref.title ? `${ref.title} · ` : ''}${ref.source ?? ''}`;
      if (ref.revision) item.append(document.createTextNode(` (${ref.revision})`));
      list.append(item);
    }
    target.append(list);
  }
  if (!context.requirements?.length && !context.acceptanceCriteria?.length && !context.references?.length) {
    target.append(el('p', msg("No separate requirements, acceptance criteria or references were recorded."), 'muted'));
  }
}

function renderInventory() {
  const review = state.review;
  const units = new Map((review.units ?? []).map(unit => [unit.id, unit]));
  const list = $('block-list');
  list.replaceChildren();
  text($('inventory-label'), msg("All changes: {0} blocks · {1} change units",review.blocks.length,review.units?.length ?? 0));
  review.blocks.forEach((item, position) => {
    const li = el('li');
    const button = el('button');
    button.type = 'button';
    button.setAttribute('aria-current', String(index === position));
    const name = el('span', item.title, 'inventory-name');
    const files = [...new Set(item.unitIds.map(id => units.get(id)?.file ?? msg("Unknown change {0}",id)))];
    name.append(el('span', files.join(' · '), 'inventory-files'));
    button.append(el('span', `${position + 1} / ${review.blocks.length}`, 'inventory-position'), name);
    button.addEventListener('click', () => selectBlock(position, true));
    li.append(button);
    list.append(li);
  });
}

function diffRow(type, oldNumber, newNumber, sign, value) {
  const row = el('div', undefined, `diff-row ${type}`);
  row.setAttribute('role', 'row');
  const oldCell = el('span', oldNumber ?? '', 'diff-number');
  const newCell = el('span', newNumber ?? '', 'diff-number');
  const marker = el('span', sign, 'diff-sign');
  const content = el('span', value, 'diff-text');
  oldCell.setAttribute('role', 'cell');
  newCell.setAttribute('role', 'cell');
  marker.setAttribute('aria-hidden', 'true');
  content.setAttribute('role', 'cell');
  if (type === 'addition') content.setAttribute('aria-label', msg("Added: {0}",value));
  if (type === 'deletion') content.setAttribute('aria-label', msg("Removed: {0}",value));
  row.append(oldCell, newCell, marker, content);
  return row;
}

function renderUnit(unit) {
  const article = el('article', undefined, 'source');
  const header = el('header', undefined, 'source-header');
  const path = unit.previousFile && unit.previousFile !== unit.file ? `${unit.previousFile} → ${unit.file}` : unit.file;
  const mode = unit.oldMode !== unit.newMode ? ` · ${unit.oldMode ?? msg("none")} → ${unit.newMode ?? msg("none")}` : '';
  header.append(el('span', path, 'source-file'), el('span', `${stages[unit.stage] ?? unit.stage ?? ''} · ${unit.status ?? ''}${mode}`, 'source-meta'));
  article.append(header);
  const patch = String(unit.patch ?? '');
  if (unit.binary) {
    article.append(el('p', msg("Binary change. Its contents cannot be displayed as code lines."), 'source-message'));
    const details = el('details', undefined, 'source-details');
    details.append(el('summary', msg("Show Git change information")), el('pre', patch || msg("No patch content")));
    article.append(details);
    return article;
  }
  const code = el('div', undefined, 'diff-code');
  code.tabIndex = 0;
  code.setAttribute('role', 'table');
  code.setAttribute('aria-label', msg("{0} changes. Old line numbers on the left, new line numbers on the right.",path));
  let hasHunk = false;
  const metadata = [];
  for (const row of patchRows(patch,true)) {
    if (row.type === 'metadata') { metadata.push(row.text); continue; }
    if (row.type === 'hunk') hasHunk = true;
    const type = row.type === 'context' ? 'context-line' : row.type;
    const sign = row.type === 'addition' ? '+' : row.type === 'deletion' ? '−' : row.type === 'context' ? ' ' : '';
    code.append(diffRow(type, row.oldLine, row.newLine, sign, row.text));
  }
  if (hasHunk) article.append(code,el('p',msg("Scroll horizontally to see the rest of the code."),'code-scroll-hint'));
  else article.append(el('p', patch ? msg("File metadata changed without code-line changes.") : msg("This change unit has no patch content."), 'source-message'));
  if (metadata.length) {
    const details = el('details', undefined, 'source-details');
    details.open = !hasHunk;
    details.append(el('summary', msg("Git file information")), el('pre', metadata.join('\n')));
    article.append(details);
  }
  return article;
}

function renderFeedback() {
  if (fallbackFeedback && !canCopy(fallbackFeedback.items, fallbackFeedback.reviewId, fallbackFeedback.all)) {
    clearCopyFallback();
    setStatus();
  }
  const items = (state.feedbacks ?? []).filter(item => item.reviewId === state.review.id && item.blockId === block()?.id);
  $('feedback-section').hidden = !items.length;
  const list = $('feedback-list');
  list.replaceChildren();
  for (const item of [...items].reverse()) {
    const li = el('li');
    const meta = el('div', undefined, 'feedback-meta');
    meta.append(el('span', feedbackStates[item.state] ?? item.state, `feedback-state ${item.state}`));
    meta.append(document.createTextNode(msg(" · {0} · opinion version {1}",shortId(item.id),item.version ?? 1)));
    li.append(meta, el('p', item.text));
    if (item.note) li.append(el('p', item.note, 'feedback-note'));
    if (item.state === 'pending' && !state.sessionBound) {
      const button = el('button', msg("Copy this opinion"), 'text-button feedback-copy');
      button.type = 'button';
      button.setAttribute('aria-label', msg("Copy instruction for opinion {0}",shortId(item.id)));
      button.addEventListener('click', () => copyFollowup([item]));
      li.append(button);
    }
    if (item.resolvedReviewId) {
      const button = el('button', msg("Open addressed review {0}",shortId(item.resolvedReviewId)), 'text-button feedback-version');
      button.type = 'button';
      button.addEventListener('click', () => openReview(item.resolvedReviewId));
      li.append(button);
    }
    list.append(li);
  }
}

function renderExcerpts(units, selected) {
  const excerpts = focusExcerpts(units,selected);
  if (!excerpts.length) return units.map(renderUnit);
  const nodes = excerpts.map(excerpt => {
    const article = el('article', undefined, 'source');
    const header = el('header', undefined, 'source-header');
    header.append(el('span', excerpt.file, 'source-file'),el('span', msg("{0} · {1} lines {2}–{3}",stages[excerpt.stage] ?? excerpt.stage,excerpt.side === 'old' ? msg("before") : msg("new"),excerpt.startLine,excerpt.endLine), 'source-meta'));
    const code = el('div', undefined, 'diff-code');
    code.tabIndex = 0;
    code.setAttribute('role','table');
    code.setAttribute('aria-label',msg("{0}: code highlighted by the agent",excerpt.file));
    for (const row of excerpt.rows) code.append(diffRow(row.type === 'context' ? 'context-line' : row.type,row.oldLine,row.newLine,row.type === 'addition' ? '+' : row.type === 'deletion' ? '−' : ' ',row.text));
    article.append(header,code,el('p',msg("Scroll horizontally to see the rest of the code."),'code-scroll-hint'));
    return article;
  });
  const lineCount = excerpts.reduce((sum,excerpt)=>sum + excerpt.rows.length,0);
  nodes.unshift(el('p', msg("Start with these {0} lines. Expand all {1} change units below.",lineCount,units.length), 'muted'));
  const complete = el('details',undefined,'complete-source');
  const total = units.reduce((sum,unit)=>sum + patchLineCount(unit.patch),0);
  complete.append(el('summary',msg("Show all changes in this block · {0} units · {1} patch lines",units.length,total)));
  const content = el('div');
  complete.append(content);
  complete.addEventListener('toggle',()=>{ if (complete.open && !content.childNodes.length) content.replaceChildren(...units.map(renderUnit)); });
  nodes.push(complete);
  return nodes;
}

function renderHistory() {
  const entries = [...(latest?.history ?? state?.history ?? [])];
  if (state?.review && !entries.some(item => item.id === state.review.id)) entries.push(state.review);
  const select = $('review-history');
  select.replaceChildren();
  for (const entry of entries) {
    const option = el('option', `${shortId(entry.id)}${entry.id === latestId() ? msg(" · latest") : ''} · ${String(entry.summary ?? msg("Code review")).split('\n')[0]}`);
    option.value = entry.id;
    option.selected = entry.id === state.review?.id;
    select.append(option);
  }
  $('previous-review').hidden = !state.previousReviewId || state.previousReviewId === state.review?.id;
}

function renderBlock(focus = false) {
  const selected = block();
  $('selected-block').hidden = !selected;
  $('empty-review').hidden = !!selected;
  if (!selected) { updateFreshness(); return; }
  text($('block-meta'), `${importance[selected.importance] ?? msg("Change details")} · ${relations[selected.relation] ?? msg("Relation to request unknown")}`);
  text($('block-step'), `${index + 1} / ${state.review.blocks.length}`);
  text($('block-title'), selected.title);
  text($('block-comment'), selected.comment);
  const unitMap = new Map(state.review.units.map(unit => [unit.id, unit]));
  const diffs = selected.unitIds.map(id => unitMap.get(id));
  $('diffs').replaceChildren(...(diffs.every(Boolean) ? renderExcerpts(diffs,selected) : [el('p',msg("Could not read a change unit. Ask the agent to check the reading plan."),'notice error-notice')]));
  $('opinion').value = drafts.get(draftKey()) ?? '';
  $('selected-block').setAttribute('oai-annotation-metadata', JSON.stringify({ reviewId: state.review.id, blockId: selected.id, fingerprint: state.review.fingerprint, unitIds: selected.unitIds }));
  clearCopyFallback();
  renderFeedback();
  updateFreshness();
  if (focus) $('block-title').focus({ preventScroll: true });
}

function preserveDraft() {
  if (block()) drafts.set(draftKey(), $('opinion').value);
}

function selectBlock(position, focus = false) {
  if (busy || saving || !state?.review?.blocks?.[position] || position === index) return;
  preserveDraft();
  index = position;
  setStatus();
  renderInventory();
  renderBlock(focus);
}

function applyState(next, { keepBlock = false } = {}) {
  const previousBlock = block()?.id;
  preserveDraft();
  state = next;
  $('loading').hidden = true;
  $('error').hidden = true;
  $('review-content').hidden = false;
  if (!state.review) {
    text($('agent-summary'), msg("No saved review yet. Capture the current Git changes to start."));
    text($('review-version'), msg("No review"));
    $('task-context').hidden = true;
    $('selected-block').hidden = true;
    $('inventory').hidden = true;
    $('empty-review').hidden = true;
    $('review-history').hidden = true;
    $('previous-review').hidden = true;
    $('revision-notice').hidden = true;
    $('freshness-notice').hidden = true;
    text($('refresh-review'), msg("Capture current code"));
    updateControls();
    return;
  }
  const review = state.review;
  const previousIndex = keepBlock ? review.blocks.findIndex(item => item.id === previousBlock) : -1;
  index = previousIndex >= 0 ? previousIndex : 0;
  text($('review-version'), msg("Review {0}",shortId(review.id)));
  text($('agent-summary'), review.summary || msg("The agent has not supplied an overall explanation."));
  text($('refresh-review'), msg("Review after changes"));
  $('task-context').hidden = false;
  $('inventory').hidden = !review.blocks.length;
  $('review-history').hidden = false;
  renderContext(review);
  renderInventory();
  renderHistory();
  renderBlock();
}

async function loadInitial() {
  requestEpoch++;
  $('error').hidden = true;
  $('loading').hidden = false;
  try {
    const next = await api('/api/review');
    online = true;
    latest = next;
    applyState(next);
  } catch (error) {
    online = false;
    $('loading').hidden = true;
    $('error').hidden = false;
    text($('error-message'), error.message);
    if (state) updateFreshness();
  }
}

async function openReview(reviewId) {
  if (busy || saving || !reviewId || reviewId === state?.review?.id) return;
  requestEpoch++;
  busy = true;
  updateControls();
  try {
    const next = reviewId === latest?.review?.id ? latest : await api(`/api/review?reviewId=${encodeURIComponent(reviewId)}`);
    applyState(next);
    setStatus(msg("Review version changed. Drafts stay with their original version."));
  } catch (error) { setStatus(error.message, true); }
  finally { busy = false; updateFreshness(); }
}

async function recapture() {
  if (busy || saving) return;
  requestEpoch++;
  preserveDraft();
  busy = true;
  text($('recapture'), msg("Capturing…"));
  updateControls();
  try {
    const next = await api('/api/recapture', {});
    online = true;
    latest = next;
    applyState(next, { keepBlock: true });
    setStatus(msg("Current code captured. Changed code still needs a new explanation. Ask the original agent to explain the revised code."));
  } catch (error) { setStatus(error.message, true); }
  finally {
    busy = false;
    text($('recapture'), msg("Recapture current code"));
    updateFreshness();
  }
}

async function saveFeedback() {
  if (!isCurrent() || busy || saving || !block()) return;
  const value = $('opinion').value;
  if (!value.trim() || matchingFeedback()) return;
  const reviewId = state.review.id;
  const blockId = block().id;
  saving = true;
  requestEpoch++;
  preserveDraft();
  updateControls();
  try {
    const result = await api('/api/feedback', { reviewId, blockId, text: value });
    const saved = result.feedback ?? result;
    if (!saved.id || !saved.reviewId || !saved.blockId || typeof saved.text !== 'string') {
      throw new Error(msg("Could not confirm the save response. Reconnect and check whether the opinion was saved."));
    }
    if (state.review.id === reviewId) {
      state.feedbacks = [...(state.feedbacks ?? []).filter(item => item.id !== saved.id), saved];
      renderFeedback();
    }
    if (latest?.review?.id === reviewId) latest.feedbacks = state.feedbacks;
    setStatus(msg("Opinion saved. Keep reading and leave opinions on other blocks."));
  } catch (error) {
    if (error.status === 409 && error.code === 'stale') {
      state.freshness = { state: 'changed' };
      updateFreshness();
    }
    setStatus(error.message, true);
  } finally { saving = false; updateControls(); }
}

function followupPrompt(items) {
  const saved = items[0];
  return [
    msg("Check these {0} Code Doctor opinions and apply the compatible corrections together.",items.length),
    `repoRoot: ${saved.repoRoot}`,
    `task: ${JSON.stringify(saved.task)}`,
    `reviewId: ${saved.reviewId}`,
    msg("Code fingerprint: {0}",saved.fingerprint),
    '',
    ...items.flatMap(item => [
      `blockId: ${item.blockId}`,
      `feedbackId: ${item.id}`,
      msg("Opinion version: {0}",item.version ?? 1),
      msg("User opinion:"), item.text, '',
    ]),
    '',
    msg("First call list_feedback (or CLI feedbacks) with this reviewId and verify every ID, version and original text is still pending. Do not include opinions added after this batch."),
    msg("Verify the referenced review and code version against the current code. If they changed, inspect the difference before applying anything."),
    msg("Report conflicting opinions first. Apply and test compatible authorized corrections together, prepare one revised review, and record evidence for each opinion."),
    msg("This message does not authorize deployment, merging or additional scope."),
  ].join('\n');
}

async function copyFollowup(items, all = false) {
  const reviewId = state?.review?.id;
  if (busy || saving || !canCopy(items, reviewId, all)) return;
  const prompt = followupPrompt(items);
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(prompt);
    if (!canCopy(items, reviewId, all)) return;
    clearCopyFallback();
    setStatus(msg("Copied {0} opinions. Paste once into the original agent conversation and send.",items.length), false, all);
  } catch {
    if (!canCopy(items, reviewId, all)) return;
    fallbackFeedback = { items, reviewId, all };
    $('copy-fallback').hidden = false;
    $('followup-text').value = prompt;
    $('followup-text').focus();
    $('followup-text').select();
    setStatus(msg("Automatic copy is unavailable. Copy the selected instruction manually."), false, all);
  }
}

async function copyAllFeedback() {
  if (!isCurrent() || busy || saving || unsavedBlocks().length) return;
  busy = true;
  requestEpoch++;
  updateFreshness();
  try {
    const next = await api('/api/review');
    latest = next;
    online = true;
    state.feedbacks = next.feedbacks;
    if (state.review.id === next.review?.id) state.freshness = next.freshness;
    renderFeedback();
  } catch (error) {
    online = false;
    setStatus(error.message, true, true);
    return;
  } finally { busy = false; updateFreshness(); }
  if (!isCurrent()) { setStatus(msg("The code or review changed. Open the latest review before sending feedback."), true, true); return; }
  if (!collectedFeedback().length) { setStatus(msg("No pending opinions to send."), false, true); return; }
  await copyFollowup(collectedFeedback(), true);
}

async function submitFeedback() {
  if (!state?.sessionBound || !isCurrent() || busy || saving) return;
  const reviewId = state.review.id;
  const draftsToSave = unsavedBlocks().map(item => ({blockId:item.id,text:drafts.get(`${reviewId}:${state.review.fingerprint ?? ''}:${item.id}`)}));
  const items = collectedFeedback().map(({id,version}) => ({id,version:version ?? 1}));
  if (!items.length && !draftsToSave.length) return;
  busy = true;
  requestEpoch++;
  updateControls();
  try {
    for (const draft of draftsToSave) {
      const result = await api('/api/feedback', {reviewId,...draft});
      const saved = result.feedback ?? result;
      if (!saved.id || saved.reviewId !== reviewId || saved.blockId !== draft.blockId || saved.text !== draft.text) throw new Error(msg("Could not confirm the save response. Reconnect and check whether the opinion was saved."));
      state.feedbacks = [...(state.feedbacks ?? []).filter(item => item.id !== saved.id),saved];
      items.push({id:saved.id,version:saved.version ?? 1});
    }
    if (latest?.review?.id === reviewId) latest.feedbacks = state.feedbacks;
    renderFeedback();
    await api('/api/submit', {reviewId,items});
    setStatus(msg("Opinions submitted. In the original conversation, ask the agent to apply them."), false, true);
  } catch (error) { setStatus(error.message, true, true); }
  finally { busy = false; updateFreshness(); }
}

function requestAnnotation() {
  const saved = matchingFeedback();
  if (!canAnnotate || saved?.state !== 'pending' || !isCurrent()) return;
  const comment = `reviewId: ${state.review.id}\nblockId: ${block().id}\nfeedbackId: ${saved.id}\n${saved.text}`;
  try {
    const result = annotation.request($('selected-block'), { initialComment: comment, metadata: { reviewId: state.review.id, blockId: block().id, feedbackId: saved.id, fingerprint: state.review.fingerprint } });
    setStatus(result?.accepted === true
      ? msg("The host accepted the input request. Check the opened composer and send; delivery is not yet confirmed.")
      : msg("Could not confirm the input request. Copy the instruction to the original conversation."));
  } catch { setStatus(msg("Could not open the composer. Copy the instruction to the original conversation."), true); }
}

async function poll() {
  if (polling || busy || saving || document.hidden || !state) return;
  polling = true;
  const epoch = requestEpoch;
  try {
    const next = await api('/api/review');
    if (epoch !== requestEpoch) return;
    online = true;
    const oldFeedbacks = JSON.stringify(state.feedbacks);
    const oldHistory = JSON.stringify(latest?.history);
    const oldLatestId = latestId();
    latest = next;
    state.feedbacks = next.feedbacks;
    if (state.review?.id === next.review?.id) {
      state.freshness = next.freshness;
      state.history = next.history;
      state.previousReviewId = next.previousReviewId;
    } else if (!state.review && next.review) {
      applyState(next);
    }
    if (state.review && JSON.stringify(next.feedbacks) !== oldFeedbacks) renderFeedback();
    if (state.review && (oldLatestId !== latestId() || oldHistory !== JSON.stringify(next.history))) renderHistory();
    updateFreshness();
  } catch { if (epoch === requestEpoch) { online = false; updateFreshness(); } }
  finally { polling = false; }
}

function changeLanguage(value) {
  preserveDraft();
  locale = resolveLocale(value);
  msg = createTranslator(locale);
  refreshLabels();
  translateDocument(document,locale);
  $('language').value = locale;
  collectedSignature = '';
  clearCopyFallback();
  setStatus();
  if (state) applyState(state, { keepBlock: true });
  const parameters = new URLSearchParams(location.hash.slice(1));
  parameters.set('lang',locale);
  history.replaceState(null,'','#'+parameters.toString());
}

$('previous').addEventListener('click', () => selectBlock(index - 1, true));
$('next').addEventListener('click', () => selectBlock(index + 1, true));
$('opinion').addEventListener('input', () => { preserveDraft(); setStatus(); clearCopyFallback(); updateControls(); });
$('save-feedback').addEventListener('click', saveFeedback);
$('copy-followup').addEventListener('click', () => copyFollowup([matchingFeedback()]));
$('copy-all-feedback').addEventListener('click', copyAllFeedback);
$('submit-feedback').addEventListener('click', submitFeedback);
$('native-annotation').hidden = !canAnnotate;
$('native-annotation').addEventListener('click', requestAnnotation);
$('recapture').addEventListener('click', recapture);
$('refresh-review').addEventListener('click', recapture);
$('open-latest').addEventListener('click', () => openReview(latestId()));
$('previous-review').addEventListener('click', () => openReview(state.previousReviewId));
$('review-history').addEventListener('change', event => openReview(event.target.value));
$('retry').addEventListener('click', loadInitial);
document.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
  if (event.target.closest('textarea, input, select, button, a, summary, [contenteditable="true"], .diff-code')) return;
  if (event.key === 'ArrowLeft') { event.preventDefault(); selectBlock(index - 1, true); }
  if (event.key === 'ArrowRight') { event.preventDefault(); selectBlock(index + 1, true); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
translateDocument(document,locale);
$('language').value = locale;
$('language').addEventListener('change',event=>changeLanguage(event.target.value));
await loadInitial();
setInterval(poll, 4000);
