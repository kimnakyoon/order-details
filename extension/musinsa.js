// 무신사 주문상세 페이지 -> 망고 전송용 값 추출
//
// 결제금액: '결제 정보' 블록에 '즉시 할인가' 가 있으면 그것, 없으면 '결제 금액'.
//   즉시 할인가는 카드사 즉시할인이 빠진 실제 청구액이다 (결제 금액 74,870 → 즉시 할인가 71,870).
//
// 결제일시: 영수증(매출전표)의 승인 일시. PG사에 따라 영수증 화면이 두 종류다 —
//   페이코는 pay.musinsapayments.com 이 서버렌더로 '승인 / 2026-08-28 10:03:46' 을 내주고,
//   무신사페이는 dashboard.tosspayments.com 으로 넘어가 자바스크립트로 그린 뒤
//   '결제일시 / 2026-08-27 08:32:08' 을 보여준다. 뒤쪽은 HTML 만 받아서는 값이 없다.
//   그래서 fetch 로 파싱하지 않고 background 가 백그라운드 탭으로 실제로 띄워 읽고 닫는다.
//   영수증을 못 읽으면 거래명세서의 '주문 일자'(분 단위) 로 떨어진다.
(() => {
  'use strict';

  const DETAIL = /^\/order\/order-detail\/(\d{10,})/;
  const orderNo = () => (location.pathname.match(DETAIL) || [])[1] || '';

  const comma = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  // 영수증 표기(2026-08-28 10:03:46)를 그대로 쓴다. 거래명세서는 점으로 찍혀 있어 맞춰준다.
  const dash = (s) => (s || '').trim().replace(/\./g, '-');

  // '결제 정보' 블록. 스타일드컴포넌트 클래스 해시(sc-7uk9xp-3)는 빌드마다 바뀌므로 쓰지 않고,
  // 제목 텍스트에서 '결제 금액' 을 품는 가장 가까운 조상까지 올라간다.
  function payBox() {
    for (const el of document.querySelectorAll('main *')) {
      if (el.children.length) continue;
      if (el.textContent.trim() !== '결제 정보') continue;
      for (let n = el.parentElement, i = 0; n && i < 6; n = n.parentElement, i++) {
        if (/결제\s*금액/.test(n.innerText || '')) return n;
      }
    }
    return null;
  }

  // 라벨 뒤에 처음 나오는 '…원'. '결제 금액' 줄에는 할인율 배지('63%')가 끼어 있는데
  // '원' 을 요구하므로 그건 걸리지 않는다.
  function amountAfter(text, label) {
    const m = text.match(new RegExp(label + '[\\s\\S]{0,30}?([\\d,]+)\\s*원'));
    return m ? m[1] : '';
  }

  async function json(url) {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(url.split('/').slice(-2)[0] + ' 응답 ' + r.status);
    return r.json();
  }

  // 거래명세서(같은 오리진, 서버렌더)의 '주문 일자 2026.08.28 10:03'
  async function statementDate(no) {
    try {
      const html = await (await fetch('/order-service/my/order/payment_receipt/' + no)).text();
      const m = html.match(/주문\s*일자[\s\S]{0,120}?(20\d\d[.\-]\d{2}[.\-]\d{2}(?:\s+\d{2}:\d{2}(?::\d{2})?)?)/);
      return m ? dash(m[1]) : '';
    } catch (e) {
      return '';
    }
  }

  async function extract() {
    const no = orderNo();
    if (!no) return { error: '주문상세 화면이 아닙니다 (주문번호를 찾지 못했습니다).' };

    let ov;
    try {
      ov = await json('/order-service/my/order/get_order_view/' + no);
    } catch (e) {
      return { error: '주문정보를 불러오지 못했습니다 — ' + e.message };
    }
    const oi = ov.orderInfo || {};

    const receiver = (oi.r_nm || '').trim();
    if (!receiver) return { error: '받는 분(수령인)을 찾지 못했습니다.' };

    // 화면에 보이는 값을 그대로 쓰되, 블록을 못 찾으면 API 값으로 같은 규칙을 재현한다.
    const box = payBox();
    const t = box ? box.innerText.replace(/\r/g, '') : '';
    let price = amountAfter(t, '즉시\\s*할인가') || amountAfter(t, '결제\\s*금액');
    if (!price) {
      const promo = Number(oi.promotion_discount_amt || 0);
      const v = promo > 0 ? oi.without_recv_amt_promotion_discount_amt : oi.recv_amt;
      price = v ? comma(v) : '';
    }
    if (!price) return { error: '결제금액을 찾지 못했습니다.' };

    // 영수증 -> 거래명세서 -> 주문일시 순으로 떨어진다.
    let payDate = '';
    if (oi.receiptPageUrl) {
      try {
        const r = await chrome.runtime.sendMessage({ type: 'READ_RECEIPT', url: oi.receiptPageUrl });
        if (r && r.datetime) payDate = dash(r.datetime);
      } catch (e) {
        /* 영수증을 못 열면 아래 폴백으로 */
      }
    }
    if (!payDate) payDate = await statementDate(no);
    if (!payDate && ov.orderList) payDate = dash(ov.orderList.orderDatetime);
    if (!payDate) return { error: '결제일시를 찾지 못했습니다 (영수증·거래명세서 모두 실패).' };

    return {
      url: 'https://www.musinsa.com/order/order-detail/' + no,
      orderNo: no, // 202608281003370001
      price: price.replace(/,/g, ''), // 숫자만
      payDate, // 2026-08-28 10:03:46
      receiver,
      total: oi.recv_amt ? comma(oi.recv_amt) : price, // 망고 행 매칭 보조키 (결제 금액)
      marketTag: ['무신사', 'MUSINSA'], // 망고 목록 행에 어느 쪽으로 찍혀 있어도 잡히도록
    };
  }

  // '주문번호 202608281003370001' 이 찍힌 요소 옆에 버튼을 붙인다.
  //
  // 무신사는 SPA 라 주문목록 -> 주문상세로 문서를 다시 읽지 않고 넘어간다. common.js 의
  // watch 가 이 함수를 주기적으로 부르므로, 매번 문서를 훑지 않도록 찾은 요소를 캐시한다.
  // 캐시가 살아 있는 한(연결돼 있고 지금 주문번호를 담고 있는 한) 비용은 사실상 0이다.
  let cached = null;

  function anchor() {
    const no = orderNo();
    if (!no) return null; // 주문상세가 아닌 화면 -> 버튼을 뗀다
    if (cached && cached.isConnected && cached.textContent.indexOf(no) !== -1) return cached;

    cached = null;
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (n.nodeValue.length > 60) continue;
      if (n.nodeValue.indexOf(no) === -1) continue;
      const el = n.parentElement;
      if (el && el.offsetParent !== null) {
        cached = el;
        break;
      }
    }
    return cached;
  }

  window.__LM_SITE__.mount({ extract, anchor, watch: true });
})();
