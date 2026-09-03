// 11번가 주문상세 페이지 -> 망고 전송용 값 추출
//
// 주문상세(BuyManager.tmall?method=getOrderDetailInfo)는 서버가 다 그려 주는 고전 페이지다.
// 같은 화면이 두 경로로 열린다 — /my11st/order/BuyManager.tmall 과 /order/BuyManager.tmall
// (뒤쪽은 버튼이 안 붙던 화면의 주소로 제보됐다. 어디서 그 주소로 오는지는 아직 모른다 —
// 주문/배송조회 목록의 주문상세는 앞쪽으로 온다. 2026-09-03). 매니페스트가 둘 다 받는다.
// (GS SHOP 과 같은 결). 값은 화면에서 바로 읽되, **결제일시만은 화면에 없다** — '결제영수증
// 출력' 팝업(viewReceipt.tmall)의 '주문일'(초 단위)이 유일한 출처다. 같은 오리진이라 팝업을
// 띄우지 않고 fetch 로 조용히 받아 읽는다 (무신사 거래명세서와 같은 방식).
//
//   결제금액: 결제정보 표의 '총 결제금액' (사용자 결정 — 즉시할인이 이미 빠진 값이다)
//   결제일시: 영수증 '주문일' (2026/09/01 08:03:55 -> 2026.09.01 08:03:55)
//   수령인:   배송지 정보 표의 '받는사람'
(() => {
  'use strict';

  // BuyManager.tmall 은 method 에 따라 여러 화면을 그리는 주소다. 주문상세가 아니면 아무것도
  // 하지 않는다 — 공통 폴백(10초 뒤 우측 하단 고정 버튼)이 엉뚱한 화면에 뜨는 일을 막는다.
  if (new URLSearchParams(location.search).get('method') !== 'getOrderDetailInfo') return;

  // 영수증 주문정보 표: 주문일 라벨 뒤 첫 날짜. '2026/09/01 08:03:55' 꼴을 봤지만
  // 구분자와 시각 유무는 느슨하게 받는다.
  const PAY_DATE =
    /주문일[\s\S]{0,200}?(20\d\d)[./-](\d{1,2})[./-](\d{1,2})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?/;

  const p2 = (v) => String(v).padStart(2, '0');

  // 상단 '주문/배송상세 (주문번호 20260901096939093)' 의 괄호 부분. 버튼도 이 옆에 붙는다.
  const ttl = () => document.querySelector('.mytmall_ttl2 .ttl_cont');

  function orderNo() {
    const el = ttl();
    const m = el && el.textContent.match(/\d{6,}/);
    if (m) return m[0];
    // 화면 표기를 못 찾으면 배송지변경 폼의 숨은 값으로. 같은 번호다.
    const inp = document.querySelector('input[name="ordNo"]');
    return inp && inp.value ? inp.value.trim() : '';
  }

  // 결제정보 표의 '총 결제금액' 줄. 금액은 그 행에서 유일하게 강조된 strong.red 다.
  function totalAmount() {
    for (const s of document.querySelectorAll('th strong')) {
      if (s.textContent.replace(/\s/g, '') !== '총결제금액') continue;
      const tr = s.closest('tr');
      const red = tr && tr.querySelector('strong.red');
      const m = red && red.textContent.match(/([\d,]+)\s*원/);
      if (m) return m[1];
    }
    return '';
  }

  // 배송지 정보 표의 '받는사람' -> 같은 행의 이름(strong). 배송지가 여럿인 주문은 아직 보지
  // 못했다 — 그때는 첫 블록의 것이 나간다 (롯데온과 같은 결정).
  function receiverName() {
    for (const p of document.querySelectorAll('th p')) {
      if (p.textContent.trim() !== '받는사람') continue;
      const tr = p.closest('tr');
      const st = tr && tr.querySelector('td strong');
      if (st && st.textContent.trim()) return st.textContent.trim();
    }
    return '';
  }

  // ── 결제일시 — 영수증에서 주문건당 한 번만 읽는다 ──────────────────────────
  //
  // 이 값은 그 주문에서 다시 달라질 값이 아니라 재전송마다 다시 받는 건 낭비다 (무신사
  // 승인일시와 같은 결정). 버튼이 붙는 순간 미리 받아 두므로 클릭은 대개 기다리지 않는다
  // (지마켓 프리페치와 같은 결정 — 12KB GET 하나다).
  //
  // 인코딩: 이번 영수증은 UTF-8 로 왔지만 .tmall 계열에는 EUC-KR 이 섞여 있다 (영수증 문서
  // 안의 스크립트들부터 charset=euc-kr 이다). fetch().text() 는 헤더와 무관하게 무조건 UTF-8
  // 로 풀기 때문에, 바이트로 받아 UTF-8 로 풀어 보고 '주문일' 이 안 보이면 EUC-KR 로 다시 푼다.
  let pdCache = { no: '', v: '' };
  let asked = '';

  // 영수증 주소. /my11st/receipt/… 와 /receipt/… 둘 다 같은 영수증을 준다 (2026-09-03 사용자
  // 확인, 주소창으로 열어 봄). 늘 앞쪽부터 받고, 주문상세가 /order/… 로 열렸을 때만 실패 시
  // 같은 층(/receipt/…)을 한 번 더 시도한다 — 아직 그 폴백이 필요했던 적은 없다 (README '11번가').
  function receiptPaths() {
    const q = '?method=orderReceipt&ordNo=';
    const first = '/my11st/receipt/viewReceipt.tmall' + q;
    const here =
      location.pathname.replace(/\/order\/BuyManager\.tmall$/, '/receipt/viewReceipt.tmall') + q;
    return here !== location.pathname + q && here !== first ? [first, here] : [first];
  }

  async function fetchReceipt(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('영수증 응답 ' + r.status);
    const buf = await r.arrayBuffer();
    let html = new TextDecoder('utf-8').decode(buf);
    if (html.indexOf('주문일') === -1) html = new TextDecoder('euc-kr').decode(buf);
    const m = html.match(PAY_DATE);
    if (!m) throw new Error('영수증에서 주문일을 찾지 못했습니다.');
    return `${m[1]}.${p2(m[2])}.${p2(m[3])}` + (m[4] ? ' ' + m[4].padStart(8, '0') : '');
  }

  async function receiptDate(no) {
    if (pdCache.no === no && pdCache.v) return pdCache.v;
    let err;
    for (const base of receiptPaths()) {
      try {
        const v = await fetchReceipt(base + no + '&isSSL=Y');
        pdCache = { no, v };
        return v;
      } catch (e) {
        err = e;
      }
    }
    throw err;
  }

  function prefetch() {
    const no = orderNo();
    if (!no || asked === no) return;
    asked = no;
    receiptDate(no).catch(() => {}); // 실패해도 조용히 — 클릭할 때 다시 받는다
  }

  async function extract() {
    const no = orderNo();
    if (!no) return { error: '주문번호를 찾지 못했습니다.' };

    const total = totalAmount();
    if (!total) return { error: '총 결제금액을 찾지 못했습니다.' };

    const receiver = receiverName();
    if (!receiver) return { error: '받는 분(수령인)을 찾지 못했습니다.' };

    let payDate;
    try {
      payDate = await receiptDate(no); // 대개 미리 받아 둔 값이라 기다리지 않는다
    } catch (e) {
      return { error: '결제일시를 찾지 못했습니다 — ' + e.message };
    }

    return {
      // 지금 열린 경로(/my11st/order/… 또는 /order/…)에 ordNo 를 붙인다. 주문목록이 주는
      // /order/… 주소는 ordNo 를 달고 오므로, 그 경로라면 해당 주문으로 바로 열린다.
      url: location.origin + location.pathname + '?method=getOrderDetailInfo&ordNo=' + no,
      orderNo: no, // 20260901096939093
      price: total.replace(/,/g, ''), // 숫자만
      payDate, // 2026.09.01 08:03:55
      receiver,
      total, // "24,600" — 망고 행 매칭 보조키
      // marketTag 없음 — 지마켓·패션플러스·롯데아이몰·더현대Hi·CJ온스타일·NS몰·GS SHOP·옥션·
      // 현대몰과 같은 사정. 11번가 발주건이 망고 목록에 어떤 표기로 찍히는지 확인될 때까지
      // 넣지 않는다.
    };
  }

  function anchor() {
    const el = ttl();
    if (el) prefetch(); // 버튼 자리가 잡혔다 = 주문상세가 다 그려졌다. 영수증을 미리 받는다.
    return el;
  }

  window.__LM_SITE__.mount({ extract, anchor });
})();
