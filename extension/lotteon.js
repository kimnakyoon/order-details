// 롯데온 주문상세 페이지 -> 망고 전송용 값 추출
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
      marketTag: 'LOTTEON', // 망고 목록 행에 표시되는 발주처 태그
    };
  }

  window.__LM_SITE__.mount({
    extract,
    anchor: () => document.querySelector('.topInformation .orderNumber'),
  });
})();
