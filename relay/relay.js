// 브라우저 사이 다리 — 웨일/엣지에서 뽑은 주문정보를 크롬(망고 탭이 있는 쪽)으로 넘긴다.
//
// 확장은 브라우저마다 완전히 격리된다. 웨일에 설치한 확장의 chrome.tabs 는 크롬의 탭을
// 볼 수 없어서, 어떤 브라우저에 있든 같은 확장이 이 서버 하나를 보고 주고받는다.
//
//   보내는 쪽 : 이 브라우저에 망고 탭이 없다  -> POST /send
//   받는 쪽   : 이 브라우저에 망고 탭이 있다  -> GET /pending -> 적용 -> POST /ack
//
// 어느 쪽인지 설정할 필요가 없다. '망고 탭이 열려 있는 브라우저'가 곧 받는 쪽이다.
//
// 의존성 없음. `node relay/relay.js` (또는 relay/start.cmd).
'use strict';

const http = require('http');

const PORT = Number(process.env.LM_RELAY_PORT || 8787);
const MAX_QUEUE = 20;
const MAX_BODY = 64 * 1024;
// 오래된 건 버린다. 브라우저를 안 켠 채 하루가 지난 값을 뒤늦게 반영하면 곤란하다.
const TTL_MS = 6 * 60 * 60 * 1000;

/** @type {{id:string, payload:object, from:string, at:number}[]} */
let queue = [];
let seq = 0;

const now = () => Date.now();
const sweep = () => (queue = queue.filter((it) => now() - it.at < TTL_MS));

function log(...a) {
  console.log(new Date().toTimeString().slice(0, 8), ...a);
}

function send(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    // 확장의 service worker 는 host_permissions 로 CORS 를 넘지만, 브라우저 주소창에서
    // 상태를 확인하거나 다른 방식으로 붙을 때를 위해 열어 둔다. 어차피 루프백 전용이다.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('본문이 너무 큽니다.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// 넘어온 값이 확장이 보낸 주문 payload 인지 확인한다. 루프백이라도 아무거나 큐에
// 쌓이면 나중에 망고에 그대로 써지므로, 필요한 문자열 필드가 다 있어야만 받는다.
const NEEDED = ['url', 'orderNo', 'price', 'payDate', 'receiver'];

function validate(p) {
  if (!p || typeof p !== 'object') return '주문정보가 아닙니다.';
  for (const k of NEEDED) {
    if (typeof p[k] !== 'string' || !p[k].trim()) return `'${k}' 값이 없습니다.`;
  }
  if (!/^https:\/\//.test(p.url)) return 'url 이 https 가 아닙니다.';
  return '';
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const path = url.pathname;

  if (req.method === 'OPTIONS') return send(res, 204, {});

  try {
    if (req.method === 'GET' && path === '/health') {
      sweep();
      return send(res, 200, { ok: true, queued: queue.length });
    }

    if (req.method === 'POST' && path === '/send') {
      const p = JSON.parse((await readBody(req)) || '{}');
      const bad = validate(p.payload);
      if (bad) return send(res, 400, { ok: false, error: bad });

      sweep();
      if (queue.length >= MAX_QUEUE) {
        return send(res, 429, { ok: false, error: `대기열이 가득 찼습니다 (${MAX_QUEUE}건).` });
      }
      const item = {
        id: String(++seq) + '-' + now().toString(36),
        payload: p.payload,
        from: String(p.from || '다른 브라우저').slice(0, 40),
        at: now(),
      };
      queue.push(item);
      log(`받음  ${item.from} · ${item.payload.receiver} · ${item.payload.orderNo} (대기 ${queue.length})`);
      return send(res, 200, { ok: true, id: item.id, queued: queue.length });
    }

    // 꺼내 가되 지우지는 않는다. 받는 쪽이 실제로 반영에 성공해 /ack 를 보내야 사라진다.
    // 망고 탭에 그 주문건이 아직 없어서 실패하는 일이 흔한데, 그때 값을 잃으면 안 된다.
    //
    // ?skip=id1,id2 — 받는 쪽이 '이미 시도해봤고 실패한' 건들을 넘긴다. 그래야 한 건이
    // 막혀 있어도 뒤의 건들이 흘러가고, 막힌 건은 사용자가 확장 아이콘을 눌러 풀 때까지
    // 망고 페이지를 다시 긁지 않는다. 큐 순서는 그대로 둔다.
    if (req.method === 'GET' && path === '/pending') {
      sweep();
      const skip = (url.searchParams.get('skip') || '').split(',').filter(Boolean);
      const item = queue.filter((it) => skip.indexOf(it.id) === -1)[0] || null;
      return send(res, 200, { ok: true, item, remaining: queue.length });
    }

    if (req.method === 'POST' && path === '/ack') {
      const { id } = JSON.parse((await readBody(req)) || '{}');
      const before = queue.length;
      queue = queue.filter((it) => it.id !== id);
      if (before !== queue.length) log(`반영  ${id} (대기 ${queue.length})`);
      return send(res, 200, { ok: true, remaining: queue.length });
    }

    return send(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    return send(res, 400, { ok: false, error: e.message });
  }
});

// 루프백에만 묶는다. 같은 기기의 브라우저들만 쓰면 되고, 밖에서 닿을 이유가 없다.
server.listen(PORT, '127.0.0.1', () => {
  log(`릴레이 대기 중 — http://127.0.0.1:${PORT}`);
  log('웨일·엣지에서 [🥭 망고로 전송] 을 누르면 여기에 쌓이고,');
  log('망고 탭이 열려 있는 크롬 창을 띄우면 그쪽이 가져가 반영합니다.');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`포트 ${PORT} 가 이미 쓰이고 있습니다. 릴레이가 이미 떠 있는지 확인하세요.`);
    process.exit(1);
  }
  throw e;
});
