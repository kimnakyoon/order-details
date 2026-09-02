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
  //
  // innerText 는 쓰지 않는다 — 그건 레이아웃을 강제한 뒤 보이는 텍스트를 다시 이어붙인다.
  // textContent 로 읽어도 같은 블록·같은 금액이 나온다 (요소 285개 상세 화면에서 결제금액 읽기
  // 0.016 → 0.0065 ms, 50~200회 × 7시행 중앙값, 2026-09-02 실측).
  const RE_AMOUNT = /결제\s*금액/;

  function payBox() {
    const els = document.querySelectorAll('main *');
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (el.firstElementChild) continue;
      if (el.textContent.trim() !== '결제 정보') continue;
      for (let n = el.parentElement, j = 0; n && j < 6; n = n.parentElement, j++) {
        if (RE_AMOUNT.test(n.textContent)) return n;
      }
    }
    return null;
  }

  // 라벨 뒤에 처음 나오는 '…원'. '결제 금액' 줄에는 할인율 배지('63%')가 끼어 있는데
  // '원' 을 요구하므로 그건 걸리지 않는다. 정규식은 부를 때마다 다시 만들지 않는다.
  const RE_INSTANT = /즉시\s*할인가[\s\S]{0,30}?([\d,]+)\s*원/;
  const RE_PAID = /결제\s*금액[\s\S]{0,30}?([\d,]+)\s*원/;
  const amountAfter = (text, re) => (text.match(re) || [])[1] || '';

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

  // ── 주문정보 — 한 화면을 보는 동안 한 번만 받는다 (지마켓·더현대Hi 와 같은 방식) ──
  //
  // 예전에는 클릭할 때마다 get_order_view 를 새로 받아서, 그 왕복이 고스란히 '전송 중…' 으로
  // 보였다. 버튼 자리가 잡혔다 = 주문상세가 이미 그려졌다는 뜻이라(SPA 가 자기 데이터를 받아
  // 그린 결과다) 그때 미리 받아 두면 클릭은 기다리지 않는다.
  //
  // 캐시는 지금 보고 있는 주문 하나뿐이고, 주문상세를 떠나면 버린다 (anchor 참고).
  let cache = { no: '', data: null };
  let asked = '';
  // 승인일시도 주문건 단위로 들고 있는다. 이 값은 그 주문에서 다시 달라질 값이 아닌데,
  // 재전송마다 영수증 탭을 새로 띄워 다시 읽는 건(이 경로에서 제일 긴 구간이다) 통째로 낭비다.
  let pdCache = { no: '', v: '' };

  function orderView(no) {
    if (cache.no !== no) cache = { no, data: null };
    if (!cache.data) cache.data = json('/order-service/my/order/get_order_view/' + no);
    // 실패한 응답을 물고 있지 않는다 — 다음 클릭은 새로 받는다.
    return cache.data.catch((e) => {
      if (cache.no === no) cache.data = null;
      throw e;
    });
  }

  function prefetch(no) {
    if (!no || asked === no) return;
    asked = no;
    orderView(no).catch(() => {}); // 실패해도 조용히 — 클릭할 때 다시 받는다
  }

  // 주문상세를 떠났다 = 다음에 들어올 때 다시 받는다.
  function forget() {
    if (!asked && !cache.no && !pdCache.no) return;
    asked = '';
    cache = { no: '', data: null };
    pdCache = { no: '', v: '' };
  }

  async function extract() {
    const no = orderNo();
    if (!no) return { error: '주문상세 화면이 아닙니다 (주문번호를 찾지 못했습니다).' };

    let ov;
    try {
      ov = await orderView(no); // 대개 이미 받아 둔 값이라 기다리지 않는다
    } catch (e) {
      return { error: '주문정보를 불러오지 못했습니다 — ' + e.message };
    }
    const oi = ov.orderInfo || {};

    const receiver = (oi.r_nm || '').trim();
    if (!receiver) return { error: '받는 분(수령인)을 찾지 못했습니다.' };

    // 화면에 보이는 값을 그대로 쓰되, 블록을 못 찾으면 API 값으로 같은 규칙을 재현한다.
    const box = payBox();
    const t = box ? box.textContent : '';
    let price = amountAfter(t, RE_INSTANT) || amountAfter(t, RE_PAID);
    if (!price) {
      const promo = Number(oi.promotion_discount_amt || 0);
      const v = promo > 0 ? oi.without_recv_amt_promotion_discount_amt : oi.recv_amt;
      price = v ? comma(v) : '';
    }
    if (!price) return { error: '결제금액을 찾지 못했습니다.' };

    // 영수증 -> 거래명세서 -> 주문일시 순으로 떨어진다. 한 번 얻은 값은 재사용한다 (윗절).
    let payDate = pdCache.no === no ? pdCache.v : '';
    if (!payDate && oi.receiptPageUrl) {
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
    pdCache = { no, v: payDate };

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
  // 캐시가 살아 있는 한(연결돼 있고 같은 주문에서 찾은 자리인 한) 비용은 사실상 0이다.
  // 어느 주문에서 찾아 둔 자리인지를 기억한다. textContent 로 확인하면 틱마다 요소를
  // 문자열로 새로 만든다 — 다시 찾을 때를 정하는 데만 쓰이는 값이라, 찾을 때의 주문번호를
  // 들고 있으면 판별은 똑같고 문자열은 만들지 않는다 (더현대Hi·NS몰과 같은 절약).
  let cached = null;
  let cachedNo = '';

  function anchor() {
    const no = orderNo();
    if (!no) {
      forget(); // 주문상세가 아닌 화면 -> 버튼을 떼고 받아 둔 주문정보도 버린다
      return null;
    }
    if (cached && cachedNo === no && cached.isConnected) {
      prefetch(no); // 버튼 자리가 있다 = 주문상세가 그려졌다. 주문정보를 미리 받아 둔다.
      return cached;
    }

    cached = null;
    cachedNo = '';
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (n.nodeValue.length > 60) continue;
      if (n.nodeValue.indexOf(no) === -1) continue;
      const el = n.parentElement;
      if (el && el.offsetParent !== null) {
        cached = el;
        cachedNo = no;
        break;
      }
    }
    if (cached) prefetch(no);
    return cached;
  }

  window.__LM_SITE__.mount({ extract, anchor, watch: true });
})();
