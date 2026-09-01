// 포스티(Posty) 주문상세 페이지 -> 망고 전송용 값 추출
//
// 롯데온과 같은 자리에서-읽기 방식이다. 다만 마크업은 zero-runtime CSS(zds…) 라
// 클래스 이름이 빌드마다 해시로 바뀐다 — 그건 붙잡지 않는다. 대신 배송정보·결제내역이
// 모두 .row_title(라벨) / .row_content(값) 짝으로 놓여 있어 그 구조를 붙잡는다.
(() => {
  'use strict';

  // 라벨(.row_title) 을 찾아 바로 옆 .row_content 값을 돌려준다.
  //   수령인       서*영
  //   총 결제 금액  31,840원
  function rowValue(label) {
    for (const t of document.querySelectorAll('.row_title')) {
      if (t.textContent.trim() === label) {
        return (t.nextElementSibling || {}).textContent?.trim() || '';
      }
    }
    return '';
  }

  function extract() {
    // 주문번호는 URL 경로에 있다. 헤더의 '(주문번호 …)' 표기는 보조.
    const odNo =
      (location.pathname.match(/\/orders\/(\d+)/) || [])[1] ||
      (document.body.innerText.match(/주문번호\s*(\d+)/) || [])[1];
    if (!odNo) return { error: '주문번호를 찾지 못했습니다.' };

    // 결제일은 헤더에 '26.09.01 결제' 처럼 2자리 연도로 박혀 있다. 4자리로 펴 준다.
    const rawDate = (document.body.innerText.match(/(\d{2})\.(\d{2})\.(\d{2})\s*결제/) || []);
    const payDate = rawDate.length ? `20${rawDate[1]}.${rawDate[2]}.${rawDate[3]}` : '';

    // 총 결제 금액 = 실결제금액. "31,840원"
    const totalText = rowValue('총 결제 금액');
    const total = (totalText.match(/([\d,]+)\s*원/) || [])[1] || ''; // 콤마 포함, 망고 행 매칭 보조키
    const price = parseInt((total || '0').replace(/,/g, ''), 10);

    const receiver = rowValue('수령인'); // 서*영 (마스킹됨 — 망고 쪽에서 '*' 를 와일드카드로 매칭)

    if (!price) return { error: '결제금액을 찾지 못했습니다.' };
    if (!payDate) return { error: '결제일시를 찾지 못했습니다.' };
    if (!receiver) return { error: '수령인을 찾지 못했습니다.' };

    return {
      url: 'https://posty.kr/checkout/orders/' + odNo,
      orderNo: odNo,
      price: String(price), // 숫자만: "31840"
      payDate, // 2026.09.01
      receiver, // 서*영
      total, // "31,840"
      marketTag: 'POSTY', // 망고 목록 행에 표시되는 발주처 태그
    };
  }

  // 버튼은 '수령인' 줄(배송 정보) 뒤에 붙인다 — 헤더의 해시 클래스보다 안정적이다.
  window.__LM_SITE__.mount({
    extract,
    anchor: () => {
      for (const t of document.querySelectorAll('.row_title')) {
        if (t.textContent.trim() === '수령인') return t.parentElement;
      }
      return null;
    },
  });
})();
