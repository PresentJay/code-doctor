#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createService } from '../src/service.mjs';

const help = `Code Doctor 0.1.0-rc.2 (Node >=22, Git required)
  capture  --repo PATH [--base HEAD --task TEXT --kind change --issue URL --context FILE.json]
           Omitted base pins the saved comparison commit; explicit base starts a new comparison.
           Omitted task/context reuse the current review. Unchanged code preserves its plan.
  read     --repo PATH [--review ID --view full|outline|guide]
           guide returns every ordered block with verified code for the existing conversation/diff.
  block    --repo PATH [--review ID --block ID --view focus|full]
  plan     --repo PATH --file PLAN.json   (reviewId, summary, blocks)
  feedback --repo PATH --review ID --block ID --text TEXT
  feedbacks --repo PATH [--review ID --state pending|all|addressed|dismissed]
  resolve  --repo PATH --feedback ID --version N --review ID --resolution addressed|dismissed --note TEXT
  mcp      --repo PATH                   (stdio; no model API key)
  serve    --repo PATH [--port 0]         (optional web review, only on request; keep running)
  install  [--host both|codex|claude]   (one-time user hooks + skill; automatic guidance)
  status   --repo PATH [--session ID]
  disable  --repo PATH [--scope repo|session|global --session ID]
  enable   --repo PATH [--scope repo|session|global --session ID]
  hook                                  (host stdin event; advisory context only)
  setup    --repo PATH --host both
  doctor   --repo PATH
All CLI results are JSON. Errors go to stderr with a nonzero exit.
Review files stay under the repository's ignored .code-doctor/ directory.
`;
try {
  const {values, positionals} = parseArgs({allowPositionals:true, options:{
    repo:{type:'string',default:process.cwd()}, base:{type:'string'},
    task:{type:'string'},kind:{type:'string'},issue:{type:'string'},context:{type:'string'},
    file:{type:'string'},review:{type:'string'},block:{type:'string'},text:{type:'string'},
    host:{type:'string',default:'both'},scope:{type:'string',default:'repo'},session:{type:'string'},
    feedback:{type:'string'},version:{type:'string'},resolution:{type:'string'},note:{type:'string'},state:{type:'string',default:'pending'},
    view:{type:'string'},port:{type:'string',default:'0'},help:{type:'boolean',short:'h'},
  }});
  const command = positionals[0];
  if (values.help || !command) { process.stdout.write(help); }
  else if (positionals.length > 1) throw new Error('Unexpected positional arguments. Use --help.');
  else {
    const cwd = path.resolve(values.repo);
    let result;
    if (['install','status','enable','disable','hook'].includes(command)) {
      const auto = await import('../src/automatic.mjs');
      if (command === 'install') result = await auto.installAutomatic({host:values.host});
      else if (command === 'hook') await auto.runAutomaticHook();
      else if (command === 'status') result = await auto.automaticStatus({repo:cwd,session:values.session});
      else result = await auto.setAutomatic({repo:cwd,session:values.session,scope:values.scope,enabled:command === 'enable'});
    } else if (command === 'mcp') {
      const {startMcp} = await import('../src/mcp.mjs'); await startMcp(cwd);
    } else if (command === 'serve') {
      const {startReviewServer} = await import('../src/viewer.mjs');
      const viewer = await startReviewServer({cwd,port:Number(values.port)});
      result = {url:viewer.url,repo:viewer.repo,close:'Stop this CLI process to close the local viewer.'};
    } else if (command === 'setup') {
      const {setup} = await import('../src/setup.mjs');
      result = await setup({repo:cwd,host:values.host});
    } else if (command === 'doctor') {
      const service = await createService(cwd);
      result = {node:process.version,git:execFileSync('git',['--version'],{encoding:'utf8'}).trim(),repo:service.root,storage:await service.diagnostics()};
    } else {
      const service = await createService(cwd);
      if (command === 'capture') {
        const options = Object.fromEntries(['base','task','kind','issue'].filter(key=>values[key]!==undefined).map(key=>[key,values[key]]));
        if (values.context) options.context = JSON.parse(await readFile(values.context,'utf8'));
        result = await service.capture(options);
      }
      else if (command === 'read') result = await service.read({reviewId:values.review,view:values.view});
      else if (command === 'block') result = await service.block({reviewId:values.review,blockId:values.block,view:values.view});
      else if (command === 'feedbacks') result = await service.feedbacks({reviewId:values.review,state:values.state});
      else if (command === 'resolve') result = await service.resolve({feedbackId:values.feedback,expectedVersion:Number(values.version),reviewId:values.review,resolution:values.resolution,note:values.note});
      else if (command === 'plan') {
        if (!values.file) throw new Error('plan requires --file');
        result = await service.plan(JSON.parse(await readFile(values.file,'utf8')));
      } else if (command === 'feedback') result = await service.feedback({reviewId:values.review,blockId:values.block,text:values.text});
      else throw new Error(`Unknown command: ${command}`);
    }
    if (result !== undefined) process.stdout.write(JSON.stringify(result,null,2)+'\n');
  }
} catch(error) {
  process.stderr.write(JSON.stringify({error:error.message})+'\n'); process.exitCode = 1;
}
