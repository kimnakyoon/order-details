// 포스티(Posty) 주문상세 페이지 -> 망고 전송용 값 추출
//
// 롯데온과 같은 자리에서-읽기 방식이다. 다만 마크업은 zero-runtime CSS(zds…) 라
// 클래스 이름이 빌드마다 해시로 바뀐다 — 그건 붙잡지 않는다. 대신
//  · 배송정보·결제내역은 .row_title(라벨) / .row_content(값) 짝으로 놓여 있고,
//  · 헤더의 결제일·주문번호는 leaf 요소에 텍스트로 박혀 있어,
// 그 자리들을 텍스트로 붙잡는다.
(() => {
  'use strict';

  // 헤더의 leaf 요소를 정규식으로 찾아 그 텍스트를 돌려준다. 앵커도 이걸로 요소를 집으니
  // 한 곳에 모아 둔다. document.body.innerText 를 피한다 — 그건 문서 전체 리플로우를
  // 강제한다. textContent 는 리플로우가 없다.
  function leaf(re) {
    for (const el of document.querySelectorAll('p, span')) {
      if (el.children.length === 0 && re.test(el.textContent)) return el;
    }
    return null;
  }

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
      ((leaf(/주문번호\s*\d+/) || {}).textContent?.match(/(\d+)/) || [])[1];
    if (!odNo) return { error: '주문번호를 찾지 못했습니다.' };

    // 결제일은 헤더에 '26.09.01 결제' 처럼 2자리 연도로 박혀 있다. 4자리로 펴 준다.
    const d = (leaf(/\d{2}\.\d{2}\.\d{2}\s*결제/) || {}).textContent?.match(/(\d{2})\.(\d{2})\.(\d{2})/) || [];
    const payDate = d.length ? `20${d[1]}.${d[2]}.${d[3]}` : '';

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
      // marketTag 없음 — 11번가·현대몰·NS몰·GS SHOP·SSF샵과 같은 사정. 태그를 실으면 망고
      // 스캔이 후보 행마다 발주처 칸을 읽고 태그 루프를 돌아 최악값이 두 배가 된다(현대몰 절
      // 참고). 포스티 발주건이 망고 목록에 어떤 표기로 찍히는지 확인될 때까지 넣지 않는다.
    };
  }

  // 버튼은 헤더의 '(주문번호 …)' 바로 옆에 붙인다.
  window.__LM_SITE__.mount({
    extract,
    anchor: () => leaf(/주문번호\s*\d+/),
  });
})();
