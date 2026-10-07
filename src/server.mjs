// SPDX-License-Identifier: GPL-3.0-or-later
import http from 'node:http';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { invariant, publicError } from './errors.mjs';
import { encodeDeck } from './deck.mjs';

export async function serve(runtime, { uiRoot, assets, host, port = 8780, id, now = Date.now } = {}) {
  const sessions = new Map();
  const staticFiles = new Map([['/', ['index.html', 'text/html; charset=utf-8']],
    ['/deck.css', ['deck.css', 'text/css; charset=utf-8']], ['/deck.js', ['deck.js', 'text/javascript; charset=utf-8']]]);
  for (const [route, [name, mime]] of staticFiles)
    staticFiles.set(route, { body: assets ? assets[name] : await fs.readFile(path.join(uiRoot, name)), mime });
  function send(res, status, value, headers = {}) {
    const body = JSON.stringify(value);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }); res.end(body);
  }
  async function json(req, limit = 65536) {
    const chunks = []; let bytes = 0;
    invariant(/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''), 'JSON_REQUIRED', 'Expected JSON.', { status: 400 });
    for await (const chunk of req) {
      bytes += chunk.length; invariant(bytes <= limit, 'BODY_LIMIT', 'Request is too large.', { status: 413 });
      chunks.push(chunk);
    }
    try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); invariant(value && typeof value === 'object' && !Array.isArray(value), 'JSON_REQUIRED', 'Expected an object.', { status: 400 }); return value; }
    catch { invariant(false, 'JSON_REQUIRED', 'Invalid JSON.', { status: 400 }); }
  }
  const server = http.createServer(async (req, res) => {
    try {
      const actualPort = server.address().port;
      const allowedHosts = new Set([`127.0.0.1:${actualPort}`, `localhost:${actualPort}`]);
      if (runtime.identity.mode === 'console') allowedHosts.add(`${runtime.identity.ip}:${actualPort}`);
      invariant(allowedHosts.has(req.headers.host), 'HOST_REJECTED', 'Use the console’s local address.', { status: 403 });
      const origin = `http://${req.headers.host}`;
      invariant(!req.headers.origin || req.headers.origin === origin, 'ORIGIN_REJECTED', 'Cross-site access is not allowed.', { status: 403 });
      invariant(req.headers['sec-fetch-site'] !== 'cross-site', 'ORIGIN_REJECTED', 'Cross-site access is not allowed.', { status: 403 });
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      if (req.url === '/native/deck' || req.url === '/native/deck/action') {
        // This private bridge is for the injected renderer. A LAN browser never
        // receives its process-session credential and cannot use phone cookies
        // as a substitute. Native credential is not included in snapshots/logs.
        const credential = req.headers['x-tachen-native'] || '';
        invariant(runtime.consoleDeck && runtime.deckCredential &&
          ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) &&
          !req.headers.origin && /^[a-f0-9]{32}$/.test(credential) &&
          timingSafeEqual(Buffer.from(credential), Buffer.from(runtime.deckCredential)),
          'NATIVE_SESSION', 'Native renderer session required.', { status: 403 });
        let frame;
        if (req.method === 'GET' && req.url === '/native/deck') frame = runtime.consoleDeck.frame();
        else if (req.method === 'POST' && req.url === '/native/deck/action') frame = await runtime.consoleDeck.action(await json(req));
        else return send(res, 405, { error: { code: 'METHOD', message: 'Method not allowed.' } });
        const body = encodeDeck(frame);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
        return res.end(body);
      }
      if (req.method === 'GET' && staticFiles.has(req.url)) {
        const asset = staticFiles.get(req.url);
        res.writeHead(200, { 'Content-Type': asset.mime, 'Cache-Control': 'no-store' }); return res.end(asset.body);
      }
      for (const [key, session] of sessions) if (session.expires <= now()) sessions.delete(key);
      if (req.method === 'POST' && req.url === '/api/session') {
        invariant(req.headers.origin === origin, 'ORIGIN_REQUIRED', 'Open the TacHen page to connect.', { status: 403 });
        // Reuse a live browser session instead of exhausting slots after reloads.
        const cookie = /(?:^|;\s*)tachen=([a-f0-9]{32})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
        let token = cookie, session = sessions.get(cookie);
        if (!session) {
          invariant(sessions.size < 8, 'SESSION_LIMIT', 'Eight devices are already connected.', { status: 429 });
          token = id(); session = { csrf: id(), expires: now() + 8 * 60 * 60 * 1000 }; sessions.set(token, session);
        }
        return send(res, 200, { csrf: session.csrf, state: runtime.snapshot() },
          { 'Set-Cookie': `tachen=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` });
      }
      const token = /(?:^|;\s*)tachen=([a-f0-9]{32})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
      const session = sessions.get(token);
      invariant(session, 'SESSION_REQUIRED', 'Connect from the TacHen page first.', { status: 401 });
      if (req.method === 'GET' && req.url === '/api/state') return send(res, 200, runtime.snapshot());
      if (req.method === 'POST') {
        invariant(req.headers.origin === origin && req.headers['x-tachen-csrf'] === session.csrf,
          'REQUEST_REJECTED', 'This request is not from the connected TacHen page.', { status: 403 });
        if (req.url === '/api/cheats/import') {
          invariant(runtime.cheats, 'FEATURE_UNAVAILABLE', 'Cheat catalog is not installed.');
          return send(res, 200, { result: await runtime.cheats.packs.import(await json(req, 6 * 1024 * 1024)) });
        }
        const upload = /^\/api\/(uploads|package-uploads)\/([a-f0-9]{32})\?offset=(\d+)$/.exec(req.url);
        if (upload) {
          const inbox = upload[1] === 'uploads' ? runtime.inbox : runtime.packageInbox;
          invariant(inbox, 'FEATURE_UNAVAILABLE', 'This file inbox is not installed.');
          invariant(req.headers['content-type'] === 'application/octet-stream', 'BINARY_REQUIRED', 'Expected binary payload bytes.', { status: 400 });
          const chunks = []; let count = 0;
          for await (const chunk of req) { count += chunk.length; invariant(count <= 1024 * 1024, 'BODY_LIMIT', 'Upload chunks are limited to 1 MiB.', { status: 413 }); chunks.push(chunk); }
          const result = await inbox.append(upload[2], Number(upload[3]), Buffer.concat(chunks));
          if (upload[1] === 'uploads') runtime.inboxItems = await inbox.list();
          else runtime.packageItems = await inbox.list();
          return send(res, 200, result);
        }
        if (req.url === '/api/disconnect') {
          sessions.delete(token); return send(res, 200, { disconnected: true }, { 'Set-Cookie': 'tachen=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
        }
        if (req.url === '/api/command') {
          const request = await json(req);
          return send(res, 200, { result: await runtime.execute(request.command, request.args || {}) });
        }
      }
      send(res, 404, { error: { code: 'NOT_FOUND', message: 'Route not found.' } });
    } catch (error) {
      if (!res.headersSent) send(res, error.status || 500, { error: publicError(error) });
      else res.destroy(error);
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return server;
}
