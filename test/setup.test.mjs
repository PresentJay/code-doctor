import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, readdir, lstat, readlink, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parse } from 'smol-toml';
import { setup } from '../src/setup.mjs';

const entry = fileURLToPath(new URL('../bin/code-doctor.mjs', import.meta.url));
const canonicalSkill = await readFile(new URL('../skills/code-doctor/SKILL.md', import.meta.url), 'utf8');
const skillPaths = ['.claude/skills/code-doctor/SKILL.md', '.agents/skills/code-doctor/SKILL.md'];
const manifestPath = '.code-doctor/setup.json';
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
const sha256 = text => createHash('sha256').update(text).digest('hex');
const toml = text => structuredClone(parse(text, { integersAsBigInt: true }));
const server = root => ({ command: process.execPath, args: [entry, 'mcp', '--repo', root] });
const claudeServer = root => ({...server(root),timeout:900000});
const codexServer = root => ({...server(root),tool_timeout_sec:900n});

async function put(root, relative, text) {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), text);
}
const read = (root, relative) => readFile(path.join(root, relative), 'utf8');
const json = async (root, relative) => JSON.parse(await read(root, relative));

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'code-doctor-setup-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  await put(root, '.gitignore', '.code-doctor/\n');
  return root;
}

// Include absent/new paths, directories, permissions and symlink destinations in the oracle.
async function snapshot(root) {
  const entries = {};
  async function visit(relative) {
    const file = path.join(root, relative);
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) entries[relative] = { link: await readlink(file) };
    else if (stat.isDirectory()) {
      entries[relative] = { directory: true, mode: stat.mode & 0o777 };
      for (const name of (await readdir(file)).sort()) {
        if (relative || name !== '.git') await visit(path.join(relative, name));
      }
    } else entries[relative] = { bytes: (await readFile(file)).toString('base64'), mode: stat.mode & 0o777 };
  }
  await visit('');
  return entries;
}

async function rejectsWithoutWrites(root, options = {}) {
  const before = await snapshot(root);
  await assert.rejects(() => setup({ repo: root, ...options }));
  assert.deepEqual(await snapshot(root), before, 'a rejected setup changed a target or created a path');
}

const existingClaude = {
  permissions: { allow: ['Read'], deny: ['Bash(rm:*)'] },
  ownerNote: '사용자 설정 유지',
  mcpServers: { search: { command: 'search-local', args: ['--read-only'], env: { TOKEN: 'private-fixture-token' } } },
};
const existingCodex = '# 사용자 주석과 줄 간격도 유지\nmodel = "user-model"\nmodel_reasoning_effort = "high"\n'
  + 'large_integer = 9007199254740993\n\n'
  + 'instructions = """\n[mcp_servers.code-doctor]\ncommand = "fake-in-string"\n'
  + '# code-doctor setup begin: code-doctor\n# code-doctor setup end: code-doctor\n"""\n'
  + "literal_instructions = '''\n[mcp_servers.example]\ncommand = 'also-fake'\n'''\n\n"
  + '[mcp_servers.search]\ncommand = "search-local"\nargs = ["--read-only"]\n'
  + '[mcp_servers.search.env]\nTOKEN = "private-fixture-token"\n';

test('setup preserves unrelated Claude values and exact Codex text, then reruns without byte changes', async t => {
  const root = await fixture(t);
  await put(root, '.mcp.json', JSON.stringify(existingClaude, null, 4) + '\n');
  await put(root, '.codex/config.toml', existingCodex);
  await chmod(path.join(root, '.mcp.json'), 0o600);
  await chmod(path.join(root, '.codex/config.toml'), 0o600);
  const result = await setup({ repo: root });
  assert.equal(result.status, 'configured-not-connected');
  assert.equal(result.repo, root);
  assert.ok(result.files.length >= 4);
  assert.ok(result.files.every(file => path.isAbsolute(file) && file.startsWith(root + path.sep)));
  const claude = await json(root, '.mcp.json');
  assert.deepEqual(claude, { ...existingClaude, mcpServers: { ...existingClaude.mcpServers, 'code-doctor': claudeServer(root) } });
  const codexText = await read(root, '.codex/config.toml');
  assert.ok(codexText.startsWith(existingCodex), 'setup rewrote original TOML instead of appending its block');
  const { mcp_servers, ...settings } = toml(codexText);
  const { mcp_servers: originalServers, ...originalSettings } = toml(existingCodex);
  assert.deepEqual(settings, originalSettings);
  assert.equal(settings.large_integer, 9007199254740993n);
  assert.deepEqual(mcp_servers, { ...originalServers, 'code-doctor': codexServer(root) });
  for (const relative of skillPaths) assert.equal(await read(root, relative), canonicalSkill);
  for (const relative of ['.mcp.json', '.codex/config.toml']) assert.equal((await lstat(path.join(root, relative))).mode & 0o777, 0o600);
  const manifest = await json(root, manifestPath);
  assert.equal(manifest.version, 1);
  for (const relative of skillPaths) assert.equal(manifest.skills[relative], sha256(canonicalSkill));
  assert.equal(JSON.stringify(manifest).includes('private-fixture-token'), false);
  assert.equal(JSON.stringify(manifest).includes('user-model'), false);
  const before = await snapshot(root);
  for (const host of ['both', 'claude', 'codex']) {
    await setup({ repo: root, host });
    assert.deepEqual(await snapshot(root), before, `${host} rerun changed files or forgot another host's manifest entries`);
  }
});

test('host selection touches only its own configuration and skill', async t => {
  for (const host of ['claude', 'codex']) await t.test(host, async t => {
    const root = await fixture(t);
    const unselected = host === 'claude' ? '.codex/config.toml' : '.mcp.json';
    const untouchedSkill = skillPaths[host === 'claude' ? 1 : 0];
    await put(root, unselected, 'invalid unselected configuration\n');
    await put(root, untouchedSkill, 'a separately maintained skill\n');
    await setup({ repo: root, host });
    assert.equal(await read(root, unselected), 'invalid unselected configuration\n');
    assert.equal(await read(root, untouchedSkill), 'a separately maintained skill\n');
    const selectedSkill = skillPaths[host === 'claude' ? 0 : 1];
    assert.equal(await read(root, selectedSkill), canonicalSkill);
    const manifest = await json(root, manifestPath);
    assert.deepEqual(Object.keys(manifest.skills), [selectedSkill]);
    assert.deepEqual(manifest[host === 'claude' ? 'codex' : 'claude'], {});
  });
});

test('identical unmanaged servers and skills are adopted without removing extra server fields', async t => {
  const root = await fixture(t);
  const expected = server(root);
  await put(root, '.mcp.json', JSON.stringify({ mcpServers: { 'code-doctor': { ...expected, env: { EXTRA: 'keep' }, disabled: false } } }));
  const original = `# unowned quoted table\n["mcp_servers"."code-doctor"]\ncommand = ${JSON.stringify(expected.command)}\nargs = ${JSON.stringify(expected.args)}\nenabled = true\n`;
  await put(root, '.codex/config.toml', original);
  for (const relative of skillPaths) await put(root, relative, canonicalSkill);
  await setup({ repo: root });
  assert.deepEqual((await json(root, '.mcp.json')).mcpServers['code-doctor'], { ...expected, env: { EXTRA: 'keep' }, disabled: false });
  assert.equal(await read(root, '.codex/config.toml'), original);
  assert.deepEqual((await json(root, manifestPath)).codex, {});
  assert.equal((await json(root, manifestPath)).skills[skillPaths[0]], sha256(canonicalSkill));
});

test('retired ownership records are forgotten without changing unrelated servers', async t => {
  const root = await fixture(t);
  await setup({repo:root});
  const manifest = await json(root,manifestPath);
  const unrelated = {command:'unrelated-tool',args:['serve']};
  const config = await json(root,'.mcp.json');
  config.mcpServers.unrelated = unrelated;
  await put(root,'.mcp.json',JSON.stringify(config));
  manifest.claude.unrelated = sha256(JSON.stringify(unrelated));
  manifest.codex.unrelated = sha256('previous managed block');
  await put(root,manifestPath,JSON.stringify(manifest));
  const codex = await read(root,'.codex/config.toml') + '\n# code-doctor setup begin: unrelated\n[mcp_servers.unrelated]\ncommand = "unrelated-tool"\nargs = ["serve"]\n# code-doctor setup end: unrelated\n';
  await put(root,'.codex/config.toml',codex);
  await setup({repo:root});
  assert.deepEqual((await json(root,'.mcp.json')).mcpServers.unrelated,unrelated);
  assert.equal(await read(root,'.codex/config.toml'),codex);
  assert.deepEqual(Object.keys((await json(root,manifestPath)).claude),['code-doctor']);
  assert.deepEqual(Object.keys((await json(root,manifestPath)).codex),['code-doctor']);
});

test('manifest-owned previous skills and Claude launch values upgrade while unrelated fields stay', async t => {
  const root = await fixture(t);
  await setup({ repo: root });
  const manifest = await json(root, manifestPath);
  for (const relative of skillPaths) {
    const old = `Previous package skill at ${relative}\n`;
    await put(root, relative, old);
    manifest.skills[relative] = sha256(old);
  }
  const claude = await json(root, '.mcp.json');
  const oldServer = { command: '/previous/node', args: ['/previous/code-doctor.mjs', 'mcp', '--repo', root] };
  claude.mcpServers['code-doctor'] = { ...oldServer, env: { PRESERVE: 'yes' } };
  manifest.claude['code-doctor'] = sha256(JSON.stringify(oldServer));
  await put(root, '.mcp.json', JSON.stringify(claude));
  await put(root, manifestPath, JSON.stringify(manifest));
  await chmod(path.join(root, skillPaths[0]), 0o600);
  await setup({ repo: root });
  for (const relative of skillPaths) assert.equal(await read(root, relative), canonicalSkill);
  assert.equal((await lstat(path.join(root, skillPaths[0]))).mode & 0o777, 0o600);
  assert.deepEqual((await json(root, '.mcp.json')).mcpServers['code-doctor'], { ...claudeServer(root), env: { PRESERVE: 'yes' } });
  const updated = await json(root, manifestPath);
  for (const relative of skillPaths) assert.equal(updated.skills[relative], sha256(canonicalSkill));
});

test('an edited managed skill prevents even another eligible skill upgrade from being written', async t => {
  const root = await fixture(t);
  await setup({ repo: root });
  const manifest = await json(root, manifestPath);
  const previousSkill = 'Unmodified skill from a previous release\n';
  await put(root, skillPaths[0], previousSkill);
  manifest.skills[skillPaths[0]] = sha256(previousSkill);
  await put(root, manifestPath, JSON.stringify(manifest));
  await put(root, skillPaths[1], canonicalSkill + '\nUser additions must survive.\n');
  await rejectsWithoutWrites(root);
});

test('an unchanged previously owned Codex block upgrades without rewriting original text', async t => {
  const root = await fixture(t);
  await put(root, '.codex/config.toml', existingCodex);
  await setup({ repo: root });
  const installed = await read(root, '.codex/config.toml');
  const start = installed.lastIndexOf('# code-doctor setup begin: code-doctor\n');
  const block = installed.slice(start);
  assert.ok(start >= existingCodex.length);
  const oldBlock = block.replace(JSON.stringify(process.execPath), '"/previous/node"').replace(JSON.stringify(entry), '"/previous/code-doctor.mjs"');
  assert.notEqual(oldBlock, block);
  await put(root, '.codex/config.toml', installed.slice(0, start) + oldBlock);
  const manifest = await json(root, manifestPath);
  manifest.codex['code-doctor'] = sha256(oldBlock);
  await put(root, manifestPath, JSON.stringify(manifest));
  await setup({ repo: root });
  assert.equal(await read(root, '.codex/config.toml'), installed);
  assert.deepEqual(toml(installed).mcp_servers['code-doctor'], codexServer(root));
});

test('managed legacy timeouts upgrade while user-set and unmanaged values are preserved', async t=>{
  const root = await fixture(t);
  await setup({repo:root});
  const manifest = await json(root,manifestPath);
  const codex = await read(root,'.codex/config.toml');
  const oldCodex = codex.replace('tool_timeout_sec = 900\n','');
  const start = oldCodex.lastIndexOf('# code-doctor setup begin: code-doctor\n');
  await put(root,'.codex/config.toml',oldCodex);
  manifest.codex['code-doctor'] = sha256(oldCodex.slice(start));
  const claude = await json(root,'.mcp.json');
  delete claude.mcpServers['code-doctor'].timeout;
  await put(root,'.mcp.json',JSON.stringify(claude));
  await put(root,manifestPath,JSON.stringify(manifest));
  await setup({repo:root});
  assert.equal(toml(await read(root,'.codex/config.toml')).mcp_servers['code-doctor'].tool_timeout_sec,900n);
  assert.equal((await json(root,'.mcp.json')).mcpServers['code-doctor'].timeout,900000);
  const updated = await json(root,'.mcp.json'); updated.mcpServers['code-doctor'].timeout = 120000;
  await put(root,'.mcp.json',JSON.stringify(updated));
  await setup({repo:root});
  assert.equal((await json(root,'.mcp.json')).mcpServers['code-doctor'].timeout,120000);
});

test('user edits inside an owned Codex block reject before a pending skill upgrade is written', async t => {
  const root = await fixture(t);
  await setup({ repo: root });
  const manifest = await json(root, manifestPath);
  const previousSkill = 'Previous unmodified release\n';
  await put(root, skillPaths[0], previousSkill);
  manifest.skills[skillPaths[0]] = sha256(previousSkill);
  await put(root, manifestPath, JSON.stringify(manifest));
  const codex = await read(root, '.codex/config.toml');
  await put(root, '.codex/config.toml', codex.replace('# code-doctor setup end: code-doctor', '# keep my addition\n# code-doctor setup end: code-doctor'));
  await rejectsWithoutWrites(root);
});

test('unowned skill differences and existing server conflicts reject before creating other targets', async t => {
  const cases = [
    ['unowned skill', skillPaths[1], 'My own code-doctor skill\n'],
    ['Claude server', '.mcp.json', '{"mcpServers":{"code-doctor":{"command":"other","args":[]}}}'],
    ['Codex server', '.codex/config.toml', '[mcp_servers.code-doctor]\ncommand = "other"\nargs = []\n'],
  ];
  for (const [name, relative, text] of cases) await t.test(name, async t => {
    const root = await fixture(t);
    await put(root, relative, text);
    await rejectsWithoutWrites(root);
    await rm(path.join(root, relative));
    assert.equal((await setup({ repo: root })).status, 'configured-not-connected');
  });
});

test('invalid, lossy or wrong-type JSON rejects before any other target is written', async t => {
  const cases = [
    ['syntax', '{"mcpServers":'],
    ['root array', '[]'],
    ['root null', 'null'],
    ['server map array', '{"mcpServers":[]}'],
    ['server map null', '{"mcpServers":null}'],
    ['server command type', '{"mcpServers":{"code-doctor":{"command":7,"args":[]}}}'],
    ['server args type', '{"mcpServers":{"code-doctor":{"command":"node","args":"mcp"}}}'],
    ['unsafe integer', '{"counter":9007199254740993}'],
    ['nonfinite number', '{"counter":1e400}'],
  ];
  for (const [name, text] of cases) await t.test(name, async t => {
    const root = await fixture(t);
    await put(root, '.mcp.json', text);
    await put(root, '.codex/config.toml', existingCodex);
    await rejectsWithoutWrites(root);
    await put(root, '.mcp.json', JSON.stringify(existingClaude));
    assert.equal((await setup({ repo: root })).status, 'configured-not-connected');
  });
});

test('invalid or structurally unsafe TOML rejects before writing Claude, skills or manifest', async t => {
  const cases = [
    ['syntax', 'model = "unterminated\n'],
    ['duplicate key', 'model = "one"\nmodel = "two"\n'],
    ['server map scalar', 'mcp_servers = "wrong"\n'],
    ['server array', '[[mcp_servers.code-doctor]]\ncommand = "node"\nargs = []\n'],
    ['server command type', '[mcp_servers.code-doctor]\ncommand = 7\nargs = []\n'],
    ['server args type', '[mcp_servers.code-doctor]\ncommand = "node"\nargs = "mcp"\n'],
    ['closed inline map', 'mcp_servers = { search = { command = "other", args = [] } }\n'],
  ];
  for (const [name, text] of cases) await t.test(name, async t => {
    const root = await fixture(t);
    await put(root, '.mcp.json', JSON.stringify(existingClaude));
    await put(root, '.codex/config.toml', text);
    await rejectsWithoutWrites(root);
    await put(root, '.codex/config.toml', existingCodex);
    assert.equal((await setup({ repo: root })).status, 'configured-not-connected');
  });
});

test('malformed installation manifests reject before any setup target changes', async t => {
  const cases = [
    ['invalid JSON', '{'],
    ['unsupported version', '{"version":2,"skills":{},"claude":{},"codex":{}}'],
    ['wrong skill map', '{"version":1,"skills":[],"claude":{},"codex":{}}'],
    ['wrong hash type', '{"version":1,"skills":{".agents/skills/code-doctor/SKILL.md":42},"claude":{},"codex":{}}'],
  ];
  for (const [name, text] of cases) await t.test(name, async t => {
    const root = await fixture(t);
    await put(root, manifestPath, text);
    await rejectsWithoutWrites(root);
    await rm(path.join(root, manifestPath));
    assert.equal((await setup({ repo: root })).status, 'configured-not-connected');
  });
});

test('symlink targets and parents reject without touching the repository or their destination', async t => {
  const cases = [
    ['.mcp.json', false], ['.codex', true], ['.claude/skills', true],
    [skillPaths[1], false], ['.code-doctor', true], [manifestPath, false],
  ];
  for (const [relative, directory] of cases) await t.test(relative, async t => {
    const root = await fixture(t);
    const outside = await realpath(await mkdtemp(path.join(tmpdir(), 'code-doctor-setup-outside-')));
    t.after(() => rm(outside, { recursive: true, force: true }));
    const validLinkedText = relative === '.mcp.json'
      ? JSON.stringify({ mcpServers: { 'code-doctor': server(root) } })
      : relative === manifestPath ? JSON.stringify({ version: 1, skills: {}, claude: {}, codex: {} }) : canonicalSkill;
    await put(outside, 'sentinel', directory ? 'outside bytes must survive\n' : validLinkedText);
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await symlink(directory ? outside : path.join(outside, 'sentinel'), path.join(root, relative), directory ? 'dir' : 'file');
    const before = await snapshot(outside);
    await rejectsWithoutWrites(root);
    assert.deepEqual(await snapshot(outside), before);
    await rm(path.join(root, relative));
    assert.equal((await setup({ repo: root })).status, 'configured-not-connected');
  });
});

test('wrong destination and parent kinds reject before all writes', async t => {
  for (const [relative, directory] of [['.mcp.json', true], ['.codex', false], [skillPaths[0], true], [manifestPath, true]]) {
    await t.test(relative, async t => {
      const root = await fixture(t);
      if (directory) await mkdir(path.join(root, relative), { recursive: true });
      else await put(root, relative, 'a file cannot become a parent directory\n');
      await rejectsWithoutWrites(root);
      await rm(path.join(root, relative), { recursive: true });
      assert.equal((await setup({ repo: root })).status, 'configured-not-connected');
    });
  }
});

test('manifest must be ignored without exceptions and never tracked, including an unchanged rerun', async t => {
  for (const ignore of ['', '.code-doctor/*\n!.code-doctor/setup.json\n']) await t.test(JSON.stringify(ignore), async t => {
    const root = await fixture(t);
    await put(root, '.gitignore', ignore);
    await rejectsWithoutWrites(root);
    await put(root, '.gitignore', '.code-doctor/\n');
    assert.equal((await setup({ repo: root })).status, 'configured-not-connected');
  });
  const root = await fixture(t);
  await setup({ repo: root });
  git(root, 'add', '-f', manifestPath);
  await rejectsWithoutWrites(root);
  assert.equal(git(root, 'ls-files', '--', manifestPath).toString().trim(), manifestPath);
  git(root, 'rm', '--cached', '-q', '--', manifestPath);
  assert.equal((await setup({ repo: root })).status, 'configured-not-connected');
});
