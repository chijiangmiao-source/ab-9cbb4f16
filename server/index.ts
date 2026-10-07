/**
 * HTTP 服务：
 *  - GET  /health       健康响应
 *  - GET  /api/drills   内置演练及其复核结果
 *  - POST /api/verify   复核一份全局规程（投影为各方规范本地状态机，或给出首个不可投影点）
 *  - GET  /*            前端静态资源（web-dist）
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyProtocol } from '../shared/engine.js';
import { DRILLS } from '../shared/drills.js';
import type { Protocol } from '../shared/model.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
const WEB_ROOT = resolve(process.env.WEB_ROOT ?? join(HERE, '..', '..', 'web-dist'));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        rejectPromise(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rejectPromise);
  });
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  let rel = '/index.html';
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('bad request');
    return;
  }
  if (rel === '/') rel = '/index.html';
  const filePath = normalize(join(WEB_ROOT, rel));
  if (filePath !== WEB_ROOT && !filePath.startsWith(WEB_ROOT + sep)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    // SPA 回退到 index.html
    try {
      const data = await readFile(join(WEB_ROOT, 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(data);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('frontend not built');
    }
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    if (req.method === 'GET' && path === '/health') {
      sendJson(res, 200, { status: 'ok', service: 'session-projection-verifier', time: new Date().toISOString() });
      return;
    }
    if (req.method === 'GET' && path === '/api/drills') {
      sendJson(res, 200, {
        drills: DRILLS.map((d) => ({ ...d, result: verifyProtocol(d.protocol) })),
      });
      return;
    }
    if (req.method === 'POST' && path === '/api/verify') {
      const raw = await readBody(req);
      let protocol: Protocol;
      try {
        protocol = JSON.parse(raw) as Protocol;
      } catch {
        sendJson(res, 400, { ok: false, validationErrors: ['请求体不是合法的 JSON'] });
        return;
      }
      sendJson(res, 200, verifyProtocol(protocol));
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      await serveStatic(path, res);
      return;
    }
    sendJson(res, 405, { error: 'method not allowed' });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`[server] 递归会话规程投影复核器已启动: http://localhost:${PORT} (静态目录: ${WEB_ROOT})`);
});
