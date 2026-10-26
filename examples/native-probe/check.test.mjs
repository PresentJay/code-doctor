import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { makeReview, makeFeedback, revision, feedbackText } from './core.mjs';
const file = fileURLToPath(new URL('./fixture/profile.mjs', import.meta.url));
const code = await readFile(file, 'utf8');
const before = await readFile(new URL('./fixture/before.mjs', import.meta.url), 'utf8');
const review = makeReview(code, before, file);
const input = { blockId:'retry-scope', revision:review.revision, text:'재시도만 빼고 오류 반환은 유지해줘.' };

test('the selected block carries real source, exact file, lines and version', () => {
  const feedback = makeFeedback(review, code, input);
  assert.equal(review.code, code);
  assert.equal(feedback.file, file);
  assert.equal(feedback.revision, revision(code));
  assert.equal(feedback.text, input.text);
  assert.equal(feedback.status, 'saved-not-sent');
  assert.ok(feedback.end <= code.trimEnd().split('\n').length);
  assert.ok(feedbackText(feedback).includes(file));
  assert.ok(feedbackText(feedback).includes(review.task));
});

test('stale source and stale client revision are rejected, unchanged source accepted', () => {
  assert.doesNotThrow(() => makeFeedback(review, code, input));
  assert.throws(() => makeFeedback(review, code + '\n// changed', input), /Code changed/);
  assert.throws(() => makeFeedback(review, code, {...input,revision:'older'}), /Code changed/);
});

test('unknown blocks and empty or oversized feedback cannot target code', () => {
  assert.throws(() => makeFeedback(review, code, {...input,blockId:'invented'}), /Unknown/);
  assert.throws(() => makeFeedback(review, code, {...input,text:' '}), /Enter feedback/);
  assert.throws(() => makeFeedback(review, code, {...input,text:'x'.repeat(4001)}), /Enter feedback/);
});

test('the sample really has error output, successful output and additional requests', async () => {
  const {loadProfile} = await import('./fixture/profile.mjs');
  let requests = 0;
  const result = await loadProfile(async () => { requests++; throw new Error('network failed'); });
  assert.deepEqual(result, {ok:false,error:'network failed'});
  assert.equal(requests, code.includes('attempt < 3') ? 3 : 1);
  assert.deepEqual(await loadProfile(async () => ({ok:true,json:async()=>({name:'demo'})})), {ok:true,data:{name:'demo'}});
});
