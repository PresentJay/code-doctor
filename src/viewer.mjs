import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createService } from './service.mjs';

const assets = new Map([
  ['/', ['../web/index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['../web/style.css', 'text/css; charset=utf-8']],
  ['/app.mjs', ['../web/app.mjs', 'text/javascript; charset=utf-8']],
  ['/i18n.mjs', ['../web/i18n.mjs', 'text/javascript; charset=utf-8']],
  ['/messages.mjs', ['../web/messages.mjs', 'text/javascript; charset=utf-8']],
  ['/reading.mjs', ['./reading.mjs', 'text/javascript; charset=utf-8']],
]);
const fail = (status, code, message) => Object.assign(new Error(message), {status, code});
const empty = () => ({review:null, latestReviewId:null, freshness:{state:'unavailable',reason:'No review yet.'}, feedbacks:[], history:[], previousReviewId:null});

function classify(error) {
  if (error.status) return error;
  if (/storage is busy/.test(error.message)) return fail(409, 'busy', error.message);
  if (/Review changed|Code changed|Stale review/.test(error.message)) return fail(409, 'stale', error.message);
  if (/Unknown review/.test(error.message)) return fail(404, 'invalid', error.message);
  return fail(400, 'invalid', error.message);
}

async function body(request) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw fail(415, 'invalid', 'Use application/json.');
  const limit = 65536;
  if (Number(request.headers['content-length']) > limit) throw fail(413, 'invalid', 'Request body exceeds 64 KiB.');
  const raw = await new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { chunks.length = 0; reject(fail(413, 'invalid', 'Request body exceeds 64 KiB.')); }
      else chunks.push(chunk);
    });
    request.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.once('error', reject);
    request.once('aborted', () => reject(fail(400, 'invalid', 'Request aborted.')));
  });
  let value;
  try { value = JSON.parse(raw); } catch { throw fail(400, 'invalid', 'Invalid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, 'invalid', 'Expected a JSON object.');
  return value;
}

export async function startReviewServer({cwd, service, port = 0} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535.');
  service ??= await createService(cwd ?? process.cwd());
  const token = randomBytes(24).toString('hex');
  let origin;
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    const json = (status, value) => {
      response.writeHead(status, {'Content-Type':'application/json; charset=utf-8'});
      response.end(JSON.stringify(value));
    };
    try {
      if (request.headers.host !== new URL(origin).host) throw fail(403, 'forbidden', 'Unexpected Host. Use the loopback review URL.');
      if (request.headers.origin && request.headers.origin !== origin) throw fail(403, 'forbidden', 'Cross-origin requests are not allowed.');
      const url = new URL(request.url, origin);
      if (url.origin !== origin) throw fail(403, 'forbidden', 'Unexpected request origin.');
      if (!url.pathname.startsWith('/api/')) {
        const asset = assets.get(url.pathname);
        if (!asset || url.search) throw fail(404, 'not-found', 'Not found.');
        if (request.method !== 'GET') throw fail(405, 'invalid', 'Use GET.');
        const content = await readFile(new URL(asset[0], import.meta.url));
        response.writeHead(200, {'Content-Type':asset[1]});
        response.end(content);
        return;
      }
      const supplied = Buffer.from(request.headers['x-code-doctor-token'] ?? '');
      const expected = Buffer.from(token);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw fail(401, 'unauthorized', 'Use the token from the review URL.');
      if (url.pathname === '/api/review') {
        if (request.method !== 'GET') throw fail(405, 'invalid', 'Use GET.');
        if ([...url.searchParams.keys()].some(key => key !== 'reviewId') || url.searchParams.getAll('reviewId').length > 1) throw fail(400, 'invalid', 'Unexpected query parameters.');
        let result;
        try { result = await service.state({reviewId:url.searchParams.get('reviewId') ?? undefined}); }
        catch (error) { if (!url.search && error.message.startsWith('No review yet.')) result = empty(); else throw error; }
        json(200, result);
        return;
      }
      if (!['/api/feedback','/api/recapture'].includes(url.pathname)) throw fail(404, 'not-found', 'Not found.');
      if (request.method !== 'POST') throw fail(405, 'invalid', 'Use POST.');
      if (url.search) throw fail(400, 'invalid', 'Unexpected query parameters.');
      const input = await body(request);
      if (url.pathname === '/api/feedback') {
        const fields = ['reviewId','blockId','text'];
        if (Object.keys(input).length !== fields.length || fields.some(key => typeof input[key] !== 'string') || Object.keys(input).some(key => !fields.includes(key))) throw fail(400, 'invalid', 'Expected reviewId, blockId and text strings.');
        json(200, await service.feedback(input));
      } else {
        if (Object.keys(input).length) throw fail(400, 'invalid', 'Recapture accepts an empty object and preserves the current task context.');
        await service.capture();
        json(200, await service.state());
      }
    } catch (error) {
      request.resume();
      const result = classify(error);
      if (!response.headersSent) json(result.status, {error:result.message, code:result.code});
      else response.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 1000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {url:`${origin}/#token=${token}`, repo:service.root, server,
    close:() => new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); })};
}
