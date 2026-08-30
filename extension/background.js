// 롯데온 content script -> 망고 탭 라우팅
//
// 망고 페이지에는 상주하는 content script 가 없다. 전송 버튼을 눌렀을 때만
// mango.js / mango_main.js 를 주입하므로, 평소 망고 사용에는 어떤 부하도 주지 않는다.
const MANGO_LIST = 'https://tmg4087.mycafe24.com/mall/admin/admin_getorder.php';

function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function searchUrl(receiver) {
  const ed = new Date();
  const sd = new Date();
  sd.setFullYear(sd.getFullYear() - 1);
  const q = new URLSearchParams({
    amode: 'detail_search',
    market_type: '',
    pg: '1',
    sd: ymd(sd),
    ed: ymd(ed),
    ps_duse: '1',
    search_type: 'buyer_name',
    ps_subject: receiver,
  });
  return `${MANGO_LIST}?${q.toString()}`;
}

// 필요한 순간에만 주입한다. 두 스크립트 모두 재주입에 안전하다(자체 가드).
async function runApply(tabId, payload) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['mango_main.js'],
      world: 'MAIN',
    });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['mango.js'] });
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

function waitForLoad(tabId, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('망고 페이지 로딩 시간 초과'));
    }, timeoutMs);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function focus(tabId) {
  const t = await chrome.tabs.get(tabId);
  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(t.windowId, { focused: true });
}

async function handle(payload) {
  // 1) 이미 열려 있는 망고 주문관리 탭에서 먼저 시도
  const tabs = await chrome.tabs.query({ url: MANGO_LIST + '*' });
  for (const t of tabs) {
    const res = await runApply(t.id, payload);
    if (res.ok || res.needsPick) {
      await focus(t.id);
      return res;
    }
  }

  // 2) 못 찾으면 수령인 이름으로 검색한 페이지를 열어서 재시도
  const url = searchUrl(payload.receiver);
  let tabId;
  if (tabs.length) {
    tabId = tabs[0].id;
    await chrome.tabs.update(tabId, { url, active: true });
  } else {
    tabId = (await chrome.tabs.create({ url, active: true })).id;
  }
  await waitForLoad(tabId);

  const res = await runApply(tabId, payload);
  if (res.ok || res.needsPick) return res;
  return { ok: false, error: res.error || `망고에서 "${payload.receiver}" 주문건을 찾지 못했습니다.` };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'SEND_TO_MANGO') {
    handle(msg.payload).then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
    return true; // async
  }
});
