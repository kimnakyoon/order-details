// 현대몰(www.hmall.com) 상세 주문 내역 팝업 -> 망고 전송용 값 추출
//
// ── 값은 문서와 함께 오지만, 마크업은 하나도 오지 않는다 ─────────────────────
//
// 서버가 내려주는 HTML(32KB)에는 `배송지`·`결제정보` 같은 글자도, `shipping-head` 같은
// 클래스도 없다. 대신 Next.js 의 `__NEXT_DATA__` 안에 주문 데이터가 통째로 들어 있고
// (`rcvCustNm`·`stlmDtlVOList`…), 화면은 그걸로 하이드레이션할 때 그려진다. 그래서
// **주소를 fetch 해서 문자열을 뒤지는 방법은 통하지 않는다** — GS SHOP 과 반대쪽 극단이다.
//
// 값을 XHR 로 따로 받아오지도 않는다 (주문 데이터를 가져오는 요청이 하나도 없다 — 실측).
// 문서 하나로 끝나므로 CJ온스타일처럼 1.7초를 기다릴 일이 없고, `watch` 도 필요 없다.
//
// ── 그런데도 `__NEXT_DATA__` 가 아니라 화면을 읽는다 ─────────────────────────
//
// 이 페이지는 `gssp: true` — 서버에서 props 를 만들어 내려주는 페이지다. 그런 페이지로
// **클라이언트 이동**하면 Next.js 는 `/_next/data/<buildId>/…json?ordNo=…` 만 받아 화면을
// 갈아끼우고, 문서에 박힌 `__NEXT_DATA__` 스크립트는 **처음 읽은 문서 것 그대로 남는다.**
// 더현대Hi 에서 A 의 수령인을 B 의 주문번호와 함께 보낼 뻔했던 함정이 여기도 그대로 있다.
//
// 화면에는 그 함정이 없다 — 사람이 보고 있는 값이 곧 지금 주문의 값이다. 마스킹도 없어서
// (`공은하` 가 그대로 찍힌다) 더현대Hi 처럼 페이로드를 파고들 이유도 없다. 그래서 DOM 을 읽는다.
//
// ── 구입금액 = 결제/취소내역의 '원' 항목 합 (포인트 제외) ────────────────────
//
//   결제정보                       결제/취소내역
//     주문금액       18,900원        [결제] 2026. 08. 25
//     할인금액   (-)  3,250원          H.Point         270P    <- 포인트. 더하지 않는다
//     쿠폰할인        1,890원          네이버페이   15,380원    <- 실제로 빠져나간 돈
//     네이버가격비교  1,360원
//     결제금액       15,650원   <- 총액. 망고 행 매칭 보조키(`total`)로만 쓴다
//
// 총액 15,650 = 15,380 + 270P 다. 망고에 넣는 구입금액은 **포인트가 빠진 15,380** 이고,
// 판별은 다른 마켓과 같은 자리에서 한다 — 금액 뒤에 붙은 단위가 `원` 인 줄만 더한다
// (롯데온의 L.POINT, SSG 의 SSG MONEY, GS SHOP 의 GS ALL 포인트와 같은 규칙이다).
// 신용카드로 결제한 주문이면 그 줄이 `신용카드 15,380원` 으로 찍혀 그대로 잡히고,
// 네이버페이·상품권처럼 카드가 아닌 실결제 수단도 같은 자리에서 같은 꼴로 잡힌다.
//
// 왼쪽 `결제금액` 을 쓰지 않는 이유는 포인트가 섞여 있기 때문이다. 그건 `total` 로만 보낸다.
//
// `[결제]` 와 `[취소]` 는 **묶음 머리글**이다. 한 묶음에 수단이 여럿이면 두 번째 줄부터는
// 머리글이 빈 `<p></p>` 로 붙으므로, 머리글을 만날 때 부호를 정해 두고 그 뒤 줄들에 그대로
// 적용한다. 취소분은 빼는 쪽이라 전액 취소된 주문은 합이 0이 되어 오류로 잡힌다 — 취소건은
// 어차피 망고에 보낼 게 아니라 그대로 둔다 (더현대Hi 와 같은 결정).
//
// ── 결제일 ───────────────────────────────────────────────────────────────────
//
// `[결제] 2026. 08. 25` 의 날짜를 쓴다. 점 뒤에 공백이 있어 다른 마켓과 같은 정규식으로는
// 안 잡히므로 공백을 허용해 읽고 `2026.08.25` 꼴로 맞춘다. 취소 묶음의 날짜는 쓰지 않는다.
// 머리글(`p.date`)에도 같은 날짜가 있어 폴백으로 둔다. 시각은 어디에도 없다 — 롯데온·SSG·
// 패션플러스·롯데아이몰·CJ온스타일·NS몰·GS SHOP·옥션과 같이 날짜만 넘긴다.
//
// ── 클래스 이름은 사람이 붙인 것이다 ─────────────────────────────────────────
//
// `shipping-head`·`destination`·`payment-info` 처럼 뜻이 있는 이름이라(더현대Hi 의 CSS 모듈
// 해시와 다르다) 그대로 쓴다. 다만 `article payment-info` 가 **둘** 있다 (결제정보 ·
// 결제/취소내역). 자리(첫 번째/두 번째)로 고르지 않고 `h3` 글자로 가려낸다 — 할인이 없는
// 주문에서 블록이 하나만 남아도 같은 값이 나온다 (GS SHOP 에서 목록 둘을 가려낸 것과 같다).
// 문서도 요소 601개짜리로 가볍다.
(() => {
  'use strict';

  // 정규식은 부를 때마다 다시 만들지 않는다.
  const PAY_DATE = /(20\d\d)\.\s*(\d{2})\.\s*(\d{2})/;
  const WON = /원$/;

  const num = (s) => parseInt(String(s).replace(/[^\d]/g, ''), 10) || 0;
  const key = (el) => el.textContent.replace(/\s/g, '');

  // ── 주소는 문서 하나에 한 번만 파싱한다 (GS SHOP 과 같은 방식) ────────────
  let lastSearch = null;
  let noCache = '';

  function ordNo() {
    const s = location.search;
    if (s !== lastSearch) {
      lastSearch = s;
      noCache = (new URLSearchParams(s).get('ordNo') || '').trim();
    }
    return noCache;
  }

  const pageUrl = (no) => 'https://www.hmall.com/mo/mpa/selectOrdPTCPup?ordNo=' + no;

  // `article payment-info` 두 개를 h3 글자로 가려낸다 (윗주석 참고).
  function sections() {
    const out = { info: null, hist: null };
    const arts = document.getElementsByClassName('payment-info');
    for (let i = 0; i < arts.length; i++) {
      const h = arts[i].querySelector('h3');
      if (!h) continue;
      const k = key(h);
      if (!out.info && k === '결제정보') out.info = arts[i];
      else if (!out.hist && k === '결제/취소내역') out.hist = arts[i];
    }
    return out;
  }

  // 결제정보의 '결제금액' = 총액. 망고 행 매칭 보조키로만 쓴다.
  function total(info) {
    if (!info) return '';
    const dls = info.getElementsByTagName('dl');
    for (let i = 0; i < dls.length; i++) {
      const dt = dls[i].querySelector('dt');
      const dd = dls[i].querySelector('dd');
      if (dt && dd && key(dt) === '결제금액') return (dd.textContent.match(/[\d,]+/) || [''])[0];
    }
    return '';
  }

  // 결제/취소내역의 '원' 줄 합 + 첫 '[결제]' 날짜 (윗주석 참고).
  function payment(hist) {
    const r = { price: 0, payDate: '' };
    if (!hist) return r;
    const wraps = hist.getElementsByClassName('dlwrap');
    let sign = 1;
    for (let i = 0; i < wraps.length; i++) {
      const p = wraps[i].querySelector('p');
      const head = p ? p.textContent : '';
      // 묶음 머리글을 만나면 부호를 다시 정한다. 빈 머리글은 앞 묶음에 딸린 줄이다.
      if (head.indexOf('[') !== -1) {
        sign = /취소|환불/.test(head) ? -1 : 1;
        if (sign === 1 && !r.payDate) {
          const m = head.match(PAY_DATE);
          if (m) r.payDate = m[1] + '.' + m[2] + '.' + m[3];
        }
      }
      const dls = wraps[i].getElementsByTagName('dl');
      for (let j = 0; j < dls.length; j++) {
        const dd = dls[j].querySelector('dd');
        if (!dd) continue;
        const v = dd.textContent.trim();
        if (WON.test(v)) r.price += sign * num(v); // 포인트(`270P`)는 여기서 걸러진다
      }
    }
    return r;
  }

  // 배송지가 여럿이면 받는 분도 여럿이다. 망고는 수령인 한 명으로 행을 찾으므로 첫
  // 배송지의 받는 분을 쓴다 (CJ온스타일·NS몰·GS SHOP 과 같은 결정).
  function receiver() {
    const h = document.querySelector('.destination .group h4');
    return h ? h.textContent.trim() : '';
  }

  // 값을 못 찾았을 때 화면이 실제로 뭘 담고 있었는지 오류에 같이 실어 보낸다.
  const dump = (el) =>
    el ? el.textContent.replace(/\s+/g, ' ').trim().slice(0, 200) : '(없음)';

  function extract() {
    const no = ordNo();
    if (!no) return { error: '주문상세 화면이 아닙니다 (주소에 ordNo 가 없습니다).' };

    const s = sections();
    const { price, payDate } = payment(s.hist);
    const who = receiver();

    // 결제내역에 날짜가 없으면 머리글의 주문일(`2026.08.25`)로 대신한다.
    let day = payDate;
    if (!day) {
      const d = document.querySelector('.shipping-head p.date');
      const m = d ? d.textContent.match(PAY_DATE) : null;
      if (m) day = m[1] + '.' + m[2] + '.' + m[3];
    }

    const probe = () =>
      '\n[결제내역] ' + dump(s.hist) + '\n[배송지] ' + dump(document.querySelector('.destination'));
    if (!price) return { error: '결제금액(포인트 제외)을 찾지 못했습니다.' + probe() };
    if (!day) return { error: '결제일을 찾지 못했습니다.' + probe() };
    if (!who) return { error: '배송지 받는 분(수령인)을 찾지 못했습니다.' + probe() };

    return {
      url: pageUrl(no),
      orderNo: no, // 20260825023493 — 화면 표기와 주소가 같다
      price: String(price), // 숫자만, 포인트 제외
      payDate: day, // 2026.08.25
      receiver: who,
      total: total(s.info), // "15,650" — 망고 행 매칭 보조키
      // marketTag 없음 — 지마켓·패션플러스·롯데아이몰·더현대Hi·CJ온스타일·NS몰·GS SHOP·옥션과
      // 같은 사정. 망고의 발주처 슬롯은 `[LOTTEON.com]` `[SSG.com]` 처럼 도메인 꼴로 찍히는데
      // 현대몰 발주건이 아직 목록에 없어 어떤 표기가 붙는지 확인하지 못했다. 맞지 않는 태그는
      // 점수를 못 얻으면서 후보 행마다 비교 비용만 늘린다 (README 실측).
    };
  }

  // ── 버튼 자리 = 머리글 '주문번호 20260825023493' 뒤 ────────────────────────
  //
  // 결제/취소내역이 그려졌을 때만 자리를 준다. 머리글과 결제내역은 하이드레이션 한 번에
  // 함께 그려지므로 이 조건이 늦추는 것은 없고, 대신 **버튼이 보이면 값도 있다**는 성질이
  // 생긴다 (CJ온스타일과 같은 성질을 여기서는 조건으로 만든다).
  function anchor() {
    if (!ordNo()) return null;
    const p = document.querySelector('.shipping-head .number p');
    return p && sections().hist ? p : null;
  }

  window.__LM_SITE__.mount({ extract, anchor });
})();
