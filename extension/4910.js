// 4910 주문상세 페이지 -> 망고 전송용 값 추출
//
// 롯데온과 같은 자리에서-읽기 방식이다. 다만 마크업이 styled-components 해시 클래스(sc-…)라
// 클래스는 붙잡지 않고 라벨 텍스트로 붙잡는다:
//  · 헤더의 '주문번호 1788302565720' leaf <p> — 주문번호이자 버튼 앵커
//  · 그 아래 '결제 날짜 : 2026. 09. 02 · 오전 07:42' leaf <p>
//  · 결제 정보의 <p>총 1개 결제금액</p><p>29,870원</p> 짝
//  · 배송지 정보의 <p>받는분</p><p>김종오</p> 짝
//
// 무신사·29CM 처럼 Next.js SPA 다 — 주문내역(/order)에서 상세(/order/[sno])로 문서를 다시
// 읽지 않고 넘어오므로 watch 모드로 붙는다. 앵커가 URL 이 상세인지 먼저 보므로 목록·취소·
// 반품 같은 다른 /order 화면에는 버튼이 붙지 않는다.
//
// 그래서 더현대Hi 처럼 **사이트 전체**(4910.kr/*)에 건다. SPA 경계가 /order 가 아니라 사이트
// 전체라서, 홈 → 마이페이지 → 주문내역 → 상세로 들어오면 문서를 읽은 곳이 /order 가 아니라
// /order* 매칭으로는 스크립트가 아예 없다 — 새로고침해야 버튼이 나왔다. 실제로 그렇게 걸렸다.
// 값싸다 — 홈(요소 3,595)에서 5초 가만히 두고 스크롤해도 watch 틱이 0번이고, 홈 → 마이페이지 →
// 주문내역 → 상세까지 가는 동안 틱은 3번(변경 레코드 458개)이다. 상세가 아닌 화면에서는
// anchor() 가 경로만 보고 바로 null 을 준다.
(() => {
  'use strict';

  const DETAIL = /^\/order\/(\d+)\/?$/;
  const pathId = () => (location.pathname.match(DETAIL) || [])[1] || '';

  // 라벨 정규식에 맞는 leaf <p> 를 돌려준다. document.body.innerText 는 피한다 — 그건 문서
  // 전체 리플로우를 강제한다. textContent 는 리플로우가 없다.
  function leaf(re) {
    for (const p of document.querySelectorAll('p')) {
      if (p.children.length === 0 && re.test(p.textContent.trim())) return p;
    }
    return null;
  }

  // 라벨 leaf 바로 옆 형제의 텍스트 = 값.
  //   받는분          김종오
  //   총 1개 결제금액   29,870원
  function rowValue(re) {
    const t = leaf(re);
    return t ? ((t.nextElementSibling || {}).textContent || '').trim() : '';
  }

  // 헤더의 '주문번호 1788302565720' <p>. watch 가 주기적으로 부르므로 찾은 요소를 캐시한다 —
  // 어느 주문에서 찾았는지(pathId)와 아직 살아 있는지(isConnected)로 확인한다 (29CM 과 같은 절약).
  // 하단 법정 고지에도 '- 주문번호 :' 가 있지만 ^주문번호 로 걸러진다.
  let cached = null;
  let cachedId = '';

  function anchor() {
    const id = pathId();
    if (!id) return null; // 주문상세가 아닌 화면 -> 버튼을 뗀다
    if (cached && cachedId === id && cached.isConnected) return cached;
    cached = leaf(/^주문번호\s*\d+$/);
    cachedId = cached ? id : '';
    return cached;
  }

  function extract() {
    const id = pathId();
    if (!id) return { error: '주문상세 화면이 아닙니다.' };

    const head = anchor();
    const odNo = ((head && head.textContent.match(/\d+/)) || [])[0] || id;

    // '결제 날짜 : 2026. 09. 02 · 오전 07:42' — 날짜 사이 공백을 걷고 12시간제를 24시간제로 편다.
    const dp = leaf(/^결제\s*날짜/);
    const m = ((dp && dp.textContent) || '').match(
      /(20\d\d)\.\s*(\d\d)\.\s*(\d\d)(?:\s*·\s*(오전|오후)\s*(\d{1,2}):(\d\d))?/
    );
    let payDate = '';
    if (m) {
      payDate = `${m[1]}.${m[2]}.${m[3]}`;
      if (m[4]) {
        let h = parseInt(m[5], 10) % 12;
        if (m[4] === '오후') h += 12;
        payDate += ` ${String(h).padStart(2, '0')}:${m[6]}`;
      }
    }

    // '총 N개 결제금액' 옆 값 = 실결제금액. "29,870원"
    const total = (rowValue(/^총(\s*\d+개)?\s*결제금액$/).match(/([\d,]+)\s*원/) || [])[1] || '';
    const price = parseInt((total || '0').replace(/,/g, ''), 10);

    const receiver = rowValue(/^받는분$/); // 김종오 (마스킹 없음)

    if (!price) return { error: '결제금액을 찾지 못했습니다.' };
    if (!payDate) return { error: '결제일시를 찾지 못했습니다.' };
    if (!receiver) return { error: '받는분(수령인)을 찾지 못했습니다.' };

    return {
      url: 'https://4910.kr/order/' + id,
      orderNo: odNo, // 1788302565720
      price: String(price), // 숫자만: "29870"
      payDate, // 2026.09.02 07:42
      receiver, // 김종오
      total, // "29,870" — 망고 행 매칭 보조키
      // marketTag 없음 — 포스티·29CM 과 같은 사정. 4910 발주건이 망고 목록에 어떤 표기로
      // 찍히는지 확인될 때까지 넣지 않는다 (태그를 실으면 스캔 최악값이 두 배가 된다).
    };
  }

  window.__LM_SITE__.mount({ extract, anchor, watch: true });
})();
