// 롯데온 주문상세 페이지 -> 망고 전송용 값 추출
//
// 화면은 Vue 가 그리지만 클래스 이름은 사람이 붙인 것이라(.topInformation .orderNumber,
// .paymentInformation, .amountInformation, li > .title/.text) 그대로 붙잡는다.
//
// innerText 는 쓰지 않는다 — 그건 문서 전체 레이아웃을 강제한 뒤 보이는 텍스트를 다시 이어붙인다.
// 예전에는 결제정보 블록·총 결제금액 줄·**본문 전체**를 innerText 로 읽어 extract 가 0.255 ms 였다.
// 같은 값을 textContent 와 라벨 요소로 읽으면 0.021 ms 다 (요소 926개 화면, 20~200회 × 7시행
// 중앙값, 2026-09-02 실측, 값 동일). 클릭할 때만 도는 코드지만, 문서 전체를 이어붙일 이유가 없다.
(() => {
  'use strict';

  // 정규식은 부를 때마다 다시 만들지 않는다.
  const RE_WON_G = /([\d,]+)\s*원/g;
  const RE_WON = /([\d,]+)\s*원/;
  const RE_DATE = /20\d\d\.\d{2}\.\d{2}/;
  const RE_TOTAL = /총\s*결제금액/;
  const RE_RCV = /^받는\s*분$/;

  function extract() {
    const odNo =
      (document.querySelector('.topInformation .orderNumber') || {}).textContent?.trim() ||
      new URLSearchParams(location.search).get('odNo');
    if (!odNo) return { error: '주문번호를 찾지 못했습니다.' };

    // 결제정보 블록. 클래스가 없어졌을 때만 제목(h4 '결제정보')에서 올라간다.
    //   <div class="paymentInformation">
    //     <h4 class="title">결제정보</h4>
    //     <dl><dt>롯데카드(일시불) <span>결제완료</span></dt><dd><strong>89,100</strong>원</dd></dl>
    //     <div class="date"><span>2026.09.02</span> …
    let payBox = document.querySelector('.paymentInformation');
    if (!payBox) {
      const hs = document.querySelectorAll('h4, h3, strong, span');
      for (let i = 0; i < hs.length; i++) {
        if (hs[i].textContent.trim() === '결제정보') {
          payBox = hs[i].parentElement.parentElement;
          break;
        }
      }
    }
    const payText = payBox ? payBox.textContent : '';

    // 'P'(L.POINT) 가 아닌 '원' 단위 금액 = 실결제금액. 복수 결제수단이면 합산.
    let price = 0;
    let m;
    RE_WON_G.lastIndex = 0;
    while ((m = RE_WON_G.exec(payText))) price += parseInt(m[1].replace(/,/g, ''), 10);
    const payDate = (payText.match(RE_DATE) || [])[0] || '';

    // 총 결제금액 (망고 행 매칭 보조키로만 사용)
    let total = '';
    const dts = document.querySelectorAll('.amountInformation dt');
    for (let i = 0; i < dts.length; i++) {
      if (RE_TOTAL.test(dts[i].textContent)) {
        total = (dts[i].parentElement.textContent.match(RE_WON) || [])[1] || '';
        break;
      }
    }

    // 배송지: <li><div class="title">받는 분</div><div class="text">남궁숙</div></li>
    // .title 은 문서에 14개다. 라벨 leaf 를 찾아 바로 옆 형제를 읽는다.
    let receiver = '';
    const ts = document.querySelectorAll('.title');
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      if (!t.firstElementChild && RE_RCV.test(t.textContent.trim())) {
        receiver = ((t.nextElementSibling || {}).textContent || '').trim();
        break;
      }
    }

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
