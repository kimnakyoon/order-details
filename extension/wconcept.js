// W컨셉(W CONCEPT) 주문상세 페이지 -> 망고 전송용 값 추출
//
// 롯데온과 같은 고전적인 서버렌더 페이지다. 값이 전부 문서에 박혀 있으니 그 자리에서 읽는다.
(() => {
  'use strict';

  // 화면의 라벨(leaf 요소)을 찾아 바로 다음 형제의 텍스트를 돌려준다.
  //   주문번호  <strong>주문번호</strong><em>Z13305657</em>
  //   주문일    <strong>주문일</strong><em>2026.08.28</em>
  //   결제금액  <span>결제금액</span><strong>8,605원</strong>
  //   받으시는 분 <th>받으시는 분</th><td class="pnl">최*영</td>
  function labelValue(label) {
    for (const el of document.querySelectorAll('span, strong, th')) {
      if (el.children.length === 0 && el.textContent.trim() === label) {
        const sib = el.nextElementSibling;
        if (sib) return sib.textContent.trim();
      }
    }
    return '';
  }

  function extract() {
    const orderNo =
      labelValue('주문번호') || new URLSearchParams(location.search).get('orderno');
    if (!orderNo) return { error: '주문번호를 찾지 못했습니다.' };

    // 결제금액 = 실결제금액 (총 상품금액 - 할인 + 배송비). "8,605원"
    const payText = labelValue('결제금액');
    const price = (payText.match(/([\d,]+)/) || [])[1]?.replace(/,/g, '') || '';
    const total = (payText.match(/([\d,]+)/) || [])[1] || ''; // 콤마 포함, 망고 행 매칭 보조키

    const payDate = labelValue('주문일'); // 2026.08.28 (결제일시는 따로 없다)
    const receiver = labelValue('받으시는 분'); // 최*영 (마스킹됨)

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

  // 버튼은 주문번호/주문일 줄 뒤에 붙인다.
  window.__LM_SITE__.mount({
    extract,
    anchor: () => {
      for (const s of document.querySelectorAll('strong')) {
        if (s.textContent.trim() === '주문번호') return s.closest('ul') || s.parentElement;
      }
      return null;
    },
  });
})();
