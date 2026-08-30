// 마켓(롯데온/SSG/무신사) content script -> 망고 탭 라우팅
//
// 망고 페이지에는 상주하는 content script 가 없다. 전송 버튼을 눌렀을 때만
// mango.js / mango_main.js 를 주입하므로, 평소 망고 사용에는 어떤 부하도 주지 않는다.
const MANGO_LIST = 'https://tmg4087.mycafe24.com/mall/admin/admin_getorder.php';

// 필요한 순간에만 주입한다. 두 스크립트 모두 재주입에 안전하다(자체 가드).
//
// 두 파일은 서로를 기다릴 이유가 없어 나란히 넣는다 — mango_main.js 는 window 리스너를
// 하나 걸어둘 뿐이고, 그 리스너는 저장 직전에야 불린다. 주입 왕복이 3번에서 2번으로 준다.
async function runApply(tabId, payload) {
  try {
    await Promise.all([
      chrome.scripting.executeScript({ target: { tabId }, files: ['mango_main.js'], world: 'MAIN' }),
      chrome.scripting.executeScript({ target: { tabId }, files: ['mango.js'] }),
    ]);
    const [hit] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (p) => window.__LM_MANGO__.run(p),
      args: [payload],
    });
    return (hit && hit.result) || { ok: false, error: '망고 페이지에서 응답이 없습니다.' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// 탭 객체를 그대로 받는다. chrome.tabs.query 가 windowId 를 이미 실어 주므로
// windowId 하나 때문에 chrome.tabs.get 을 다시 부를 필요가 없다.
async function focus(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

const mangoTabs = () => chrome.tabs.query({ url: MANGO_LIST + '*' });

// 이 브라우저에 열려 있는 망고 탭들에 반영을 시도한다.
async function applyHere(payload, tabs) {
  // 보고 있던 탭이 정답일 확률이 높다. 거기서 끝나면 나머지 탭에는 주입조차 하지 않는다.
  tabs.sort((a, b) => Number(b.active) - Number(a.active));
  let lastError = '';
  for (const t of tabs) {
    const res = await runApply(t.id, payload);
    if (res.ok || res.needsPick) {
      await focus(t);
      return res;
    }
    lastError = res.error || lastError;
  }
  return { ok: false, error: lastError || `망고에서 "${payload.receiver}" 주문건을 찾지 못했습니다.` };
}

async function handle(payload) {
  // 이미 열려 있는 망고 주문관리 탭에서만 처리한다.
  //
  // 예전에는 못 찾으면 수령인 이름으로 검색한 URL 로 망고 탭을 이동시켰는데,
  // 그게 이 확장에서 압도적으로 비싼 단계였다 — 목록 한 페이지가 요소 1.8만 개라
  // 재로딩에 초 단위가 걸리고, 사용자가 보던 목록·스크롤·체크 상태까지 날아간다.
  // 어차피 대상 주문건을 띄워 놓고 누르는 흐름이라 그 왕복이 통째로 낭비다.
  const tabs = await mangoTabs();
  // 이 브라우저에 망고 탭이 없다 = 여기는 '보내는 쪽'. 릴레이로 넘긴다.
  if (!tabs.length) return relaySend(payload);
  return applyHere(payload, tabs);
}

// ── 무신사 영수증(매출전표) 읽기 ─────────────────────────────────────────────
//
// 영수증 화면이 PG사마다 다르다. 페이코는 pay.musinsapayments.com 이 HTML 로 다 내주지만,
// 무신사페이는 dashboard.tosspayments.com 으로 넘어가 값을 자바스크립트로 그린다. 그래서
// HTML 을 fetch 해서 파싱하는 방법은 절반만 통한다 — 백그라운드 탭으로 실제로 띄워 읽고 닫는다.
// (content script 는 CORS 때문에 애초에 이 주소를 fetch 할 수 없다.)
const RECEIPT_URL = /^https:\/\/pay\.musinsapayments\.com\//;

// 영수증 탭 안에서 실행된다.
// 페이코  : '승인번호 60818565 / 승인 2026-08-28 10:03:46'
// 무신사페이: '승인번호 72686481 / 결제일시 2026-08-27 08:32:08'
// '승인번호' 뒤에는 숫자가 바로 붙어서 날짜 패턴에 걸리지 않는다.
function scrapeApproval() {
  const t = (document.body && document.body.innerText) || '';
  const m = t.match(
    /(?:승인일시|결제일시|승인)[^\d]{0,20}(20\d\d[-.]\d{2}[-.]\d{2}\s+\d{2}:\d{2}(?::\d{2})?)/
  );
  return m ? m[1] : '';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readReceipt(url) {
  if (!RECEIPT_URL.test(url || '')) return { error: '알 수 없는 영수증 주소입니다.' };

  let tab;
  try {
    tab = await chrome.tabs.create({ url, active: false });
  } catch (e) {
    return { error: e.message };
  }
  try {
    // 리다이렉트 + 클라이언트 렌더까지 기다린다. 보통 1초 안에 잡힌다.
    for (let i = 0; i < 25; i++) {
      await sleep(300);
      try {
        const [r] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: scrapeApproval,
        });
        if (r && r.result) return { datetime: r.result };
      } catch (e) {
        // 아직 이동 중이거나 권한 밖 호스트로 넘어간 경우 — 계속 기다린다.
      }
    }
    return { error: '영수증에서 승인일시를 읽지 못했습니다.' };
  } finally {
    try {
      await chrome.tabs.remove(tab.id);
    } catch (e) {
      /* 사용자가 먼저 닫았을 수 있다 */
    }
  }
}

// ── 브라우저 사이 다리 (relay/relay.js) ──────────────────────────────────────
//
// 무신사 계정이 세 개라 크롬·웨일·엣지에 하나씩 로그인해 두는데, 확장은 브라우저마다
// 완전히 격리되어 웨일의 chrome.tabs 로는 크롬의 망고 탭을 볼 수 없다. 그래서 세 브라우저에
// 같은 확장을 깔고, 사이에 루프백 서버 하나를 둔다.
//
//   망고 탭이 없는 브라우저 = 보내는 쪽 -> POST /send 로 넘기고 끝
//   망고 탭이 있는 브라우저 = 받는 쪽   -> 창이 포커스될 때 GET /pending 해서 반영 -> POST /ack
//
// 어느 쪽인지 설정할 필요가 없다. 망고 탭의 유무가 곧 역할이다.
//
// 받는 쪽을 계속 깨워 두지 않는 이유: MV3 service worker 는 30초면 잠든다. 살려 두려면
// WebSocket 이나 폴링으로 계속 두드려야 하는데, 어차피 사용자가 결과를 보려면 크롬 창을
// 띄워야 한다. 그래서 '크롬 창이 포커스될 때' 를 신호로 쓴다 — 상주 비용이 0이고,
// 사용자가 크롬으로 넘어오는 그 순간에 이미 반영돼 있다.
const RELAY = 'http://127.0.0.1:8787';

// UA 에서 브라우저 이름만 뽑는다 (알림에 "웨일에서 넘어온 …" 으로 찍기 위한 것).
function browserName() {
  const ua = navigator.userAgent;
  if (/Whale/.test(ua)) return '웨일';
  if (/Edg\//.test(ua)) return '엣지';
  return '크롬';
}

async function relay(path, init) {
  const r = await fetch(RELAY + path, init);
  if (!r.ok) {
    const t = await r.json().catch(() => ({}));
    throw new Error(t.error || '릴레이 응답 ' + r.status);
  }
  return r.json();
}

async function relaySend(payload) {
  try {
    const r = await relay('/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload, from: browserName() }),
    });
    return {
      ok: true,
      relayed: true,
      note:
        '망고 탭이 열려 있는 크롬 창을 띄우면 반영됩니다.' +
        (r.queued > 1 ? ` (대기 ${r.queued}건)` : ''),
    };
  } catch (e) {
    // 릴레이를 안 쓰는 경우(브라우저 하나로만 작업)가 대부분이다. 그때는 이게 곧
    // "망고 탭이 없다" 는 뜻이라, 릴레이 이야기는 뒤에 덧붙이기만 한다.
    return {
      ok: false,
      error:
        '망고 주문관리 탭이 열려 있지 않습니다. 해당 주문건을 띄운 뒤 다시 눌러주세요.\n' +
        '(다른 브라우저의 망고로 넘기려면 relay/start.cmd 가 떠 있어야 합니다 — ' +
        e.message +
        ')',
    };
  }
}

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon128.png',
    title,
    message,
  });
}

// 한 번 실패한 건은 자동으로 다시 시도하지 않는다.
//
// 실패의 압도적 다수는 '그 주문건이 지금 망고 목록에 없다' 이고, 그건 사용자가 목록을
// 바꾸기 전까지 계속 실패한다. 그런데 신호가 '창 포커스'라서, 막아두지 않으면 창을 오갈
// 때마다 망고 페이지에 스크립트를 주입하고 목록 전체를 훑게 된다 — 확장이 망고를
// 느리게 만드는 유일한 경로가 바로 이것이다.
//
// 그래서 실패한 id 를 적어 두고 릴레이에 skip 으로 넘긴다. 다음 건은 그대로 흘러가고,
// 막힌 건은 **확장 아이콘을 눌렀을 때만** 다시 시도한다. service worker 가 잠들어도
// 유지되도록 chrome.storage.session 에 둔다 (브라우저를 닫으면 같이 사라진다).
const BLOCK_KEY = 'lmBlocked';

async function blockedIds() {
  try {
    const o = await chrome.storage.session.get(BLOCK_KEY);
    return o[BLOCK_KEY] || [];
  } catch (e) {
    return [];
  }
}

async function blockId(id) {
  const list = await blockedIds();
  if (list.indexOf(id) !== -1) return;
  list.push(id);
  // 릴레이 큐 상한과 맞춘다. 오래된 것부터 잊는다.
  try {
    await chrome.storage.session.set({ [BLOCK_KEY]: list.slice(-20) });
  } catch (e) {
    /* 저장이 안 되면 최악이라도 예전처럼 동작할 뿐이다 */
  }
}

// 대기 중인 값을 하나 가져와 반영한다.
//
// 한 번에 하나만 처리한다. 반영에 성공하면 망고가 [선택수정]으로 페이지를 다시 읽어서
// 목록이 통째로 바뀌기 때문에, 이어서 두 번째를 밀어 넣으면 바뀐 목록 위에서 매칭하게 된다.
// 남은 건은 다음 포커스 때(또는 확장 아이콘을 눌러) 처리한다.
let draining = false;
let lastDrain = 0;

async function drain(force) {
  if (draining) return;
  // 창을 몇 번 오가면 포커스 이벤트가 연달아 온다. 그때마다 탭을 훑고 릴레이를 두드릴 이유가 없다.
  if (!force && Date.now() - lastDrain < 1500) return;
  draining = true;
  lastDrain = Date.now();
  try {
    // 망고 탭이 없으면 여기는 받는 쪽이 아니다. 릴레이를 두드리기 전에 여기서 끝난다
    // (웨일·엣지는 이 한 줄 때문에 포커스가 바뀌어도 아무것도 하지 않는다).
    const tabs = await mangoTabs();
    if (!tabs.length) return;

    if (force) await chrome.storage.session.remove(BLOCK_KEY).catch(() => {});
    const skip = force ? [] : await blockedIds();

    let head;
    try {
      head = await relay('/pending' + (skip.length ? '?skip=' + skip.join(',') : ''));
    } catch (e) {
      return; // 릴레이가 안 떠 있으면 조용히 넘어간다
    }
    if (!head.item) return;

    const { id, payload, from } = head.item;
    const res = await applyHere(payload, tabs);

    // 사람이 골라야 하는 상태(후보 동점)도 망고 화면에 이미 떠 있으므로 처리된 것으로 본다.
    // 여기서 지우지 않으면 창을 옮길 때마다 같은 선택 UI 가 다시 뜬다.
    if (res.ok || res.needsPick) {
      await relay('/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      }).catch(() => {});
    } else {
      await blockId(id);
    }

    const left = Math.max(0, (head.remaining || 1) - 1);
    const tail = left ? ` (남은 ${left}건)` : '';
    if (res.ok) notify(`${from} → 망고 반영 완료`, `${payload.receiver} · ${payload.orderNo}${tail}`);
    else if (res.needsPick) notify(`${from} → 확인 필요`, res.error);
    else notify(`${from} → 반영 실패`, res.error + '\n해당 주문건을 망고 목록에 띄운 뒤 확장 아이콘을 눌러주세요.');
  } finally {
    draining = false;
    lastDrain = Date.now();
  }
}

// 사용자가 이 브라우저 창으로 넘어오는 순간이 곧 신호다.
chrome.windows.onFocusChanged.addListener((id) => {
  if (id !== chrome.windows.WINDOW_ID_NONE) drain(false);
});
// 막혀 있던 건까지 전부 다시 시도하는 수동 스위치.
chrome.action.onClicked.addListener(() => drain(true));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'SEND_TO_MANGO') {
    handle(msg.payload).then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
    return true; // async
  }
  if (msg && msg.type === 'READ_RECEIPT') {
    readReceipt(msg.url).then(sendResponse, (e) => sendResponse({ error: e.message }));
    return true; // async
  }
});
