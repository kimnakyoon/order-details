// 29CM 주문상세 페이지 -> 망고 전송용 값 추출
//
// 롯데온과 같은 자리에서-읽기 방식이다. 다만 마크업이 emotion 해시 클래스(css-…)라
// 클래스는 붙잡지 않고 라벨 텍스트로 붙잡는다:
//  · 헤더의 '주문번호 ORD…' <p> — 주문번호이자 버튼 앵커
//  · 결제정보의 <strong>결제금액</strong><strong>85,330원</strong> 짝
//  · '결제일시 2026.09.01 16:27' leaf <span>
//  · 배송지정보 표의 <th>받는사람</th><td>오*순</td> 짝
//
// 무신사처럼 Next.js SPA 다 — 주문목록(/order/my-order/list)에서 상세로 문서를 다시
// 읽지 않고 넘어오므로 watch 모드로 붙는다. 목록에도 주문번호가 찍히지만, 앵커가
// URL 이 상세인지 먼저 보므로 목록 화면에는 버튼이 붙지 않는다.
(() => {
  'use strict';

  const DETAIL = /^\/order\/my-order\/detail\/(\d+)/;
  const pathId = () => (location.pathname.match(DETAIL) || [])[1] || '';

  // 정규식은 부를 때마다 다시 만들지 않는다.
  const RE_HEAD = /^주문번호\s*ORD/;
  const RE_ORD = /ORD[\d-]+/;
  const RE_DATE = /결제일시/;
  const RE_WHEN = /20\d\d\.\d{2}\.\d{2}(?:\s+\d{2}:\d{2}(?::\d{2})?)?/;
  const RE_WON = /([\d,]+)\s*원/;

  // root 아래의 leaf 요소들에서 '결제일시 2026.09.01 16:27' 를 찾아 일시만 돌려준다.
  function payDateIn(root, selector) {
    const els = root.querySelectorAll(selector);
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (!el.firstElementChild && RE_DATE.test(el.textContent)) {
        return (el.textContent.match(RE_WHEN) || [])[0] || '';
      }
    }
    return '';
  }

  // 헤더의 '주문번호 ORD20260901-7943450' <p>. watch 가 주기적으로 부르므로 찾은 요소를
  // 캐시한다 — 어느 주문에서 찾았는지(pathId)와 아직 살아 있는지(isConnected)로 확인한다
  // (무신사와 같은 절약).
  let cached = null;
  let cachedId = '';

  function anchor() {
    const id = pathId();
    if (!id) return null; // 주문상세가 아닌 화면 -> 버튼을 뗀다
    if (cached && cachedId === id && cached.isConnected) return cached;
    cached = null;
    cachedId = '';
    const ps = document.querySelectorAll('p');
    for (let i = 0; i < ps.length; i++) {
      if (RE_HEAD.test(ps[i].textContent.trim())) {
        cached = ps[i];
        cachedId = id;
        break;
      }
    }
    return cached;
  }

  function extract() {
    const id = pathId();
    if (!id) return { error: '주문상세 화면이 아닙니다.' };

    // 화면 표기(ORD20260901-7943450)를 주문번호로 쓴다. URL 의 숫자는 내부 id 라 링크에만 쓴다.
    const head = anchor();
    const odNo = ((head && head.textContent.match(RE_ORD)) || [])[0] || '';
    if (!odNo) return { error: '주문번호를 찾지 못했습니다.' };

    // 결제정보 블록은 <ol> 하나다 — 결제금액과 결제일시가 같은 블록에 있다:
    //   <ol>
    //     <li><strong>결제금액</strong><strong>85,330원</strong></li>
    //     <li><span>무신사페이(현대카드)</span><span>85,330원</span></li>
    //     <li><span>결제일시 2026.09.01 16:27</span></li>
    //   </ol>
    // 그래서 '결제금액' <strong> 을 찾은 뒤(문서에 strong 은 9개다) 그 <ol> 안의 span(3개)에서
    // 결제일시를 읽는다. 문서 전체의 span·p 82개를 훑던 것과 비교해 extract 가 0.088 → 0.020 ms
    // (같은 화면, 300회 × 9시행 중앙값, 2026-09-02 실측). <ol> 이 없거나 그 안에 결제일시가 없으면
    // 예전처럼 문서 전체를 훑어 동작은 유지한다.
    let total = '';
    let payDate = '';
    const ss = document.querySelectorAll('strong');
    for (let i = 0; i < ss.length; i++) {
      const s = ss[i];
      if (s.textContent.trim() === '결제금액') {
        total = (((s.nextElementSibling || {}).textContent || '').match(RE_WON) || [])[1] || ''; // "85,330"
        const box = s.closest('ol');
        if (box) payDate = payDateIn(box, 'span');
        break;
      }
    }
    const price = parseInt((total || '0').replace(/,/g, ''), 10);

    // '결제일시 2026.09.01 16:27' — 분 단위까지 그대로 싣는다 (무신사와 같은 표기 폭).
    if (!payDate) payDate = payDateIn(document, 'span, p');

    // 배송지정보 표의 <th>받는사람</th><td>오*순</td>. 문서에 th 는 9개다.
    let receiver = '';
    const ths = document.querySelectorAll('th');
    for (let i = 0; i < ths.length; i++) {
      if (ths[i].textContent.trim() === '받는사람') {
        receiver = ((ths[i].nextElementSibling || {}).textContent || '').trim(); // 오*순 (마스킹됨 — 망고 쪽에서 '*' 를 와일드카드로 매칭)
        break;
      }
    }

    if (!price) return { error: '결제금액을 찾지 못했습니다.' };
    if (!payDate) return { error: '결제일시를 찾지 못했습니다.' };
    if (!receiver) return { error: '받는사람(수령인)을 찾지 못했습니다.' };

    return {
      url: 'https://www.29cm.co.kr/order/my-order/detail/' + id,
      orderNo: odNo, // ORD20260901-7943450
      price: String(price), // 숫자만: "85330"
      payDate, // 2026.09.01 16:27
      receiver, // 오*순
      total, // "85,330"
      // marketTag 없음 — 포스티와 같은 사정. 29CM 발주건이 망고 목록에 어떤 표기로
      // 찍히는지 확인될 때까지 넣지 않는다 (태그를 실으면 스캔 최악값이 두 배가 된다).
    };
  }

  window.__LM_SITE__.mount({ extract, anchor, watch: true });
})();
