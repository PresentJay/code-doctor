import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createService } from '../src/service.mjs';
import { startReviewServer } from '../src/viewer.mjs';

const entry = new URL('../bin/code-doctor.mjs', import.meta.url).pathname;
const git = (cwd,...args) => execFileSync('git',['-C',cwd,...args],{stdio:'pipe'});
const data = result => { assert.ok(!result.isError, result.content[0]?.text); return JSON.parse(result.content[0].text); };
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(),'code-doctor-viewer-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  git(root,'init','-q'); git(root,'config','user.email','test@example.invalid'); git(root,'config','user.name','Test');
  await writeFile(path.join(root,'.gitignore'),'.code-doctor/\n');
  await writeFile(path.join(root,'a.js'),'export const answer = 1;\n');
  git(root,'add','.'); git(root,'commit','-qm','fixture');
  const service = await createService(root);
  const viewer = await startReviewServer({service});
  t.after(()=>viewer.close());
  const url = new URL(viewer.url);
  const headers = {'X-Code-Doctor-Token':new URLSearchParams(url.hash.slice(1)).get('token')};
  const get = (route='/api/review', options={}) => fetch(url.origin+route,{...options,headers:{...headers,...options.headers}});
  const post = (route, value, options={}) => get(route,{method:'POST',body:JSON.stringify(value),...options,headers:{'Content-Type':'application/json',...options.headers}});
  return {root,service,viewer,url,headers,get,post};
}

test('loopback viewer withholds private code from unauthenticated/cross-origin and arbitrary path requests', async t=>{
  const {root,service,url,headers,get,post} = await fixture(t);
  await writeFile(path.join(root,'a.js'),'export const privateMarker = 2;\n');
  await service.capture();
  const unauth = await fetch(url.origin+'/api/review');
  assert.equal(unauth.status,401); assert.doesNotMatch(await unauth.text(),/privateMarker/);
  assert.equal((await get('/api/review',{headers:{Origin:'https://example.invalid'}})).status,403);
  assert.equal((await get('/api/review',{headers:{Origin:url.origin}})).status,200);
  const wrongHost = await new Promise((resolve,reject)=>{
    const req = http.get(url.origin+'/api/review',{headers:{...headers,Host:'attacker.invalid'}},response=>{response.resume(); resolve(response.statusCode);});
    req.on('error',reject);
  });
  assert.equal(wrongHost,403);
  for (const route of ['/a.js','/.git/config','/../a.js','/api/unknown']) assert.equal((await get(route)).status,404,route);
  const page = await get('/');
  assert.equal(page.status,200); assert.match(await page.text(),/\/app.mjs/);
  assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal(page.headers.get('cache-control'),'no-store');
  assert.equal((await get('/app.mjs')).status,200);
  assert.equal((await get('/reading.mjs')).status,200);
  assert.equal((await get('/service.mjs')).status,404);
  assert.equal((await get('/api/review?path=a.js')).status,400);
  assert.equal((await post('/api/feedback',{text:'x'.repeat(65536)})).status,413);
  assert.equal((await post('/api/feedback',{}, {headers:{'Content-Type':'text/plain'}})).status,415);
  assert.equal((await post('/api/recapture',{repo:'/tmp',task:'unexpected'})).status,400);
  assert.equal(await readFile(path.join(root,'a.js'),'utf8'),'export const privateMarker = 2;\n');
});

test('browser feedback, CLI/MCP correction, context-preserving recapture and archived resolution share one service', async t=>{
  const {root,service,get,post} = await fixture(t);
  assert.equal((await (await get()).json()).review,null);
  const context = {requirements:['값을 3으로 바꾼다'],acceptanceCriteria:['answer가 3이다'],references:[{title:'요구',source:'issue:fixture'}]};
  const initial = await service.capture({task:'값 수정',kind:'fix',context});
  assert.deepEqual(initial.blocks,[]);
  await writeFile(path.join(root,'a.js'),'export const answer = 2;\n');
  const review = (await (await post('/api/recapture',{})).json()).review;
  const input = {reviewId:review.id,blockId:review.blocks[0].id,text:'[검증용] answer를 3으로 바꿔주세요'};
  const saved = await (await post('/api/feedback',input)).json();
  assert.equal(saved.text,input.text); assert.equal(saved.state,'pending');
  const cli = JSON.parse(execFileSync(process.execPath,[entry,'feedbacks','--repo',root],{encoding:'utf8'}));
  assert.equal(cli[0].id,saved.id);
  const client = new Client({name:'viewer-test',version:'1.0.0'});
  t.after(()=>client.close());
  await client.connect(new StdioClientTransport({command:process.execPath,args:[entry,'mcp','--repo',root],stderr:'pipe'}));
  assert.equal(data(await client.callTool({name:'list_feedback',arguments:{}}))[0].id,saved.id);
  const openedViews = await Promise.all(Array.from({length:4},async()=>data(await client.callTool({name:'open_review',arguments:{}}))));
  assert.equal(new Set(openedViews.map(item=>item.url)).size,1,'Concurrent opens reuse one in-flight server');
  const opened = openedViews[0];
  const mcpUrl = new URL(opened.url);
  const mcpState = await (await fetch(mcpUrl.origin+'/api/review',{headers:{'X-Code-Doctor-Token':new URLSearchParams(mcpUrl.hash.slice(1)).get('token')}})).json();
  assert.equal(mcpState.review.id,review.id);
  assert.equal(mcpState.feedbacks[0].id,saved.id);
  await mkdir(path.join(root,'.code-doctor','write.lock'));
  const busy = await post('/api/feedback',{...input,text:'busy'});
  assert.equal(busy.status,409); assert.equal((await busy.json()).code,'busy');
  await rm(path.join(root,'.code-doctor','write.lock'),{recursive:true});
  await writeFile(path.join(root,'a.js'),'export const answer = 3;\n');
  const stale = await post('/api/feedback',{...input,text:'stale'});
  assert.equal(stale.status,409); assert.equal((await stale.json()).code,'stale');
  assert.equal((await service.feedbacks()).length,1);
  const revised = await (await post('/api/recapture',{})).json();
  assert.deepEqual(revised.review.task.context,context); assert.equal(revised.previousReviewId,review.id);
  const resolved = data(await client.callTool({name:'resolve_feedback',arguments:{feedbackId:saved.id,expectedVersion:1,reviewId:revised.review.id,resolution:'addressed',note:'새 diff에서 answer = 3을 확인했습니다'}}));
  assert.equal(resolved.state,'addressed');
  const old = await (await get(`/api/review?reviewId=${review.id}`)).json();
  assert.equal(old.review.id,review.id); assert.equal(old.latestReviewId,revised.review.id);
  assert.equal(old.freshness.state,'changed'); assert.equal(old.feedbacks[0].resolvedReviewId,revised.review.id);
  assert.ok((await readdir(path.join(root,'.code-doctor'))).every(name=>!name.endsWith('.tmp')));
});

test('CLI serve prints a usable local URL and exits without a background daemon', async t=>{
  const {root} = await fixture(t);
  const child = spawn(process.execPath,[entry,'serve','--repo',root],{stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill());
  let output = '';
  const opened = await new Promise((resolve,reject)=>{
    child.stdout.on('data',chunk=>{output+=chunk; try {resolve(JSON.parse(output));} catch {}});
    child.once('error',reject); child.once('exit',()=>reject(new Error('serve exited before URL')));
  });
  const url = new URL(opened.url);
  assert.equal((await fetch(url.origin)).status,200);
  const exited = once(child,'exit'); child.kill('SIGTERM'); await exited;
  await assert.rejects(()=>fetch(url.origin));
});
