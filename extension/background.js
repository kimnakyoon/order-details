// 마켓(롯데온/SSG) content script -> 망고 탭 라우팅
//
// 망고 페이지에는 상주하는 content script 가 없다. 전송 버튼을 눌렀을 때만
// mango.js / mango_main.js 를 주입하므로, 평소 망고 사용에는 어떤 부하도 주지 않는다.
const MANGO_LIST = 'https://tmg4087.mycafe24.com/mall/admin/admin_getorder.php';

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

async function focus(tabId) {
  const t = await chrome.tabs.get(tabId);
  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(t.windowId, { focused: true });
}

async function handle(payload) {
  // 이미 열려 있는 망고 주문관리 탭에서만 처리한다.
  //
  // 예전에는 못 찾으면 수령인 이름으로 검색한 URL 로 망고 탭을 이동시켰는데,
  // 그게 이 확장에서 압도적으로 비싼 단계였다 — 목록 한 페이지가 요소 1.8만 개라
  // 재로딩에 초 단위가 걸리고, 사용자가 보던 목록·스크롤·체크 상태까지 날아간다.
  // 어차피 대상 주문건을 띄워 놓고 누르는 흐름이라 그 왕복이 통째로 낭비다.
  const tabs = await chrome.tabs.query({ url: MANGO_LIST + '*' });
  if (!tabs.length) {
    return {
      ok: false,
      error: '망고 주문관리 탭이 열려 있지 않습니다. 해당 주문건을 띄운 뒤 다시 눌러주세요.',
    };
  }

  // 보고 있던 탭이 정답일 확률이 높다. 거기서 끝나면 나머지 탭에는 주입조차 하지 않는다.
  tabs.sort((a, b) => Number(b.active) - Number(a.active));
  let lastError = '';
  for (const t of tabs) {
    const res = await runApply(t.id, payload);
    if (res.ok || res.needsPick) {
      await focus(t.id);
      return res;
    }
    lastError = res.error || lastError;
  }
  return { ok: false, error: lastError || `망고에서 "${payload.receiver}" 주문건을 찾지 못했습니다.` };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'SEND_TO_MANGO') {
    handle(msg.payload).then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
    return true; // async
  }
});
