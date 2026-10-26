import { readFile, open, mkdir, lstat, realpath, rename, link, rm, chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { manifestDocument, claudeConfig, codexConfig, skillFile } from './setup-config.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = '.code-doctor/setup.json';
const utf8 = new TextDecoder('utf-8', {fatal:true, ignoreBOM:true});
const changed = file => new Error(`Setup target changed during preflight: ${file}. Retry after other edits finish.`);
const signature = (info, leaf = true) => info && (leaf ? ['dev','ino','mode','size','mtimeNs','ctimeNs'] : ['dev','ino','mode']).map(key => info[key]).join(':');
async function stat(file) {
  try { return await lstat(file, {bigint:true}); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

async function snapshots(repo, relatives) {
  const entries = new Map();
  for (const relative of relatives) {
    let file = repo;
    for (const [index, part] of ['', ...relative.split('/')].entries()) {
      if (part) file = path.join(file, part);
      const leaf = index === relative.split('/').length;
      if (entries.has(file)) continue;
      const info = await stat(file);
      if (info?.isSymbolicLink()) throw new Error(`Refusing symlink in setup target: ${file}`);
      if (info && (leaf ? !info.isFile() : !info.isDirectory())) {
        throw new Error(`Setup ${leaf ? 'target must be a regular file' : 'parent must be a directory'}: ${file}`);
      }
      let bytes, text;
      if (leaf && info) {
        bytes = await readFile(file);
        try { text = utf8.decode(bytes); }
        catch { throw new Error(`Invalid UTF-8 in setup target: ${file}. Merge it manually before setup.`); }
        if (signature(await stat(file)) !== signature(info)) throw changed(file);
      }
      entries.set(file, {info, bytes, text, leaf});
    }
  }
  return entries;
}

async function verify(file, snapshot) {
  const current = await stat(file);
  if (signature(current, snapshot.leaf) !== signature(snapshot.info, snapshot.leaf)) throw changed(file);
  if (snapshot.bytes && !(await readFile(file)).equals(snapshot.bytes)) throw changed(file);
}

async function parentDirectories(repo, file, entries, created) {
  let current = repo;
  for (const part of ['', ...path.relative(repo, path.dirname(file)).split(path.sep)].filter((part, index) => index === 0 || part)) {
    if (part) current = path.join(current, part);
    const original = entries.get(current);
    if (original?.info) await verify(current, original);
    else if (created.has(current)) await verify(current, created.get(current));
    else {
      try { await mkdir(current, {mode:0o700}); }
      catch (error) { if (error.code === 'EEXIST') throw changed(current); throw error; }
      const info = await stat(current);
      if (!info?.isDirectory() || info.isSymbolicLink()) throw changed(current);
      created.set(current, {info, leaf:false});
    }
  }
}

async function install(repo, file, text, entries, created) {
  const snapshot = entries.get(file);
  await parentDirectories(repo, file, entries, created);
  await verify(file, snapshot);
  const temporary = path.join(path.dirname(file), `.code-doctor-setup-${randomUUID()}.tmp`);
  const mode = snapshot.info ? Number(snapshot.info.mode & 0o777n) : 0o600;
  let temporaryCreated = false;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    temporaryCreated = true;
    try { await handle.writeFile(text); }
    finally { await handle.close(); }
    await chmod(temporary, mode);
    // The last check narrows concurrent-edit races; this is not a multi-file transaction.
    await parentDirectories(repo, file, entries, created);
    await verify(file, snapshot);
    if (snapshot.info) await rename(temporary, file);
    else await link(temporary, file); // Do not replace a file created after the absence check.
  } finally { if (temporaryCreated) await rm(temporary, {force:true}); }
}

export async function setup({repo, host = 'both'}) {
  if (!['both','claude','codex'].includes(host)) throw new Error('host must be both, claude, or codex');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  repo = await realpath(execFileSync('git', ['-C',repo,'rev-parse','--show-toplevel'], {encoding:'utf8',stdio:'pipe',env}).replace(/\n$/, ''));
  const git = args => execFileSync('git', ['-C',repo,...args], {stdio:'pipe',env});
  const checkManifestStorage = () => {
    if (git(['ls-files','-z','--',manifestPath]).length) throw new Error(`Setup manifest must not be tracked: ${manifestPath}`);
    try { git(['check-ignore','-q','--',manifestPath]); }
    catch { throw new Error(`Add .code-doctor/ to .gitignore without exceptions before setup: ${manifestPath}`); }
  };
  checkManifestStorage();

  const entry = path.join(packageRoot,'bin/code-doctor.mjs');
  const servers = {'code-doctor':{command:process.execPath,args:[entry,'mcp','--repo',repo]}};
  const targets = [];
  if (host === 'both' || host === 'claude') targets.push('.mcp.json','.claude/skills/code-doctor/SKILL.md');
  if (host === 'both' || host === 'codex') targets.push('.codex/config.toml','.agents/skills/code-doctor/SKILL.md');
  const entries = await snapshots(repo, [...targets,manifestPath]);
  const read = relative => entries.get(path.join(repo, relative)).text;
  const manifest = manifestDocument(read(manifestPath), path.join(repo,manifestPath));
  const canonical = await readFile(path.join(packageRoot,'skills/code-doctor/SKILL.md'),'utf8');
  const outputs = new Map();
  for (const relative of targets) {
    const file = path.join(repo, relative);
    const text = read(relative);
    if (relative === '.mcp.json') outputs.set(file, claudeConfig(text, servers, manifest.claude, file));
    else if (relative === '.codex/config.toml') outputs.set(file, codexConfig(text, servers, manifest.codex, file));
    else outputs.set(file, skillFile(text, canonical, manifest.skills, relative, file));
  }
  outputs.set(path.join(repo,manifestPath), JSON.stringify(manifest, null, 2) + '\n');
  // Validate every target and ancestor before creating directories or writing any file.
  for (const [file, snapshot] of entries) await verify(file, snapshot);
  checkManifestStorage();
  const created = new Map();
  for (const [file, text] of outputs) {
    if (entries.get(file).text !== text) await install(repo, file, text, entries, created);
  }
  return {status:'configured-not-connected',files:targets.map(relative => path.join(repo,relative)),repo,
    note:'Restart or open the trusted project in the host and follow its MCP trust prompt. No global config or account was changed.'};
}
