// 롯데온 주문상세 페이지 -> 4개 값 추출 후 The.Mango 로 전송
(() => {
  'use strict';

  function extract() {
    const odNo =
      (document.querySelector('.topInformation .orderNumber') || {}).textContent?.trim() ||
      new URLSearchParams(location.search).get('odNo');
    if (!odNo) return { error: '주문번호를 찾지 못했습니다.' };

    // 결제정보 블록 찾기 (h4.title === '결제정보')
    let payBox = null;
    for (const h of document.querySelectorAll('h4, h3, strong, span')) {
      if (h.textContent.trim() === '결제정보') {
        payBox = h.parentElement.parentElement;
        break;
      }
    }
    const payText = payBox ? payBox.innerText.replace(/\r/g, '') : '';

    // 'P'(L.POINT) 가 아닌 '원' 단위 금액 = 실결제금액. 복수 결제수단이면 합산.
    const cash = [...payText.matchAll(/([\d,]+)\s*원/g)].map((m) =>
      parseInt(m[1].replace(/,/g, ''), 10)
    );
    const price = cash.reduce((a, b) => a + b, 0);
    const payDate = (payText.match(/20\d\d\.\d{2}\.\d{2}/) || [])[0] || '';

    // 총 결제금액 (망고 행 매칭 보조키로만 사용)
    let total = '';
    for (const dt of document.querySelectorAll('.amountInformation dt')) {
      if (/총\s*결제금액/.test(dt.textContent)) {
        total = (dt.parentElement.innerText.match(/([\d,]+)\s*원/) || [])[1] || '';
        break;
      }
    }

    const receiver = (document.body.innerText.match(/받는\s*분\s*\n\s*([^\n]+)/) || [])[1] || '';

    if (!price) return { error: '결제금액을 찾지 못했습니다.' };
    if (!payDate) return { error: '결제일시를 찾지 못했습니다.' };
    if (!receiver) return { error: '받는 분(수령인)을 찾지 못했습니다.' };

    return {
      url: 'https://www.lotteon.com/p/order/claim/orderDetail?odNo=' + odNo,
      orderNo: odNo,
      price: String(price), // 숫자만
      payDate, // 2026.08.29
      receiver,
      total, // "42,720"
    };
  }

  function toast(msg, kind) {
    let t = document.getElementById('lm-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'lm-toast';
      document.body.appendChild(t);
    }
    t.className = 'lm-toast lm-' + (kind || 'info');
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => (t.style.display = 'none'), 6000);
  }

  const btn = document.createElement('button');
  btn.id = 'lm-send-btn';
  btn.type = 'button';
  btn.textContent = '🥭 망고로 전송';
  btn.addEventListener('click', async () => {
    const data = extract();
    if (data.error) {
      toast('추출 실패: ' + data.error, 'err');
      return;
    }
    btn.disabled = true;
    btn.textContent = '전송 중…';
    try {
      const res = await chrome.runtime.sendMessage({ type: 'SEND_TO_MANGO', payload: data });
      if (res && res.ok) {
        toast(`${data.receiver}님 주문건에 반영했습니다. 망고 탭에서 확인하세요.`, 'ok');
      } else {
        toast('실패: ' + ((res && res.error) || '알 수 없는 오류'), 'err');
      }
    } catch (e) {
      toast('실패: ' + e.message, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = '🥭 망고로 전송';
    }
  });
  // 주문번호 바로 옆에 버튼을 붙인다. 아직 안 그려졌으면 나타날 때까지 기다린다.
  function mount() {
    if (btn.isConnected) return true;
    const anchor = document.querySelector('.topInformation .orderNumber');
    if (anchor && anchor.parentElement) {
      btn.className = 'lm-btn-inline';
      anchor.insertAdjacentElement('afterend', btn);
      return true;
    }
    return false;
  }

  if (!mount()) {
    const obs = new MutationObserver(() => {
      if (mount()) obs.disconnect();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    // 끝내 못 찾으면 우측 하단 고정 버튼으로 폴백
    setTimeout(() => {
      if (!btn.isConnected) {
        obs.disconnect();
        btn.className = 'lm-btn';
        document.body.appendChild(btn);
      }
    }, 10000);
  }
})();
