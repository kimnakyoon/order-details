// SSF샵 주문상세 페이지 -> 망고 전송용 값 추출
(() => {
  'use strict';

  function extract() {
    const odNo =
      (document.querySelector('.title-area .order-num') || {}).textContent?.trim() ||
      (location.pathname.match(/\/mypage\/([A-Z\d]+)\/orderInfo/) || [])[1];
    if (!odNo) return { error: '주문번호를 찾지 못했습니다.' };

    // 주문결제 정보는 li.set-item 안에 제목(.item-title) = 값(.item-value) 짝으로 놓여 있다.
    let payDate = '';
    let total = '';
    for (const li of document.querySelectorAll('li.set-item')) {
      const t = (li.querySelector('.item-title') || {}).textContent?.trim() || '';
      const v = (li.querySelector('.item-value') || {}).textContent || '';
      if (t === '결제일시') {
        payDate = (v.match(/20\d\d\.\d\d\.\d\d(?:\s+\d\d:\d\d:\d\d)?/) || [])[0] || '';
      } else if (/총\s*결제금액/.test(t)) {
        total = (v.match(/([\d,]+)\s*원/) || [])[1] || '';
      }
    }
    const price = parseInt((total || '0').replace(/,/g, ''), 10);

    // 배송지 정보: dt '이름' 바로 다음 dd 가 수령인
    let receiver = '';
    for (const dt of document.querySelectorAll('dl.table-dl dt')) {
      if (dt.textContent.trim() === '이름') {
        receiver = (dt.nextElementSibling || {}).textContent?.trim() || '';
        break;
      }
    }

    if (!price) return { error: '결제금액을 찾지 못했습니다.' };
    if (!payDate) return { error: '결제일시를 찾지 못했습니다.' };
    if (!receiver) return { error: '받는 분(수령인)을 찾지 못했습니다.' };

    return {
      url: 'https://www.ssfshop.com/secured/mypage/' + odNo + '/orderInfo',
      orderNo: odNo,
      price: String(price), // 숫자만
      payDate, // 2026.08.30 21:31:22
      receiver,
      total, // "10,350" — 망고 행 매칭 보조키
      // marketTag 없음 — 지마켓·패션플러스·롯데아이몰·더현대Hi·CJ온스타일·NS몰·GS SHOP·옥션·
      // 현대몰·11번가와 같은 사정. SSF샵 발주건이 망고 목록에 어떤 표기로 찍히는지 확인될
      // 때까지 넣지 않는다.
    };
  }

  window.__LM_SITE__.mount({
    extract,
    anchor: () => document.querySelector('.title-area .order-num'),
  });
})();
