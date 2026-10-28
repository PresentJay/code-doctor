import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parse } from 'smol-toml';

export const hash = text => createHash('sha256').update(text).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameCommand = (a, b) => isDeepStrictEqual(a?.command, b.command) && isDeepStrictEqual(a?.args, b.args);
export const commandHash = server => hash(JSON.stringify({command:server.command,args:server.args}));
const conflict = file => new Error(`Existing configuration differs or was edited: ${file}. Merge it manually; setup will not overwrite it.`);

// Compare decimal values before JSON.parse can round them, including exponent notation.
function decimal(source) {
  const [, sign, integer, fraction = '', exponent = '0'] = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(source);
  const digits = (integer + fraction).replace(/^0+/, '');
  if (!digits) return sign + '0';
  const trimmed = digits.replace(/0+$/, '');
  return `${sign}${trimmed}e${BigInt(exponent) - BigInt(fraction.length) + BigInt(digits.length - trimmed.length)}`;
}

export function jsonDocument(text, file) {
  let value;
  try { value = JSON.parse(text); }
  catch { throw new Error(`Invalid JSON in ${file}. Merge it manually before setup.`); }
  const tokens = text.match(/"(?:\\[\s\S]|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\]:]/g) ?? [];
  const stack = [];
  for (const [index, token] of tokens.entries()) {
    if (token === '{') stack.push(new Set());
    else if (token === '[') stack.push(null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token[0] === '"' && tokens[index + 1] === ':') {
      const key = JSON.parse(token);
      if (stack.at(-1).has(key)) throw new Error(`Duplicate JSON key in ${file}. Merge it manually before setup.`);
      stack.at(-1).add(key);
    } else if (/^-?\d/.test(token)) {
      const serialized = JSON.stringify(Number(token));
      if (serialized === 'null' || decimal(token) !== decimal(serialized)) {
        throw new Error(`JSON number cannot be preserved safely in ${file}. Merge it manually before setup.`);
      }
    }
  }
  return value;
}

export function manifestDocument(text, file) {
  if (text === undefined) return {version:1, skills:{}, claude:{}, codex:{}};
  const value = jsonDocument(text, file);
  const allowed = {skills:['.claude/skills/code-doctor/SKILL.md','.agents/skills/code-doctor/SKILL.md'], claude:['code-doctor'], codex:['code-doctor']};
  if (!object(value) || value.version !== 1 || Object.keys(value).some(key => !['version', ...Object.keys(allowed)].includes(key))) {
    throw new Error(`Unsupported setup manifest: ${file}. Inspect it manually before setup.`);
  }
  for (const [key, names] of Object.entries(allowed)) {
    const entries = value[key] === undefined ? {} : value[key];
    if (!object(entries) || Object.entries(entries).some(([name, digest]) => !(key === 'skills' ? names.includes(name) : /^[a-zA-Z0-9._-]+$/.test(name)) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest))) {
      throw new Error(`Invalid hashes in setup manifest: ${file}. Inspect it manually before setup.`);
    }
    value[key] = key === 'skills' ? entries : Object.fromEntries(Object.entries(entries).filter(([name])=>name === 'code-doctor'));
  }
  return value;
}

export function claudeConfig(text, servers, managed, file) {
  const config = text === undefined ? {} : jsonDocument(text, file);
  if (!object(config) || (Object.hasOwn(config, 'mcpServers') && !object(config.mcpServers))) {
    throw new Error(`Expected a JSON object and mcpServers object in ${file}. Merge it manually before setup.`);
  }
  const next = {...config, mcpServers:{...config.mcpServers}};
  let changed = text === undefined;
  for (const [name, server] of Object.entries(servers)) {
    const current = next.mcpServers[name];
    if (Object.hasOwn(next.mcpServers, name)) {
      if (!object(current)) throw conflict(`${file} (mcpServers.${name})`);
      if (!sameCommand(current, server)) {
        if (managed[name] !== commandHash(current)) throw conflict(`${file} (mcpServers.${name})`);
        next.mcpServers[name] = {...server, ...current, command:server.command, args:server.args};
        changed = true;
      } else if (managed[name] === commandHash(current) && current.timeout === undefined && server.timeout !== undefined) {
        next.mcpServers[name] = {...current, timeout:server.timeout};
        changed = true;
      }
    } else {
      next.mcpServers[name] = server;
      changed = true;
    }
    managed[name] = commandHash(server);
  }
  return changed ? JSON.stringify(next, null, 2) + '\n' : text;
}

function toml(text, file) {
  try { return parse(text, {integersAsBigInt:true}); }
  catch { throw new Error(`Invalid or unappendable TOML in ${file}. Merge it manually before setup.`); }
}

// Only standalone comments outside strings are ownership markers. TOML parsing validates the grammar.
function managedBlocks(text, file) {
  const blocks = new Map();
  let state = '', active;
  for (const match of text.matchAll(/[^\n]*(?:\n|$)/g)) {
    const line = match[0];
    if (!line) continue;
    const marker = !state && /^# code-doctor setup (begin|end): (code-doctor)\r?\n?$/.exec(line);
    if (marker) {
      const [, kind, name] = marker;
      if (kind === 'begin') {
        if (active || blocks.has(name)) throw new Error(`Ambiguous setup markers in ${file}. Merge them manually before setup.`);
        active = {name, start:match.index};
      } else {
        if (!active || active.name !== name) throw new Error(`Unmatched setup marker in ${file}. Merge it manually before setup.`);
        blocks.set(name, {start:active.start, end:match.index + line.length, text:text.slice(active.start, match.index + line.length)});
        active = undefined;
      }
      continue;
    }
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      if (!state) {
        if (char === '#') break;
        if (line.startsWith('"""', index)) { state = '"""'; index += 2; }
        else if (line.startsWith("'''", index)) { state = "'''"; index += 2; }
        else if (char === '"' || char === "'") state = char;
      } else if (state[0] === '"' && char === '\\') index++;
      else if (line.startsWith(state, index)) {
        // A TOML multiline delimiter may have one or two quotes before its closing triple.
        const quote = state[0];
        let end = index + state.length;
        if (state.length === 3) while (line[end] === quote) end++;
        index = end - 1;
        state = '';
      }
    }
  }
  if (active) throw new Error(`Unclosed setup marker in ${file}. Merge it manually before setup.`);
  return blocks;
}

function block(name, server) {
  return `# code-doctor setup begin: ${name}\n[mcp_servers.${name}]\ncommand = ${JSON.stringify(server.command)}\nargs = ${JSON.stringify(server.args)}\ntool_timeout_sec = 900\n# code-doctor setup end: ${name}\n`;
}

export function codexConfig(text = '', servers, managed, file) {
  const original = toml(text, file);
  if (Object.hasOwn(original, 'mcp_servers') && !object(original.mcp_servers)) throw conflict(`${file} (mcp_servers)`);
  const expected = Object.assign(Object.create(null), original, {mcp_servers:Object.assign(Object.create(null), original.mcp_servers)});
  const blocks = managedBlocks(text, file);
  const replacements = [];
  const additions = [];
  for (const [name, server] of Object.entries(servers)) {
    const current = original.mcp_servers?.[name];
    const owned = blocks.get(name);
    const generated = block(name, server);
    if (owned) {
      if (managed[name] !== undefined && managed[name] !== hash(owned.text)) throw conflict(`${file} (${name} setup block)`);
      if (managed[name] === undefined && owned.text !== generated) {
        if (!object(current) || !sameCommand(current, server)) throw conflict(`${file} (mcp_servers.${name})`);
        continue;
      }
      replacements.push({...owned, text:generated});
      managed[name] = hash(generated);
      expected.mcp_servers[name] = Object.assign(Object.create(null), current, server, {tool_timeout_sec:900n});
    } else if (Object.hasOwn(original.mcp_servers ?? {}, name)) {
      if (managed[name] !== undefined || !object(current) || !sameCommand(current, server)) throw conflict(`${file} (mcp_servers.${name}; missing managed block)`);
    } else {
      additions.push(generated);
      managed[name] = hash(generated);
      expected.mcp_servers[name] = Object.assign(Object.create(null), server, {tool_timeout_sec:900n});
    }
  }
  let candidate = text;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    candidate = candidate.slice(0, replacement.start) + replacement.text + candidate.slice(replacement.end);
  }
  if (additions.length) candidate += (candidate ? (candidate.endsWith('\n') ? '\n' : '\n\n') : '') + additions.join('\n');
  const parsed = toml(candidate, file);
  if (!isDeepStrictEqual(expected, parsed)) {
    throw new Error(`Cannot preserve unrelated TOML settings in ${file}. Merge mcp_servers manually before setup.`);
  }
  return candidate;
}

export function skillFile(text, canonical, managed, relative, file) {
  if (text !== undefined && text !== canonical && managed[relative] !== hash(text)) throw conflict(file);
  managed[relative] = hash(canonical);
  return canonical;
}
