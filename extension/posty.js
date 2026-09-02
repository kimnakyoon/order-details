// 포스티(Posty) 주문상세 페이지 -> 망고 전송용 값 추출
//
// 롯데온과 같은 자리에서-읽기 방식이다. 다만 마크업은 zero-runtime CSS(zds…) 라
// 클래스 이름이 빌드마다 해시로 바뀐다 — 그건 붙잡지 않는다. 대신
//  · 배송정보·결제내역은 .row_title(라벨) / .row_content(값) 짝으로 놓여 있고,
//  · 헤더의 결제일·주문번호는 한 블록 안에 leaf <p> 둘로 나란히 박혀 있어
//        <p>26.09.01 결제</p><p>(주문번호 139738125577237818)</p>
//    그 자리들을 텍스트로 붙잡는다.
//
// Next.js 지만 SPA 추적(watch)은 필요 없다 — 주문·배송 목록(/checkout/orders)의 [주문상세] 는
// 상세를 **새 탭**으로 연다(is_close_on_back=true). 상세는 늘 새 문서로 시작한다.
(() => {
  'use strict';

  // 주문상세(/checkout/orders/<주문번호>)가 아니면 아무것도 하지 않는다 — 11번가와 같은 가드.
  // 목록(/checkout/orders)·취소/교환 화면에서도 스크립트가 도는 것을 봤는데, 거기서는 앵커를
  // 못 찾아 10초 동안 옵저버가 돌다 우측 하단에 눌러봐야 실패할 폴백 버튼이 뜬다. 여기서
  // 끝내면 mount 도 옵저버도 없다.
  const odNo = (location.pathname.match(/^\/checkout\/orders\/(\d+)\/?$/) || [])[1] || '';
  if (!odNo) return;

  // 정규식은 부를 때마다 다시 만들지 않는다.
  const RE_HEAD = /주문번호\s*\d+/;
  const RE_PAID = /(\d{2})\.(\d{2})\.(\d{2})\s*결제/; // 26.09.01 결제 (2자리 연도)
  const RE_WON = /([\d,]+)\s*원/;

  // 헤더의 '(주문번호 …)' leaf. 버튼 앵커이자 결제일을 찾는 출발점이다. 문서에 p·span 은 19개뿐이라
  // 한 번 훑는 건 0.005 ms 지만, 찾은 요소를 들고 있으면(isConnected) 그것도 0 이 된다.
  // document.body.innerText 는 피한다 — 그건 문서 전체 리플로우를 강제한다. textContent 는 없다.
  let cached = null;

  function anchor() {
    if (cached && cached.isConnected) return cached;
    cached = null;
    const els = document.querySelectorAll('p, span');
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (!el.firstElementChild && RE_HEAD.test(el.textContent)) {
        cached = el;
        break;
      }
    }
    return cached;
  }

  function extract() {
    // 결제일은 주문번호와 같은 헤더 블록의 형제 <p> 다. 앵커의 부모 자식들(3개)에서 먼저 찾고,
    // 거기 없으면 예전처럼 문서 전체의 leaf p·span 을 훑어 동작은 유지한다.
    const head = anchor();
    let m = null;
    if (head) {
      const kids = head.parentElement.children;
      for (let i = 0; i < kids.length && !m; i++) m = RE_PAID.exec(kids[i].textContent);
    }
    if (!m) {
      const els = document.querySelectorAll('p, span');
      for (let i = 0; i < els.length && !m; i++) {
        if (!els[i].firstElementChild) m = RE_PAID.exec(els[i].textContent);
      }
    }
    const payDate = m ? `20${m[1]}.${m[2]}.${m[3]}` : ''; // 4자리 연도로 펴 준다

    // 수령인·총 결제 금액은 .row_title(8개)을 **한 번만 훑어** 같이 집는다.
    //   수령인       서*영
    //   총 결제 금액  31,840원
    let total = '';
    let receiver = '';
    const ts = document.querySelectorAll('.row_title');
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      const s = t.textContent.trim();
      if (!receiver && s === '수령인') {
        receiver = ((t.nextElementSibling || {}).textContent || '').trim();
      } else if (!total && s === '총 결제 금액') {
        total = (((t.nextElementSibling || {}).textContent || '').match(RE_WON) || [])[1] || '';
      }
      if (total && receiver) break;
    }
    const price = parseInt((total || '0').replace(/,/g, ''), 10);

    if (!price) return { error: '결제금액을 찾지 못했습니다.' };
    if (!payDate) return { error: '결제일시를 찾지 못했습니다.' };
    if (!receiver) return { error: '수령인을 찾지 못했습니다.' };

    return {
      url: 'https://posty.kr/checkout/orders/' + odNo,
      orderNo: odNo,
      price: String(price), // 숫자만: "31840"
      payDate, // 2026.09.01
      receiver, // 서*영 (마스킹됨 — 망고 쪽에서 '*' 를 와일드카드로 매칭, 루프 밖 한 번 분기)
      total, // "31,840" — 망고 행 매칭 보조키
      // marketTag 없음 — 11번가·현대몰·NS몰·GS SHOP·SSF샵과 같은 사정. 태그를 실으면 망고
      // 스캔이 후보 행마다 발주처 칸을 읽고 태그 루프를 돌아 최악값이 두 배가 된다(현대몰 절
      // 참고). 포스티 발주건이 망고 목록에 어떤 표기로 찍히는지 확인될 때까지 넣지 않는다.
    };
  }

  // 버튼은 헤더의 '(주문번호 …)' 바로 옆에 붙인다.
  window.__LM_SITE__.mount({ extract, anchor });
})();
