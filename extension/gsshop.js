// GS SHOP(www.gsshop.com · with.gsshop.com) 상세주문내역 팝업 -> 망고 전송용 값 추출
//
// ── 같은 팝업이 두 호스트에서 열린다 ─────────────────────────────────────────
//
// `www.gsshop.com` 과 `with.gsshop.com` 이 **같은 주문번호에 같은 화면**을 내려준다 (2026-09-03
// 실측, 주문 3470660697 — 머리글·결제정보·배송지 구조가 동일하고 `www` 쪽이 `with` 로 넘어가지도
// 않는다). 어느 쪽 마이페이지에서 [상세주문내역] 을 눌렀느냐에 따라 호스트만 달라진다. 그래서
// 매니페스트가 두 호스트를 다 받고, 간단메모에 넣는 URL 은 **지금 열린 호스트**(`location.origin`)
// 로 만든다 — `www` 로 고정해 두면 `with` 에서 연 사람이 나중에 다른 호스트로 튀게 된다.
//
// 롯데온과 같은 부류다 — 서버가 값을 다 그려서 내려준다. 주소를 그대로 `fetch` 해 받은
// 41KB HTML 안에 주문번호·주문일·받으시는 분·결제금액이 **전부 문자열로 들어 있다** (실측).
// 그래서 XHR 을 기다릴 일도, SPA 처럼 라우트를 지켜볼 일도 없다. `watch` 없이 붙이고,
// `place()` 는 첫 호출에 성공한다 (요소 459개짜리 가벼운 팝업이다).
//
// ── 구입금액 = 결제금액 **아래** 줄들의 '원' 항목 합 (포인트 제외) ──────────
//
//   결제정보
//     결제금액        25,465원      <- 총액. 망고 행 매칭 보조키(`total`)로만 쓴다
//     네이버페이      25,417원      <- 실제로 빠져나간 돈
//     GS ALL 포인트       48P       <- 포인트. 더하지 않는다
//
// 총액 25,465 = 25,417 + 48P 다. 망고에 넣는 구입금액은 **포인트가 빠진 25,417** 이다.
// 롯데온에서 L.POINT 를, SSG 에서 SSG MONEY 를, CJ온스타일에서 `P` 항목을 빼는 것과 같은
// 규칙이고, 판별도 같은 자리에서 한다 — 금액 뒤에 붙은 단위가 `원` 인 줄만 더한다.
//
// 단위가 `원` 이어도 **적립금은 뺀다** (2026-09-03, 주문 3470660697):
//
//     결제금액        41,460원
//     네이버페이      37,110원      <- 실제로 빠져나간 돈 = 구입금액
//     이벤트적립금     4,350원      <- 단위는 원이지만 적립금이다. 더하지 않는다
//
// GS SHOP 은 포인트(`P`)와 적립금(`원`)을 따로 표기한다. 적립금은 돈이 아니므로 단위만 보고는
// 걸러지지 않아 **라벨**로 뺀다 — 이름에 `적립금`·`포인트` 가 들어간 줄은 건너뛴다.
//
// 첫 줄(`결제금액`)은 합에서 빼야 한다. 그 줄까지 더하면 총액을 두 번 세게 된다. 줄을
// 자리(첫 번째)나 클래스(`.title_option`)가 아니라 **라벨 이름**으로 골라내므로, 결제수단이
// 여럿이라 줄이 늘어나거나 순서가 바뀌어도 같은 값이 나온다.
//
// ── 결제정보 목록은 라벨로 찾는다 ────────────────────────────────────────────
//
// 화면 아래쪽에 `ul.order_dat_list` 가 둘 있다 — 왼쪽이 할인정보, 오른쪽이 결제정보다.
// 클래스가 같아서 `.half_right` 로 자리를 짚을 수도 있지만, 그건 '오른쪽에 있다'는 배치에
// 기대는 것이다. 대신 **첫 항목 이름이 `결제금액` 인 목록**을 고른다. 둘 중 하나를 고르는
// 일이라 비용은 그대로고(추출 한 번이 0.013~0.028ms, 300회×5시행 실측), 할인정보가 없는
// 주문건에서 목록이 하나만 남아도 그대로 맞는다.
//
// ── 주문번호·주문일은 머리글 한 줄에 같이 있다 ──────────────────────────────
//
//   주문일 : 2026.08.28 | 주문번호 : 3469850976     <- p.order_txt_area2 (문서에 하나뿐)
//
// 주문일에는 점이 있고 주문번호에는 없어서, 날짜 정규식 하나면 둘이 섞이지 않는다.
// 주문번호는 주소의 `ordNo` 와 같은 값이라 주소에서 읽고, 화면 쪽 값은 **버튼 자리를 고르는
// 데**만 쓴다 (그 번호가 찍힌 `span` 뒤에 붙인다).
//
// 시각은 어디에도 없다. 롯데온·SSG·패션플러스·롯데아이몰·CJ온스타일·NS몰과 같이 날짜만 넘긴다.
//
// 머리글 `p.order_txt_area2` 는 문서에 하나뿐인데 `anchor()` 와 `extract()` 가 둘 다 쓴다.
// 그래서 **한 번 찾아 둘이 나눠 쓰고**, 그 안의 번호 칸은 문서 전체를 훑는 하위 선택자
// (`.order_txt_area2 .order_txt_num`) 대신 그 요소 안에서 클래스로 집는다. 같은 요소를
// 돌려주면서 `anchor()` 가 절반이 됐다 (README 성능 절, 2026-09-02 실측). 캐시는 망고 쪽과
// 같은 장치로 낡음을 스스로 확인한다 — 떨어져 나갔으면(`isConnected`) 다시 찾는다.
//
// ── 주소에는 `ecOrdTypCd` 가 반드시 붙어야 한다 ─────────────────────────────
//
// `ordNo` 만 남기고 열면 901바이트짜리 '요청하신 페이지에 연결할 수 없습니다' 가 온다 (실측).
// 간단메모에 넣는 URL 은 나중에 사람이 눌러서 다시 여는 주소라, 지금 주소의 `ecOrdTypCd` 를
// 그대로 물려서 만든다 — 값을 지어내지 않고 있는 것만 옮긴다.
(() => {
  'use strict';

  // 정규식은 부를 때마다 다시 만들지 않는다.
  const PAY_DATE = /20\d\d\.\d{2}\.\d{2}/;
  const WON = /원$/;
  const NOT_MONEY = /적립금|포인트/; // 단위가 원이어도 돈이 아닌 줄 (윗주석 참고)

  const num = (s) => parseInt(String(s).replace(/[^\d]/g, ''), 10) || 0;
  const label = (el) => el.textContent.replace(/\s/g, '');

  // ── 주소는 한 번만 파싱한다 ───────────────────────────────────────────────
  //
  // `new URLSearchParams(location.search).get(...)` 한 번이 **0.0031 ms** 다 (5,000회 ×
  // 15시행 중앙값). 이 화면에서 제일 비싼 조각 하나로, `extract()` 가 이걸 두 번(주문번호 +
  // URL 조립) 부르고 `anchor()` 가 또 한 번 부르던 시절엔 **추출 시간의 40%** 가 주소
  // 파싱이었다 — 문서를 훑는 질의 셋을 다 합친 것(0.010 ms)과 맞먹는다.
  //
  // 팝업이라 주소가 바뀔 일이 없지만, 그래도 `location.search` 를 기억해 두고 그대로면 다시
  // 파싱하지 않는다 (더현대Hi·NS몰과 같은 방식). 문서 하나에 **한 번**만 파싱한다.
  let lastSearch = null;
  let noCache = '';
  let typCache = '';

  function readParams() {
    const s = location.search;
    if (s === lastSearch) return;
    lastSearch = s;
    const q = new URLSearchParams(s);
    noCache = (q.get('ordNo') || '').trim();
    typCache = (q.get('ecOrdTypCd') || '').trim();
  }

  function ordNo() {
    readParams();
    return noCache;
  }

  // 호스트는 지금 열린 쪽(`www` 또는 `with`)을 그대로 쓴다 (윗주석 참고).
  function pageUrl(no) {
    readParams();
    return (
      location.origin +
      '/ord/dlvcursta/popup/ordDtl.gs?ordNo=' +
      no +
      (typCache ? '&ecOrdTypCd=' + typCache : '')
    );
  }

  // 머리글은 문서당 한 번만 찾는다 (윗주석 참고).
  let headCache = null;
  function head() {
    if (headCache && headCache.isConnected) return headCache;
    headCache = document.querySelector('.order_txt_area2');
    return headCache;
  }

  // 첫 항목이 '결제금액' 인 목록 = 결제정보 (윗주석 참고).
  function payList() {
    const uls = document.querySelectorAll('.order_dat_list');
    for (let i = 0; i < uls.length; i++) {
      const dt = uls[i].querySelector('dt');
      if (dt && label(dt) === '결제금액') return uls[i];
    }
    return null;
  }

  // 결제금액 줄은 total 로, 그 아래 '원' 줄은 합쳐서 price 로 (윗주석 참고).
  function payment(ul) {
    let price = 0;
    let total = '';
    const lis = ul.children;
    for (let i = 0; i < lis.length; i++) {
      const dt = lis[i].querySelector('dt');
      const em = lis[i].querySelector('dd em');
      if (!dt || !em) continue;
      const v = em.textContent.trim();
      const name = label(dt);
      if (name === '결제금액') {
        total = (v.match(/[\d,]+/) || [''])[0]; // "25,465"
        continue;
      }
      if (NOT_MONEY.test(name)) continue; // 이벤트적립금(`4,350원`)은 여기서
      if (WON.test(v)) price += num(v); // 포인트(`48P`)는 여기서 걸러진다
    }
    return { price, total };
  }

  // 배송지가 여럿이면 '받으시는 분' 도 여럿이다. 망고는 수령인 한 명으로 행을 찾으므로
  // 첫 배송지의 받는사람을 쓴다 (CJ온스타일·NS몰과 같은 결정).
  // 칸 내용은 `김형식 / 010-2977-8032 /` 라 첫 `/` 앞이 이름이다.
  function receiver() {
    const dls = document.querySelectorAll('.orderer_info dl');
    for (let i = 0; i < dls.length; i++) {
      const dt = dls[i].querySelector('dt');
      if (dt && label(dt) === '받으시는분') {
        const dd = dls[i].querySelector('dd');
        return dd ? dd.textContent.split('/')[0].trim() : '';
      }
    }
    return '';
  }

  // 값을 못 찾았을 때 화면이 실제로 뭘 담고 있었는지 오류에 같이 실어 보낸다.
  const dump = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.textContent.replace(/\s+/g, ' ').trim().slice(0, 200) : '(없음)';
  };

  function extract() {
    const no = ordNo();
    if (!no) return { error: '주문상세 화면이 아닙니다 (주소에 ordNo 가 없습니다).' };

    const ul = payList();
    if (!ul) return { error: '결제정보를 찾지 못했습니다.\n[본문] ' + dump('.order_half') };
    const { price, total } = payment(ul);

    const hd = head();
    const pd = ((hd && hd.textContent) || '').match(PAY_DATE);
    const who = receiver();

    if (!price) {
      return { error: '결제금액(포인트 제외)을 찾지 못했습니다.\n[결제] ' + dump('.order_half') };
    }
    if (!pd) return { error: '주문일을 찾지 못했습니다.\n[머리글] ' + dump('.order_txt_area2') };
    if (!who) return { error: '받으시는 분(수령인)을 찾지 못했습니다.\n[배송] ' + dump('.orderer_info') };

    return {
      url: pageUrl(no),
      orderNo: no, // 3469850976 — 화면 표기와 주소가 같다
      price: String(price), // 숫자만, 포인트 제외
      payDate: pd[0], // 2026.08.28
      receiver: who,
      total, // "25,465" — 망고 행 매칭 보조키
      // marketTag 없음 — 지마켓·패션플러스·롯데아이몰·더현대Hi·CJ온스타일·NS몰과 같은 사정.
      // 망고의 발주처 슬롯은 `[LOTTEON.com]` `[SSG.com]` 처럼 도메인 꼴로 찍히는데 GS SHOP
      // 발주건이 아직 목록에 없어 어떤 표기가 붙는지 확인하지 못했다. 맞지 않는 태그는 점수를
      // 못 얻으면서 후보 행마다 비교 비용만 늘린다 (README 실측).
    };
  }

  // 머리글의 주문번호 뒤에 붙인다. 그 `span` 은 주소의 `ordNo` 와 같은 값이 찍힌 칸이라,
  // 날짜 칸(`2026.08.28`)과 헷갈리지 않게 **번호가 일치하는 칸**을 고른다.
  // (`p.order_txt_area2` 는 `right:0` 으로 붙어 있어, 버튼이 붙으면 왼쪽으로 늘어난다.)
  function anchor() {
    const no = ordNo();
    if (!no) return null;
    const hd = head();
    if (!hd) return null;
    const spans = hd.getElementsByClassName('order_txt_num');
    for (let i = 0; i < spans.length; i++) {
      if (spans[i].textContent.trim() === no) return spans[i];
    }
    return null;
  }

  window.__LM_SITE__.mount({ extract, anchor });
})();
