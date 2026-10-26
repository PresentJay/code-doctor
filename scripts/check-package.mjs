import assert from 'node:assert/strict';
import {readFile,access,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const pkg = JSON.parse(await readFile('package.json','utf8'));
for (const file of Object.values(pkg.bin)) {
  await access(file); execFileSync(process.execPath,['--check',file]);
}
for (const folder of ['.claude-plugin','.codex-plugin']) {
  const manifest = JSON.parse(await readFile(`${folder}/plugin.json`,'utf8'));
  assert.equal(manifest.name,'code-doctor'); assert.equal(manifest.version,pkg.version);
  await access(`${manifest.skills}/code-doctor/SKILL.md`);
}
assert.ok(!(pkg.scripts.postinstall || pkg.scripts.preinstall));
const skill = await readFile('skills/code-doctor/SKILL.md','utf8');
assert.match(skill,/^---\nname: code-doctor\ndescription: .+\n---/);
const cache = await mkdtemp(path.join(tmpdir(),'code-doctor-pack-'));
let files;
try { files = JSON.parse(execFileSync('npm',['pack','--dry-run','--json','--ignore-scripts'],{encoding:'utf8',env:{...process.env,npm_config_cache:cache}}))[0].files.map(f=>f.path); }
finally { await rm(cache,{recursive:true,force:true}); }
assert.ok(files.includes('bin/code-doctor.mjs') && files.includes('src/review.mjs') && files.includes('src/mcp.mjs'));
assert.ok(files.includes('src/reading.mjs'));
assert.ok(files.includes('skills/code-doctor/scripts/code-doctor.mjs'));
execFileSync(process.execPath,['skills/code-doctor/scripts/code-doctor.mjs','--help']);
for (const asset of ['index.html','style.css','app.mjs']) assert.ok(files.includes(`web/${asset}`), `Missing viewer asset: ${asset}`);
assert.ok(files.every(f=>!f.startsWith('.code-doctor/') && !f.endsWith('config.toml') && !f.includes('node_modules')));

assert.equal(pkg.license,'Apache-2.0');
assert.equal(pkg.publishConfig.access,'public');
for(const file of ['LICENSE','NOTICE','THIRD_PARTY_NOTICES.md','SECURITY.md','CONTRIBUTING.md','web/i18n.mjs','web/messages.mjs','docs/i18n/README.ko.md','docs/i18n/README.ja.md','docs/i18n/README.zh-CN.md'])assert.ok(files.includes(file),`Missing public asset: ${file}`);
assert.match(await readFile('LICENSE','utf8'),/Apache License[\s\S]+Version 2\.0, January 2004/);
assert.ok(files.every(file => !/^(?:work|outputs|\.git|\.unlazy|node_modules)(?:\/|$)/.test(file) && !['.mcp.json','.env','.env.local'].includes(file)));
console.log('PACKAGE_OK: entrypoints and private artifact exclusions verified');
