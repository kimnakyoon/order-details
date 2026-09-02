// W컨셉(W CONCEPT) 주문상세 페이지 -> 망고 전송용 값 추출
//
// 롯데온과 같은 고전적인 서버렌더 페이지다. 값이 전부 문서에 박혀 있으니 그 자리에서 읽는다.
(() => {
  'use strict';

  // 화면의 라벨(leaf 요소) 바로 다음 형제가 값이다.
  //   주문번호  <strong>주문번호</strong><em>Z13305657</em>
  //   주문일    <strong>주문일</strong><em>2026.08.28</em>
  //   결제금액  <span>결제금액</span><strong>8,605원</strong>
  //   받으시는 분 <th>받으시는 분</th><td class="pnl">최*영</td>
  //
  // 네 라벨을 span·strong·th(문서에 116개)를 **한 번만 훑어** 같이 집고, 넷 다 찾으면 멈춘다.
  // 라벨마다 따로 훑던 예전 방식은 0.399 ms, 한 번에 훑으면 0.096 ms 다 (요소 1,245개 화면,
  // 100~300회 × 7시행 중앙값, 2026-09-02 실측, 값 동일). 라벨들은 116개 중 73~91번째에 몰려 있어
  // 조기 종료가 뒤쪽 20여 개를 건너뛴다.
  const WANT = { 주문번호: 'orderNo', 결제금액: 'pay', 주문일: 'payDate', '받으시는 분': 'receiver' };

  function labels() {
    const out = {};
    let left = 4;
    const els = document.querySelectorAll('span, strong, th');
    for (let i = 0; i < els.length && left; i++) {
      const el = els[i];
      if (el.firstElementChild) continue;
      const k = WANT[el.textContent.trim()];
      if (!k || out[k] !== undefined) continue;
      const sib = el.nextElementSibling;
      if (!sib) continue;
      out[k] = sib.textContent.trim();
      left--;
    }
    return out;
  }

  function extract() {
    const L = labels();

    const orderNo = L.orderNo || new URLSearchParams(location.search).get('orderno');
    if (!orderNo) return { error: '주문번호를 찾지 못했습니다.' };

    // 결제금액 = 실결제금액 (총 상품금액 - 할인 + 배송비). "8,605원"
    const total = ((L.pay || '').match(/([\d,]+)/) || [])[1] || ''; // 콤마 포함, 망고 행 매칭 보조키
    const price = total.replace(/,/g, '');

    const payDate = L.payDate || ''; // 2026.08.28 (결제일시는 따로 없다)
    const receiver = L.receiver || ''; // 최*영 (마스킹됨)

    if (!price) return { error: '결제금액을 찾지 못했습니다.' };
    if (!payDate) return { error: '주문일을 찾지 못했습니다.' };
    if (!receiver) return { error: '받으시는 분(수령인)을 찾지 못했습니다.' };

    return {
      url: 'https://www.wconcept.co.kr/MyPage/MyOrderDetailView?orderno=' + orderNo,
      orderNo,
      price, // 숫자만: "8605"
      payDate, // 2026.08.28
      receiver, // 최*영
      total, // "8,605"
      marketTag: 'WCONCEPT', // 망고 목록 행에 표시되는 발주처 태그
    };
  }

  // 버튼은 주문번호/주문일 줄 뒤에 붙인다. 문서에 strong 은 10개다.
  window.__LM_SITE__.mount({
    extract,
    anchor: () => {
      const ss = document.querySelectorAll('strong');
      for (let i = 0; i < ss.length; i++) {
        if (ss[i].textContent.trim() === '주문번호') return ss[i].closest('ul') || ss[i].parentElement;
      }
      return null;
    },
  });
})();
