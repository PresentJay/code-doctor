import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {focusExcerpts,patchLineCount,patchRows} from '../src/reading.mjs';
import {createTranslator,resolveLocale,translateDocument} from '../web/i18n.mjs';

// Exercise the shipped handlers without a browser dependency; browser navigation is checked separately.
const app = (await readFile(new URL('../web/app.mjs', import.meta.url), 'utf8')).replace(/^import[^\n]+\n/gm, '');
const source = app.slice(0, app.indexOf("$('previous').addEventListener"));
class Element {
  constructor() { this.hidden = true; this.value = ''; this.children = []; this.classList = {toggle() {}}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute() {}
  addEventListener() {}
  focus() {}
  select() {}
}
const opinion = (id, blockId, extra = {}) => ({id, blockId, reviewId:'review-1', repoRoot:'/fixture', task:{text:'fixture'}, fingerprint:'sha', version:1, state:'pending', text:`원문 ${id}\n둘째 줄`, ...extra});
function fixture(clipboard = async () => { throw new Error('Clipboard unavailable'); },language = 'ko',sessionBound = false) {
  const review = {id:'review-1',fingerprint:'sha',summary:'Original agent summary',task:{text:'Original request',kind:'fix'},units:[],blocks:[{id:'a',title:'첫 변경',comment:'Original explanation',unitIds:[]},{id:'b',title:'둘째 변경',comment:'Second explanation',unitIds:[]}]};
  const initial = {review, sessionBound, latestReviewId:review.id, freshness:{state:'current'}, history:[], feedbacks:[opinion('one','a'), opinion('two','b'), opinion('old','a',{reviewId:'review-old'}), opinion('done','b',{state:'addressed',version:2})]};
  const elements = new Map();
  const document = {hidden:false,documentElement:{lang:language},querySelectorAll(){return [];}, getElementById(id) { if (!elements.has(id)) elements.set(id,new Element()); return elements.get(id); }, createElement() { return new Element(); }, createTextNode(text) { return {textContent:text}; }};
  let next = structuredClone(initial);
  const requests = [];
  const context = {document,focusExcerpts,patchLineCount,patchRows,createTranslator,resolveLocale,translateDocument,history:{replaceState(){}},window:{addEventListener() {}},location:{hash:'#lang='+language}, navigator:{clipboard:{writeText:clipboard}}, URLSearchParams,
    fetch:async (url, options) => {
      requests.push({url,method:options.method,...(options.body ? {body:JSON.parse(options.body)} : {})});
      if (url==='/api/feedback' && options.method==='POST') {
        const saved = opinion(`new-${requests.length}`,'a',JSON.parse(options.body)); next.feedbacks.push(saved);
        return {ok:true,json:async()=>structuredClone(saved)};
      }
      if (url==='/api/submit') return {ok:true,json:async()=>({})};
      return {ok:true,json:async()=>structuredClone(next)};
    }, initial:structuredClone(initial)};
  vm.runInNewContext(`${source}\nstate=initial; latest=initial; document.getElementById('selected-block').hidden=false;
    globalThis.testApi={copyAllFeedback,submitFeedback,poll,updateControls,changeLanguage,saveFeedback,renderUnit,identity:()=>JSON.stringify(state),copyOne:()=>copyFollowup([state.feedbacks[0]]),
      draft:(id,value)=>drafts.set('review-1:sha:'+id,value), saving:(value)=>{saving=value;},
      startOtherRequest:()=>{busy=true;}, isBusy:()=>busy,
      simulateSaveResponse:()=>{state.feedbacks=state.feedbacks.map(item=>({...item,feedbackFile:'/fixture/'+item.id}));},
      switchReview:()=>{state={...state,review:{...state.review,id:'review-other'}};}};`, context);
  return {api:context.testApi, el:id=>document.getElementById(id), requests, change(fn) { fn(next); }};
}

test('one submission saves drafts from both blocks and submits the exact pending set', async ()=>{
  const f=fixture(undefined,'ko',true);
  f.api.draft('a','검증용 첫 의견'); f.api.draft('b','검증용 둘째 의견');
  f.api.updateControls(); assert.equal(f.el('submit-feedback').disabled,false);
  await f.api.submitFeedback();
  const saved=f.requests.filter(request=>request.url==='/api/feedback');
  assert.deepEqual(saved.map(request=>[request.body.blockId,request.body.text]),[['a','검증용 첫 의견'],['b','검증용 둘째 의견']]);
  const sent=f.requests.find(request=>request.url==='/api/submit');
  assert.equal(sent.body.reviewId,'review-1');
  assert.deepEqual(sent.body.items.map(item=>item.id),['one','two','new-1','new-2']);
  assert.match(f.el('batch-status').textContent,/제출했습니다/);
});

test('one batch contains exact saved opinions across blocks, excluding other reviews and handled opinions', async () => {
  let copied;
  const f = fixture(async value => { copied = value; });
  await f.api.copyAllFeedback();
  assert.equal(typeof copied,'string',f.el('batch-status').textContent);
  assert.match(copied,/의견 2개/);
  assert.match(f.el('batch-status').textContent,/의견 2개를 복사/);
  for (const [id,block] of [['one','a'],['two','b']]) {
    assert.ok(copied.includes(`blockId: ${block}\nfeedbackId: ${id}\n의견 버전: 1\n사용자 의견:\n원문 ${id}\n둘째 줄`));
  }
  assert.match(copied,/reviewId: review-1/); assert.match(copied,/fingerprint: sha/);
  assert.doesNotMatch(copied,/feedbackId: (old|done)/);
  assert.deepEqual(f.requests,[{url:'/api/review',method:'GET'}]);
});

test('full diff counts suppressed blank context with the same coordinates as the guide', ()=>{
  const f = fixture();
  const rendered = f.api.renderUnit({file:'sample.py',stage:'worktree',patch:'@@ -1,3 +1,3 @@\n def answer():\n\n-    return 1\n+    return 2\n'});
  const code = rendered.children.find(node=>node.className==='diff-code');
  const added = code.children.find(node=>node.className==='diff-row addition');
  assert.equal(added.children[1].textContent,'3');
  assert.equal(code.children.filter(node=>node.className==='diff-row context-line').length,2);
});

test('viewer saves original feedback and keeps whitespace-only edits as unsaved before batch copying', async ()=>{
  let copied;
  const f = fixture(async value=>{copied=value;});
  const original = '\n    return 3\n\n';
  f.el('opinion').value=original;
  await f.api.saveFeedback();
  assert.equal(f.requests[0].body.text,original);
  await f.api.copyAllFeedback();
  assert.ok(copied.includes('사용자 의견:\n'+original));
  f.api.draft('a',original+' ');
  f.el('opinion').value=original+' ';
  f.api.updateControls();
  assert.equal(f.el('copy-all-feedback').disabled,true);
  assert.equal(f.el('save-feedback').disabled,false);
  const requests = f.requests.length;
  f.el('opinion').value=' \n\t';
  await f.api.saveFeedback();
  assert.equal(f.requests.length,requests,'whitespace-only input is still rejected');
});

test('unsaved opinion in another block blocks batch; saved drafts and handled drafts do not', async () => {
  const f = fixture();
  f.api.draft('a','원문 one\n둘째 줄');
  f.api.draft('b','아직 저장하지 않은 수정');
  f.api.updateControls();
  assert.equal(f.el('copy-all-feedback').disabled,true);
  assert.match(f.el('batch-help').textContent,/둘째 변경/);
  await f.api.copyAllFeedback();
  assert.equal(f.requests.length,0);
  f.api.draft('b','원문 done\n둘째 줄');
  f.api.updateControls();
  assert.equal(f.el('copy-all-feedback').disabled,false);
  f.api.saving(true);
  await f.api.copyAllFeedback();
  assert.equal(f.requests.length,0,'do not copy while an opinion is being saved');
});

test('batch refresh detects changed code, new review and resolved opinions before copying', async () => {
  for (const change of [state=>{state.freshness={state:'changed'};}, state=>{state.review.id='review-new';state.latestReviewId='review-new';}]) {
    let copied = false;
    const f = fixture(async()=>{copied=true;}); f.change(change);
    await f.api.copyAllFeedback();
    assert.equal(copied,false); assert.equal(f.el('copy-fallback').hidden,true);
  }
  let copied;
  const f = fixture(async value=>{copied=value;});
  f.change(state=>{state.feedbacks[0].state='addressed';state.feedbacks[0].version=2;});
  await f.api.copyAllFeedback();
  assert.match(copied,/feedbackId: two/); assert.doesNotMatch(copied,/feedbackId: one/);
});

test('manual batch fallback survives an unchanged poll and expires when its membership, version or source changes', async () => {
  for (const change of [
    state=>{state.feedbacks[0].state='dismissed';state.feedbacks[0].version=2;},
    state=>{state.feedbacks[0].version=2;},
    state=>{state.feedbacks.push(opinion('three','b'));},
    state=>{state.freshness={state:'changed'};},
    state=>{state.review.id='review-new';state.latestReviewId='review-new';},
  ]) {
    const f = fixture(); await f.api.copyAllFeedback();
    assert.equal(f.el('copy-fallback').hidden,false);
    await f.api.poll(); assert.equal(f.el('copy-fallback').hidden,false);
    f.change(change); await f.api.poll();
    assert.equal(f.el('copy-fallback').hidden,true);
    assert.equal(f.el('followup-text').value,'');
    assert.ok(f.requests.every(item=>item.method==='GET'));
  }
});

test('delayed clipboard failure cannot restore a batch after handling or switching the displayed review', async () => {
  for (const switchReview of [false,true]) {
    let reject;
    const pending = new Promise((_, fail)=>{reject=fail;});
    const f = fixture(()=>pending);
    const copy = f.api.copyAllFeedback();
    await new Promise(resolve=>setImmediate(resolve));
    if (switchReview) f.api.switchReview();
    else { f.change(state=>{state.feedbacks[0].state='addressed';state.feedbacks[0].version=2;}); await f.api.poll(); }
    reject(new Error('Clipboard failed')); await copy;
    assert.equal(f.el('copy-fallback').hidden,true);
    assert.equal(f.el('followup-text').value,'');
  }
});

test('individual archived opinion retains its original source identity', async () => {
  let copied;
  const f = fixture(async value=>{copied=value;});
  f.change(state=>{state.review.id='review-new';state.latestReviewId='review-new';});
  await f.api.poll(); await f.api.copyOne();
  assert.match(copied,/reviewId: review-1/); assert.match(copied,/fingerprint: sha/);
  assert.match(copied,/feedbackId: one/); assert.doesNotMatch(copied,/feedbackId: two/);
});

test('finishing a delayed clipboard request does not unlock another in-flight operation', async () => {
  let reject;
  const f=fixture(()=>new Promise((_,fail)=>{reject=fail;}));
  const copy=f.api.copyAllFeedback();
  await new Promise(resolve=>setImmediate(resolve));
  f.api.startOtherRequest();
  f.api.switchReview();
  reject(new Error('Clipboard failed')); await copy;
  assert.equal(f.api.isBusy(),true);
  assert.equal(f.el('copy-fallback').hidden,true);
});

test('unchanged polling preserves opinion list nodes for keyboard focus', async () => {
  const f=fixture(); f.api.simulateSaveResponse(); f.api.updateControls();
  const original=f.el('batch-list').children[0];
  await f.api.poll();
  assert.equal(f.el('batch-list').children[0],original);
  f.change(state=>{state.feedbacks.push(opinion('three','b'));});
  await f.api.poll();
  assert.notEqual(f.el('batch-list').children[0],original);
});

for (const language of ['en','ko','ja','zh-CN']) test(`language ${language} keeps original feedback, versions and unsaved drafts`, async () => {
  let copied;
  const f = fixture(async value=>{copied=value;},language);
  await f.api.copyAllFeedback();
  assert.ok(copied.includes('feedbackId: one'));
  assert.ok(copied.includes('feedbackId: two'));
  assert.ok(copied.includes('원문 one\n둘째 줄'));
  assert.ok(!copied.includes('feedbackId: old'));
  const identity = f.api.identity();
  f.el('opinion').value = 'Keep this draft 日本語 中文 한국어 <tag> {0}';
  const requests = f.requests.length;
  const nextLanguage = language === 'en' ? 'ja' : 'en';
  f.api.changeLanguage(nextLanguage);
  assert.equal(f.el('review-version').textContent,createTranslator(nextLanguage)('Review {0}','1'));
  assert.equal(f.el('opinion').value,'Keep this draft 日本語 中文 한국어 <tag> {0}');
  assert.equal(f.api.identity(),identity);
  assert.equal(f.requests.length,requests,'changing language must not call an API or model');
});
