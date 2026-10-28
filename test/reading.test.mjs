import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { applyPlan, validateReview } from '../src/review.mjs';
import { createService } from '../src/service.mjs';
import { blockContent, focusExcerpts, patchRows } from '../src/reading.mjs';

const entry = new URL('../bin/code-doctor.mjs',import.meta.url).pathname;
const git = (cwd,...args) => execFileSync('git',['-C',cwd,...args],{stdio:'pipe'});
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(),'code-doctor-reading-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  git(root,'init','-q'); git(root,'config','user.name','Test'); git(root,'config','user.email','test@example.invalid');
  await writeFile(path.join(root,'.gitignore'),'.code-doctor/\n');
  await writeFile(path.join(root,'tracked.mjs'),Array.from({length:120},(_,i)=>`export const value${i+1} = ${i+1};`).join('\n')+'\n');
  git(root,'add','.'); git(root,'commit','-qm','fixture');
  await writeFile(path.join(root,'long.mjs'),Array.from({length:120},(_,i)=>`export const added${i+1} = ${i+1};`).join('\n')+'\n');
  const service = await createService(root);
  const review = await service.capture({task:'새 값 파일을 검토한다',kind:'experiment'});
  const unit = review.units[0];
  const focus = [{unitId:unit.id,side:'new',startLine:60,endLine:62}];
  return {root,service,review,unit,focus};
}

test('focused CLI and actual MCP return the same verified short code while full inventory and patches remain retrievable', async t=>{
  const {root,service,review,unit,focus} = await fixture(t);
  const planned = await service.plan({reviewId:review.id,summary:'중간 세 줄부터 읽습니다.',blocks:[{...review.blocks[0],focus}]});
  assert.notEqual(planned.id,review.id); assert.equal(planned.fingerprint,review.fingerprint); assert.deepEqual(planned.units,review.units);
  const packet = await service.block();
  assert.equal(packet.view,'focus'); assert.equal(packet.units.length,review.units.length); assert.ok(!Object.hasOwn(packet.units[0],'patch'));
  assert.deepEqual(packet.excerpts[0].rows.map(row=>row.text),[60,61,62].map(i=>`export const added${i} = ${i};`));
  assert.deepEqual(packet.excerpts[0].rows.map(row=>row.newLine),[60,61,62]);
  assert.equal(packet.sourceStats.visibleLines,3); assert.ok(packet.sourceStats.fullPatchLines > 120);
  const cli = JSON.parse(execFileSync(process.execPath,[entry,'block','--repo',root],{encoding:'utf8'}));
  assert.deepEqual(cli,packet);
  const full = JSON.parse(execFileSync(process.execPath,[entry,'block','--view','full','--repo',root],{encoding:'utf8'}));
  assert.equal(full.view,'full'); assert.deepEqual(full.units,[unit]); assert.deepEqual(full.excerpts,[]);
  const client = new Client({name:'focused-test',version:'1.0.0'});
  t.after(()=>client.close());
  await client.connect(new StdioClientTransport({command:process.execPath,args:[entry,'mcp','--repo',root],stderr:'pipe'}));
  const result = await client.callTool({name:'read_block',arguments:{}});
  assert.ok(!result.isError,result.content[0]?.text); assert.deepEqual(JSON.parse(result.content[0].text),packet);
  const mcpFull = await client.callTool({name:'read_block',arguments:{view:'full'}});
  assert.deepEqual(JSON.parse(mcpFull.content[0].text).units,full.units);
  const invalid = await client.callTool({name:'plan_review',arguments:{reviewId:planned.id,summary:'위조',blocks:[{...planned.blocks[0],focus:[{...focus[0],text:'invented'}]}]}});
  assert.equal(invalid.isError,true);
  const original = await service.block({reviewId:review.id});
  assert.equal(original.view,'full'); assert.deepEqual(original.units,[unit]);
  await assert.rejects(()=>service.feedback({reviewId:review.id,blockId:review.blocks[0].id,text:'이전 발췌 의견'}),/Review changed/);
  assert.equal((await service.feedback({reviewId:planned.id,blockId:planned.blocks[0].id,text:'현재 발췌 의견'})).reviewId,planned.id);
  const reselected = await service.plan({reviewId:planned.id,summary:planned.summary,blocks:[{...planned.blocks[0],focus:[{...focus[0],endLine:63}]}]});
  assert.notEqual(reselected.id,planned.id); assert.equal(reselected.fingerprint,planned.fingerprint);
  assert.equal(validateReview({...planned,blocks:reselected.blocks}).valid,false);
});

test('one guide read supplies all ordered code and feedback targets through CLI and MCP without a viewer', async t=>{
  const {root,service} = await fixture(t);
  const tracked = Array.from({length:120},(_,i)=>`export const value${i+1} = ${i+1};`);
  tracked[60] = 'export const value61 = 999;';
  await writeFile(path.join(root,'tracked.mjs'),tracked.join('\n')+'\n');
  await writeFile(path.join(root,'binary.dat'),Buffer.from([0,1,2]));
  await writeFile(path.join(root,'empty.txt'),'');
  const captured = await service.capture();
  const byFile = file => captured.units.filter(unit=>unit.file===file).map(unit=>unit.id);
  const changed = byFile('tracked.mjs')[0], added = byFile('long.mjs')[0];
  const planned = await service.plan({reviewId:captured.id,summary:'요청 밖의 값 변경부터 확인하고 새 파일을 읽습니다.',blocks:[
    {id:'unexpected',title:'요청 밖의 값 변경',comment:'61을 999로 바꿀 이유가 없습니다.',importance:'high',relation:'extra',unitIds:[changed],focus:[{unitId:changed,side:'old',startLine:61,endLine:61},{unitId:changed,side:'new',startLine:61,endLine:61}]},
    {id:'binary',title:'바이너리도 목록에 남김',comment:'텍스트로 설명할 수 없는 변경입니다.',importance:'normal',relation:'unknown',unitIds:byFile('binary.dat')},
    {id:'added',title:'새 값과 빈 파일',comment:'새 값의 핵심 줄과 함께 빈 파일도 포함합니다.',importance:'low',relation:'supporting',unitIds:[...byFile('long.mjs'),...byFile('empty.txt')],focus:[{unitId:added,side:'new',startLine:60,endLine:62}]},
  ]});
  const before = await readFile(path.join(root,'.code-doctor/review.json'),'utf8');
  const guide = await service.read({view:'guide'});
  assert.equal(guide.view,'guide'); assert.equal(guide.id,planned.id); assert.equal(guide.latestReviewId,planned.id);
  assert.equal(guide.freshness.state,'current'); assert.deepEqual(guide.task,planned.task);
  for (const key of ['repoRoot','base','baseCommit','headCommit','fingerprint']) assert.equal(guide[key],planned[key]);
  assert.deepEqual(guide.blocks.map(block=>block.id),['unexpected','binary','added']);
  assert.deepEqual(guide.units,planned.units.map(({patch,...unit})=>unit));
  assert.deepEqual(guide.blocks.flatMap(block=>block.units.map(unit=>unit.id)).sort(),planned.units.map(unit=>unit.id).sort());
  assert.deepEqual(guide.blocks[0].excerpts.map(excerpt=>[excerpt.file,excerpt.side,excerpt.startLine,excerpt.rows[0].text]),[
    ['tracked.mjs','old',61,'export const value61 = 61;'],['tracked.mjs','new',61,'export const value61 = 999;'],
  ]);
  assert.equal(guide.blocks[0].view,'focus'); assert.ok(!Object.hasOwn(guide.blocks[0].units[0],'patch'));
  assert.equal(guide.blocks[1].view,'full'); assert.equal(guide.blocks[1].units[0].binary,true);
  assert.equal(guide.blocks[2].units.length,2); assert.equal(guide.blocks[2].sourceStats.visibleLines,3);
  assert.equal(guide.blocks[2].excerpts[0].rows[1].text,'export const added61 = 61;');
  assert.equal(guide.blocks[0].coverage.changedLines,2);
  assert.equal(guide.blocks[0].coverage.shownChangedLines,2);
  assert.deepEqual(guide.blocks[0].coverage.unshown,[]);
  assert.deepEqual(guide.blocks[1].coverage.nonLineUnitIds,byFile('binary.dat'));
  assert.equal(guide.blocks[2].coverage.changedLines,120);
  assert.equal(guide.blocks[2].coverage.shownChangedLines,3);
  assert.deepEqual(guide.blocks[2].coverage.unshown,[
    {unitId:added,file:'long.mjs',stage:'untracked',side:'new',startLine:1,endLine:59},
    {unitId:added,file:'long.mjs',stage:'untracked',side:'new',startLine:63,endLine:120},
  ]);
  assert.deepEqual(guide.blocks[2].coverage.nonLineUnitIds,byFile('empty.txt'));
  assert.deepEqual(JSON.parse(execFileSync(process.execPath,[entry,'read','--view','guide','--repo',root],{encoding:'utf8'})),guide);
  const client = new Client({name:'complete-guide-test',version:'1.0.0'});
  t.after(()=>client.close());
  await client.connect(new StdioClientTransport({command:process.execPath,args:[entry,'mcp','--repo',root],stderr:'pipe'}));
  const call = async (name,args)=>{
    const result = await client.callTool({name,arguments:args});
    assert.ok(!result.isError,result.content[0]?.text);
    return JSON.parse(result.content[0].text);
  };
  assert.deepEqual(await call('read_review',{view:'guide'}),guide);
  assert.equal(await readFile(path.join(root,'.code-doctor/review.json'),'utf8'),before);
  assert.deepEqual(await service.read(),planned,'the guide must not replace the original review');
  const original = await service.read({reviewId:captured.id,view:'guide'});
  assert.ok(original.blocks.every(block=>block.view==='full'));
  assert.deepEqual(original.blocks.flatMap(block=>block.units).sort((a,b)=>a.id.localeCompare(b.id)),[...captured.units].sort((a,b)=>a.id.localeCompare(b.id)));
  await writeFile(path.join(root,'.code-doctor/review.json'),JSON.stringify({...planned,units:planned.units.map((unit,i)=>i ? unit : {...unit,patch:unit.patch+'tampered'})}));
  await assert.rejects(()=>service.read({view:'guide'}));
  await writeFile(path.join(root,'.code-doctor/review.json'),before);
  const comments = [['unexpected','이 값 변경은 빼 줘.'],['added','61번째 새 값은 62로 바꿔 줘.']];
  for (const [blockId,text] of comments) await call('record_feedback',{reviewId:guide.id,blockId,text});
  const opinions = await call('list_feedback',{reviewId:guide.id});
  assert.deepEqual(opinions.map(opinion=>[opinion.blockId,opinion.text]).sort(),comments.sort());
  assert.ok(opinions.every(opinion=>opinion.fingerprint===guide.fingerprint && opinion.version===1));
  tracked[60] = 'export const value61 = 61;';
  await writeFile(path.join(root,'tracked.mjs'),tracked.join('\n')+'\n');
  const long = Array.from({length:120},(_,i)=>`export const added${i+1} = ${i+1};`);
  long[60] = 'export const added61 = 62;';
  await writeFile(path.join(root,'long.mjs'),long.join('\n')+'\n');
  const revised = await service.capture();
  const old = await call('read_review',{reviewId:guide.id,view:'guide'});
  assert.equal(old.latestReviewId,revised.id); assert.equal(old.freshness.state,'changed');
  assert.deepEqual(old.blocks,guide.blocks,'old code and annotation targets must stay bound to their revision');
  const rejected = await client.callTool({name:'record_feedback',arguments:{reviewId:guide.id,blockId:'added',text:'오래된 코드의 의견'}});
  assert.equal(rejected.isError,true);
  for (const opinion of opinions) await call('resolve_feedback',{feedbackId:opinion.id,expectedVersion:opinion.version,reviewId:revised.id,resolution:'addressed',note:'두 요청을 함께 수정한 새 캡처에서 확인함.'});
  assert.deepEqual(await call('list_feedback',{reviewId:guide.id}),[]);
});

test('unshown changes keep every file, stage and old/new coordinate instead of treating a focused block as fully shown', async t=>{
  const {root,service} = await fixture(t);
  git(root,'mv','tracked.mjs','renamed.mjs');
  const text = Array.from({length:120},(_,i)=>`export const value${i+1} = ${i+1};`);
  text[60] = 'export const value61 = 999;';
  await writeFile(path.join(root,'renamed.mjs'),text.join('\n')+'\n');
  git(root,'add','renamed.mjs');
  text[60] = 'export const value61 = 1000;';
  await writeFile(path.join(root,'renamed.mjs'),text.join('\n')+'\n');
  const review = await service.capture();
  const index = review.units.find(u=>u.file==='renamed.mjs' && u.stage==='index');
  const worktree = review.units.find(u=>u.file==='renamed.mjs' && u.stage==='worktree');
  const added = review.units.find(u=>u.file==='long.mjs');
  const planned = await service.plan({reviewId:review.id,summary:'파일을 함께 읽되 발췌 범위를 구분합니다.',blocks:[{
    id:'behavior',title:'여러 단계의 값 변경',comment:'발췌 밖에도 변경이 있습니다.',importance:'high',unitIds:review.units.map(u=>u.id),
    focus:[{unitId:index.id,side:'old',startLine:61,endLine:61}],
  }]});
  const block = await service.block();
  assert.equal(block.excerpts[0].file,'tracked.mjs');
  assert.equal(block.coverage.changedLines,124); assert.equal(block.coverage.shownChangedLines,1);
  assert.deepEqual(block.coverage.unshown,[
    {unitId:index.id,file:'renamed.mjs',stage:'index',side:'new',startLine:61,endLine:61},
    {unitId:worktree.id,file:'renamed.mjs',stage:'worktree',side:'old',startLine:61,endLine:61},
    {unitId:worktree.id,file:'renamed.mjs',stage:'worktree',side:'new',startLine:61,endLine:61},
    {unitId:added.id,file:'long.mjs',stage:'untracked',side:'new',startLine:1,endLine:120},
  ]);
  const guide = await service.read({view:'guide'});
  assert.deepEqual(guide.blocks[0].coverage,block.coverage);
  const full = await service.block({view:'full'});
  assert.equal(full.coverage.changedLines,124); assert.equal(full.coverage.shownChangedLines,124);
  assert.deepEqual(full.coverage.unshown,[]); assert.deepEqual(full.units,planned.units);
  assert.equal((await service.read()).id,planned.id,'coverage is a read projection, not a new review revision');
});

for (const metadata of ['rename','mode','both']) test(`focused code retains ${metadata} metadata alongside text changes`, async t=>{
  const {root,service} = await fixture(t);
  const file=metadata === 'mode' ? 'tracked.mjs' : 'renamed.mjs';
  if (metadata !== 'mode') git(root,'mv','tracked.mjs',file);
  const text = Array.from({length:120},(_,i)=>`export const value${i+1} = ${i+1};`);
  text[60] = 'export const value61 = 999;';
  await writeFile(path.join(root,file),text.join('\n')+'\n');
  if (metadata !== 'rename') await chmod(path.join(root,file),0o755);
  git(root,'add',file);
  const captured=await service.capture();
  const changed=captured.units.find(unit=>unit.file===file && unit.stage==='index');
  if (metadata !== 'mode') assert.equal(changed.previousFile,'tracked.mjs');
  if (metadata !== 'rename') assert.notEqual(changed.oldMode,changed.newMode);
  const planned=await service.plan({reviewId:captured.id,summary:'Read code and metadata',blocks:[{
    id:'all',title:'Changes',comment:'Check code and file metadata',importance:'high',unitIds:captured.units.map(unit=>unit.id),
    focus:[{unitId:changed.id,side:'new',startLine:61,endLine:61}],
  }]});
  const block=await service.block();
  assert.ok(block.coverage.nonLineUnitIds.includes(changed.id));
  assert.ok(!block.coverage.nonLineUnitIds.includes(captured.units.find(unit=>unit.file==='long.mjs').id));
  assert.equal(block.excerpts[0].rows[0].text,'export const value61 = 999;');
  assert.deepEqual((await service.read({view:'guide'})).blocks[0].coverage,block.coverage);
  assert.equal((await service.block({view:'full'})).units.find(unit=>unit.id===changed.id).patch,changed.patch);
  assert.equal((await service.read()).id,planned.id);
});

test('focused new executable retains its permission signal', async t=>{
  const {root,service}=await fixture(t);
  await chmod(path.join(root,'long.mjs'),0o755);
  const captured=await service.capture();
  const unit=captured.units.find(item=>item.file==='long.mjs');
  assert.equal(unit.oldMode,'000000'); assert.equal(unit.newMode,'100755');
  await service.plan({reviewId:captured.id,summary:'Review new executable',blocks:[{
    id:'new',title:'New executable',comment:'Check code and executable mode',importance:'high',unitIds:[unit.id],
    focus:[{unitId:unit.id,side:'new',startLine:61,endLine:61}],
  }]});
  assert.deepEqual((await service.block()).coverage.nonLineUnitIds,[unit.id]);
});

test('focus rejects missing, fabricated, foreign, overlapping and excessive ranges with valid boundary controls', async t=>{
  const {review,unit,focus} = await fixture(t);
  const plan = selection => applyPlan(review,{summary:'검토',blocks:[{...review.blocks[0],focus:selection}]});
  assert.equal(validateReview(plan(focus)).valid,true);
  for (const selection of [null,[],Array.from({length:4},()=>focus[0]),[{...focus[0],side:'both'}],[{...focus[0],startLine:0}],[{...focus[0],endLine:1}],[{...focus[0],startLine:1.5}],[{...focus[0],endLine:Infinity}],[{...focus[0],unitId:'fabricated'}],[{...focus[0],text:'invented'}],[{...focus[0],startLine:1,endLine:41}],[{...focus[0],startLine:120,endLine:121}],[focus[0],focus[0]],[{unitId:unit.id,side:'new',startLine:1,endLine:40},{unitId:unit.id,side:'new',startLine:41,endLine:80},{unitId:unit.id,side:'new',startLine:81,endLine:81}]]) assert.throws(()=>plan(selection));
  assert.equal(validateReview(plan([{...focus[0],startLine:1,endLine:40},{...focus[0],startLine:41,endLine:80}])).valid,true);
  const binary = {...unit,id:'binary',binary:true};
  assert.throws(()=>focusExcerpts([binary],{unitIds:[binary.id],focus:[{...focus[0],unitId:binary.id}]}),/text unit/);
  assert.throws(()=>focusExcerpts([unit],{unitIds:['other-block'],focus}),/assigned/);
  assert.equal(applyPlan(review,{summary:review.summary,blocks:review.blocks}).id,review.id,'Plans without focus preserve legacy identities');
});

test('old/new excerpts preserve rename paths, exact line coordinates and no-newline data; unchanged context and hunk gaps fail', ()=>{
  const unit = {id:'changed',file:'after.mjs',previousFile:'before.mjs',stage:'index',binary:false,patch:'diff --git a/before.mjs b/after.mjs\n--- a/before.mjs\n+++ b/after.mjs\n@@ -5,3 +8,3 @@\n context\n-old value\n+new <img onerror=bad> value\n tail\n\\ No newline at end of file\n@@ -100 +103 @@\n-last old\n+last new\n'};
  const range = {unitId:unit.id,side:'old',startLine:6,endLine:6};
  const block = {unitIds:[unit.id],focus:[range,{...range,side:'new',startLine:9,endLine:9}]};
  const excerpts = focusExcerpts([unit],block);
  assert.equal(excerpts[0].file,'before.mjs'); assert.equal(excerpts[0].rows[0].text,'old value');
  assert.equal(excerpts[1].file,'after.mjs'); assert.equal(excerpts[1].rows[0].text,'new <img onerror=bad> value');
  assert.deepEqual(patchRows(unit.patch).map(row=>[row.oldLine,row.newLine]),[[5,8],[6,null],[null,9],[7,10],[100,null],[null,103]]);
  const content = blockContent({units:[unit]},block);
  assert.equal(content.coverage.changedLines,4); assert.equal(content.coverage.shownChangedLines,2);
  assert.deepEqual(content.coverage.unshown,[
    {unitId:unit.id,file:'before.mjs',stage:'index',side:'old',startLine:100,endLine:100},
    {unitId:unit.id,file:'after.mjs',stage:'index',side:'new',startLine:103,endLine:103},
  ]);
  assert.throws(()=>focusExcerpts([unit],{...block,focus:[{...range,startLine:5,endLine:5}]}),/changed line/);
  assert.throws(()=>focusExcerpts([unit],{...block,focus:[{...range,startLine:7,endLine:8}]}),/contiguously/);
  assert.throws(()=>focusExcerpts([{...unit,patch:'rename from before.mjs\nrename to after.mjs\n'}],{...block,focus:[range]}),/contiguously/);
});

test('suppressed blank context keeps staged, worktree and archived guide coordinates', async t=>{
  for (const suppress of ['false','true']) {
    const {root,service} = await fixture(t);
    await rm(path.join(root,'long.mjs'));
    await writeFile(path.join(root,'sample.py'),'def answer():\n\n    return 1\n');
    git(root,'add','sample.py'); git(root,'commit','-qm','Python fixture');
    git(root,'config','diff.suppressBlankEmpty',suppress);
    await writeFile(path.join(root,'sample.py'),'def answer():\n\n    return 2\n');
    git(root,'add','sample.py');
    await writeFile(path.join(root,'sample.py'),'def answer():\n\n    return 3\n');
    const review = await service.capture({base:'HEAD'});
    assert.deepEqual(review.units.map(unit=>unit.stage).sort(),['index','worktree']);
    for (const unit of review.units) {
      assert.deepEqual(patchRows(unit.patch).map(row=>[row.oldLine,row.newLine]),[[1,1],[2,2],[3,null],[null,3]]);
      const range = {unitId:unit.id,side:'new',startLine:1,endLine:3};
      assert.equal(focusExcerpts([unit],{unitIds:[unit.id],focus:[range]})[0].rows[1].text,'');
      assert.throws(()=>focusExcerpts([unit],{unitIds:[unit.id],focus:[{...range,startLine:2,endLine:2}]}),/changed line/);
    }
    const planned = await service.plan({reviewId:review.id,summary:'Read the actual third line.',blocks:review.units.map(unit=>({id:unit.stage,title:unit.stage,comment:'The return changes on line 3.',importance:'normal',unitIds:[unit.id],focus:[{unitId:unit.id,side:'new',startLine:3,endLine:3}]}))});
    const saved = await readFile(path.join(root,'.code-doctor/review.json'),'utf8');
    const guide = await service.read({view:'guide'});
    assert.deepEqual(guide.blocks.map(block=>block.excerpts[0].rows[0].newLine),[3,3]);
    assert.deepEqual(guide.blocks.flatMap(block=>block.coverage.unshown.map(range=>range.startLine)),[3,3]);
    assert.equal((await service.read({reviewId:review.id})).id,review.id);
    assert.equal((await service.read()).id,planned.id);
    assert.equal(await readFile(path.join(root,'.code-doctor/review.json'),'utf8'),saved);
  }
});

test('blank context respects hunk boundaries without phantom final rows or no-newline notes', ()=>{
  const patch = '@@ -1,3 +1,3 @@\n line\n\n-old\n+new\n\\ No newline at end of file\n@@ -8,2 +8,2 @@\n-before\n+after\n\n';
  assert.deepEqual(patchRows(patch).map(row=>[row.oldLine,row.newLine,row.text]),[
    [1,1,'line'],[2,2,''],[3,null,'old'],[null,3,'new'],[8,null,'before'],[null,8,'after'],[9,9,''],
  ]);
  assert.deepEqual(patchRows('@@ -1 +1 @@\n-old\n+new\n').map(row=>row.type),['deletion','addition']);
});
