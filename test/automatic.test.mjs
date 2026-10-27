import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath,symlink,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const entry = fileURLToPath(new URL('../bin/code-doctor.mjs',import.meta.url));
async function fixture(t) {
 const dir = await realpath(await mkdtemp(path.join(tmpdir(),"code-doctor-auto-'-$-")));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const home=path.join(dir,'home'),repo=path.join(dir,'project'),other=path.join(dir,'other');
 for(const file of [home,repo,other])await mkdir(file);
 for(const file of [repo,other])execFileSync('git',['init','-q',file]);
 const env={...process.env,HOME:home,CODEX_HOME:path.join(home,'.codex'),CLAUDE_CONFIG_DIR:path.join(home,'.claude')};
 const cli=(...args)=>JSON.parse(execFileSync(process.execPath,[entry,...args],{env,encoding:'utf8',stdio:'pipe'}));
 const hook=(cwd=repo,session='session-a',extra={})=>execFileSync(process.execPath,[entry,'hook'],{env,encoding:'utf8',input:JSON.stringify({hook_event_name:'UserPromptSubmit',cwd,session_id:session,prompt:'Fix the total calculation',...extra}),stdio:'pipe'});
 return {dir,home,repo,other,env,cli,hook};
}
test('one installation preserves settings and its actual commands guide ordinary prompts in both hosts',async t=>{
 const f=await fixture(t);
 await mkdir(path.join(f.home,'.codex'));await mkdir(path.join(f.home,'.claude'));
 const unrelated={hooks:[{type:'command',command:'echo unrelated'}]};
 for(const file of ['.codex/hooks.json','.claude/settings.json'])await writeFile(path.join(f.home,file),JSON.stringify({custom:'preserve',hooks:{Stop:[unrelated],UserPromptSubmit:[unrelated]}}),{mode:0o640});
 f.cli('install');
 for(const file of ['.codex/hooks.json','.claude/settings.json']){
  const full=path.join(f.home,file),text=await readFile(full,'utf8'),config=JSON.parse(text);
  assert.equal(config.custom,'preserve');assert.deepEqual(config.hooks.Stop,[unrelated]);assert.deepEqual(config.hooks.UserPromptSubmit[0],unrelated);assert.equal(config.hooks.UserPromptSubmit.length,2);
  assert.equal((await stat(full)).mode & 0o777,0o640);
  const output=execFileSync('/bin/sh',['-c',config.hooks.UserPromptSubmit[1].hooks[0].command],{env:f.env,encoding:'utf8',input:JSON.stringify({hook_event_name:'UserPromptSubmit',cwd:f.repo,session_id:'abc',prompt:'Fix the total calculation'})});
  const context=JSON.parse(output).hookSpecificOutput;assert.equal(context.hookEventName,'UserPromptSubmit');assert.match(context.additionalContext,/automatically/);assert.ok(context.additionalContext.includes(f.repo));
  f.cli('install');assert.equal(await readFile(full,'utf8'),text);
 }
 for(const host of ['.agents','.claude'])assert.match(await readFile(path.join(f.home,host,'skills/code-doctor/SKILL.md'),'utf8'),/Do not resolve a sibling launcher/);
 assert.equal(execFileSync('git',['-C',f.repo,'status','--porcelain'],{encoding:'utf8'}),'');
 assert.match(f.hook(f.dir),/discover the development repository/);assert.equal(f.hook(f.repo,'abc',{hook_event_name:'Stop'}),'');
});
test('Codex user installation adds an idempotent MCP entry without overwriting other config',async t=>{
 const f=await fixture(t); await mkdir(path.join(f.home,'.codex'));
 const file=path.join(f.home,'.codex/config.toml');
 await writeFile(file,'model = "example"\n\n[mcp_servers.other]\ncommand = "other"\n');
 f.cli('install','--host','codex'); const installed=await readFile(file,'utf8');
 assert.match(installed,/model = "example"/); assert.match(installed,/\[mcp_servers\.other\]/);
 assert.match(installed,/\[mcp_servers\.code-doctor\]/); assert.match(installed,/tool_timeout_sec = 900/);
 f.cli('install','--host','codex'); assert.equal(await readFile(file,'utf8'),installed);
 await writeFile(file,installed.replace('tool_timeout_sec = 900','tool_timeout_sec = 100'));
 const hooks=await readFile(path.join(f.home,'.codex/hooks.json'),'utf8');
 assert.throws(()=>f.cli('install','--host','codex'),/differs or was edited/);
 assert.equal(await readFile(path.join(f.home,'.codex/hooks.json'),'utf8'),hooks);
});
test('repository, session and global controls persist and installation never resets opt-outs',async t=>{
 const f=await fixture(t);f.cli('install');assert.ok(f.hook());
 f.cli('disable','--repo',f.repo);assert.equal(f.hook(),'');assert.ok(f.hook(f.other));
 f.cli('install');assert.equal(f.hook(),'');
 f.cli('enable','--repo',f.repo);assert.ok(f.hook());
 f.cli('disable','--repo',f.repo,'--scope','session','--session','session-a');assert.equal(f.hook(),'');assert.ok(f.hook(f.repo,'session-b'));assert.ok(f.hook(f.other));
 assert.equal(f.cli('status','--repo',f.repo,'--session','session-a').disabledBy,'session');
 f.cli('enable','--repo',f.repo,'--scope','session','--session','session-a');assert.ok(f.hook());
 f.cli('disable','--scope','global');assert.equal(f.hook(),'');assert.equal(f.hook(f.other),'');
 f.cli('enable','--repo',f.repo);assert.equal(f.cli('status','--repo',f.repo).disabledBy,'global');
 f.cli('enable','--scope','global');assert.ok(f.hook());
 assert.throws(()=>f.cli('disable','--repo',f.repo,'--scope','session'),/Session scope requires/);
});
test('malformed and edited settings fail before any host file is changed',async t=>{
 const f=await fixture(t);await mkdir(path.join(f.home,'.claude'));await writeFile(path.join(f.home,'.claude/settings.json'),'{"n":9007199254740993}');
 assert.throws(()=>f.cli('install'),/cannot be preserved/);await assert.rejects(readFile(path.join(f.home,'.codex/hooks.json')),/ENOENT/);
 await writeFile(path.join(f.home,'.claude/settings.json'),'{}');f.cli('install');
 const codex=path.join(f.home,'.codex/hooks.json'),before=await readFile(codex,'utf8');
 const claude=path.join(f.home,'.claude/settings.json'),config=JSON.parse(await readFile(claude,'utf8'));config.hooks.UserPromptSubmit[0].hooks[0].timeout=99;await writeFile(claude,JSON.stringify(config));
 assert.throws(()=>f.cli('install'),/edited or duplicated/);assert.equal(await readFile(codex,'utf8'),before);
 await writeFile(path.join(f.home,'.config/code-doctor/settings.json'),'not json');assert.equal(f.hook(),'');assert.throws(()=>f.cli('status','--repo',f.repo),/Invalid JSON/);
});
test('symlink targets and existing user skills are not overwritten',async t=>{
 const f=await fixture(t);const target=path.join(f.dir,'target');await mkdir(target);await symlink(target,path.join(f.home,'.codex'));
 assert.throws(()=>f.cli('install'),/symlink/);await assert.rejects(readFile(path.join(target,'hooks.json')),/ENOENT/);
 await rm(path.join(f.home,'.codex'));await mkdir(path.join(f.home,'.agents/skills/code-doctor'),{recursive:true});
 const file=path.join(f.home,'.agents/skills/code-doctor/SKILL.md');await writeFile(file,'custom skill');
 assert.throws(()=>f.cli('install'),/differs or was edited/);assert.equal(await readFile(file,'utf8'),'custom skill');await assert.rejects(readFile(path.join(f.home,'.codex/hooks.json')),/ENOENT/);
});

test('existing source links to this installation are reused without replacement',async t=>{
 const f=await fixture(t);
 const parent=path.join(f.home,'.agents/skills');await mkdir(parent,{recursive:true});
 const folder=fileURLToPath(new URL('../skills/code-doctor',import.meta.url));
 await symlink(folder,path.join(parent,'code-doctor'));
 f.cli('install');assert.equal(await realpath(path.join(parent,'code-doctor')),await realpath(folder));assert.ok(f.hook());
});

test('custom Claude config directory receives both the hook and discoverable skill',async t=>{
 const f=await fixture(t);f.env.CLAUDE_CONFIG_DIR=path.join(f.home,'custom-claude');f.cli('install','--host','claude');
 assert.ok(JSON.parse(await readFile(path.join(f.env.CLAUDE_CONFIG_DIR,'settings.json'),'utf8')).hooks.UserPromptSubmit.length);
 assert.match(await readFile(path.join(f.env.CLAUDE_CONFIG_DIR,'skills/code-doctor/SKILL.md'),'utf8'),/Automatic guidance/);
 await assert.rejects(readFile(path.join(f.home,'.codex/hooks.json')),/ENOENT/);
});

test('Git roots with trailing spaces are preserved exactly',async t=>{
 const f=await fixture(t),repo=path.join(f.dir,'project with trailing space ');await mkdir(repo);execFileSync('git',['init','-q',repo]);
 f.cli('install');assert.equal(f.cli('status','--repo',repo).repo,repo);assert.ok(f.hook(repo));
 f.cli('disable','--repo',repo);assert.equal(f.hook(repo),'');
});


test('a non-Git start defers to the actual repository and session controls without scanning or writing projects',async t=>{
 const f=await fixture(t);f.cli('install');
 f.cli('disable','--repo',f.repo,'--scope','session','--session','session-a');
 const context=JSON.parse(f.hook(f.dir)).hookSpecificOutput.additionalContext;
 assert.match(context,/status/);assert.match(context,/--repo ABSOLUTE_TASK_REPO/);assert.match(context,/--session 'session-a'/);
 assert.equal(f.cli('status','--repo',f.repo,'--session','session-a').enabled,false);
 assert.equal(f.cli('status','--repo',f.other,'--session','session-a').enabled,true);
 assert.equal(execFileSync('git',['-C',f.repo,'status','--porcelain'],{encoding:'utf8'}),'');
 f.cli('disable','--scope','global');assert.equal(f.hook(f.dir),'');
 f.cli('enable','--scope','global');assert.ok(f.hook(f.dir));
 assert.equal(f.hook(path.join(f.dir,'missing')),'');
 const file=path.join(f.dir,'file');await writeFile(file,'not a directory');assert.equal(f.hook(file),'');
 assert.equal(f.hook(f.dir,'abc',{hook_event_name:'Stop'}),'');
 await writeFile(path.join(f.home,'.config/code-doctor/settings.json'),'broken');assert.equal(f.hook(f.dir),'');
});
