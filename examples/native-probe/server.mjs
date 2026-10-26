import http from 'node:http';
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeReview, makeFeedback, feedbackText, revision } from './core.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.resolve(root, '../../work/native-probe/runtime');
const file = path.join(root, 'fixture/profile.mjs');
const port = Number(process.env.CODE_DOCTOR_DEMO_PORT || 53173);
const origin = `http://127.0.0.1:${port}`;
await mkdir(runtime, { recursive: true });
let review;
async function refresh() {
  review = makeReview(await readFile(file, 'utf8'), await readFile(path.join(root, 'fixture/before.mjs'), 'utf8'), file);
  await writeFile(path.join(runtime, 'review.json'), JSON.stringify(review, null, 2));
}
await refresh();

async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new Error('Request is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = http.createServer(async (req, res) => {
  const send = (status, data, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, {
      'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
    });
    res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
  };
  try {
    if (req.headers.host !== `127.0.0.1:${port}`) return send(403, { error: 'This probe accepts loopback requests only.' });
    const url = new URL(req.url, origin);
    if (req.method === 'GET' && url.pathname === '/') {
      return send(200, await readFile(path.join(root, 'index.html'), 'utf8'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/review') {
      const liveRevision = revision(await readFile(file, 'utf8'));
      return send(200, { ...review, liveRevision, stale: liveRevision !== review.revision });
    }
    if (req.method !== 'POST') return send(404, { error: 'Not found.' });
    if (req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/json')) {
      return send(403, { error: 'Only requests from this page are accepted.' });
    }
    const input = await body(req);
    if (url.pathname === '/api/refresh') {
      await refresh();
      return send(200, review);
    }
    if (url.pathname === '/api/feedback') {
      const item = makeFeedback(review, await readFile(file, 'utf8'), input);
      await writeFile(path.join(runtime, 'feedback.json'), JSON.stringify(item, null, 2));
      await writeFile(path.join(runtime, 'feedback.md'), feedbackText(item));
      return send(200, { status: item.status, file: path.join(runtime, 'feedback.md') });
    }
    if (url.pathname === '/api/probe') {
      const entry = {
        time: new Date().toISOString(),
        kind: ['capabilities', 'annotation-request'].includes(input.kind) ? input.kind : 'unknown',
        requestAvailable: input.requestAvailable === true,
        accepted: typeof input.accepted === 'boolean' ? input.accepted : null,
        blockId: review.blocks.some(block => block.id === input.blockId) ? input.blockId : null,
      };
      await appendFile(path.join(runtime, 'probe.jsonl'), JSON.stringify(entry) + '\n');
      return send(200, { recorded: true });
    }
    return send(404, { error: 'Not found.' });
  } catch (error) {
    return send(400, { error: error.message });
  }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Code reading connection probe: ${origin}\nRuntime records: ${runtime}`));
