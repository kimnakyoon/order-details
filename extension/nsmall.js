// NS몰(m.nsmall.com) 주문상세 페이지 -> 망고 전송용 값 추출
//
// 값은 롯데온과 같은 자리에서 온다 — 화면 위쪽 파란 띠에 주문일자·주문번호, 그 아래 배송지에
// 받는사람, 맨 아래 '결제 정보' 에 금액. 다만 읽는 방식은 정반대다. 롯데온은 서버가 그려 준
// HTML 을 라벨 텍스트로 더듬지만, 여기는 값이 XHR 로 온 뒤에 그려지고 대신 **클래스 이름이
// 사람이 붙인 것**(`order-num`·`order-date`·`total-price`·`delivery-adress`)이라 그대로 쓴다.
// 넷 다 문서에 하나씩뿐이다 (요소 551개짜리 가벼운 화면이다).
//
// ── 화면은 XHR 응답이 온 뒤에 그려진다 ───────────────────────────────────────
//
// 서버가 내려주는 HTML 은 7KB 짜리 Vue 껍데기다 — 주문번호도 수령인도 금액도 들어 있지 않다.
// `mapi.nsmall.com/or/api/v1/order/order/order-detail` 응답이 온 뒤에 셋이 **한 번에** 그려진다.
//
//   DOMContentLoaded  156ms
//   load              194ms   <- content script 가 붙는 시점 (document_idle)
//   order-detail XHR  331ms   <- 이때 화면이 생긴다 (실측)
//
// 그래서 `place()` 는 첫 호출에 실패하고 `MutationObserver` 가 자리를 잡아준다 (CJ온스타일과
// 같다). 값과 버튼 자리가 같은 응답 하나로 함께 그려지므로 **버튼이 보이면 값도 이미 있다.**
//
// ── SPA — 그래서 사이트 전체에 건다 ─────────────────────────────────────────
//
// 주문목록(`/cs/order-check`)에서 [주문 상세보기]를 눌러도, 왼쪽 마이페이지 메뉴를 눌러도
// 문서를 다시 읽지 않는다 (Vue Router). `window` 에 표식을 남기고 오가 보면 그대로 살아 있다.
// 문서를 다시 읽지 않는다는 말은 **content script 도 다시 주입되지 않는다**는 말이라,
// 더현대Hi 와 같은 이유로 `m.nsmall.com` 전체에 건다 — `/cs/*` 에만 걸면 홈이나 상품에서
// 마이페이지로 들어오는 길에서 스크립트가 아예 없다. `www.nsmall.com` 도 여기로 넘어온다.
//
// 값싸다. 주문상세는 다 그려진 뒤 DOM 을 건드리지 않아 5초 동안 watch 틱이 **0번** 돌았고,
// 홈(요소 2,847)에서도 5초에 7번이다. 한 틱은 클래스 선택자 하나(0.0006ms, 캐시가 살아 있으면
// 0.0001ms)라 홈에서 5초를 굴려도 0.04ms 다 (실측).
//
// ── 지금 주소의 주문건이 맞는지 확인하고 읽는다 ─────────────────────────────
//
// SPA 에서 A 를 열어 둔 채 B 로 넘어가는 찰나에는 주소만 B 이고 화면은 아직 A 다. 그대로 읽으면
// A 의 수령인을 B 의 주문번호와 함께 보내게 된다 — 조용히 틀리는 쪽이라 제일 위험하다
// (더현대Hi 에서 실제로 걸렸던 함정이다). 그래서 `anchor()` 는 **화면의 주문번호가 주소의
// `orderNum` 과 같을 때만** 요소를 돌려준다. 다르면 `null` 이라 버튼이 떨어지고,
// `extract()` 도 같은 확인을 다시 한 뒤에야 값을 읽는다.
//
// ── 구입금액 = 최종 결제 금액 ────────────────────────────────────────────────
//
//   총 상품 금액    46,920원      <- .goods-price
//   총 할인 금액    -4,230원      <- .dc-price
//   총 배송비            0원      <- .delivery-price
//   최종 결제 금액  42,690원      <- .total-price          (망고 행 매칭 보조키도 이 값)
//   네이버페이-카드 42,690원      <- .payment-detail-info
//
// 최근 30건을 API 로 훑어보니 **전부 결제수단 하나짜리**(네이버페이-카드 10 · 페이코 14 ·
// 미결제 6)였고 `최종 결제 금액 == 결제수단 금액` 이 30건 모두 맞았다. 적립금·예치금·상품권
// (`totSaveUseAmt`·`dpstAmt`·`vchrAmt`)과 카드 청구할인(`totCardPstDcAmt`)은 30건 전부 0이다.
// 그래서 롯데온처럼 결제수단 줄을 골라 더할 이유가 없어 최종 결제 금액 한 곳에서 읽는다.
// 적립금을 섞어 쓴 주문이 나오면 그때 결제수단 줄 표기를 확인하고 빼는 규칙을 넣을 것
// (롯데온의 L.POINT, SSG 의 SSG MONEY 와 같은 자리다).
//
// ── 결제일시는 날짜뿐이다 ────────────────────────────────────────────────────
//
// 화면 위쪽의 `2026.08.31` 이 전부다. API 의 `orderDttm` 도 `20260831` 로 시각이 없다.
// 롯데온·SSG·패션플러스·롯데아이몰·CJ온스타일과 같이 날짜만 넘긴다.
(() => {
  'use strict';

  // 정규식은 부를 때마다 다시 만들지 않는다.
  const PAY_DATE = /20\d\d\.\d{2}\.\d{2}/;

  const num = (s) => parseInt(String(s).replace(/[^\d]/g, ''), 10) || 0;
  const comma = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  // 주소에서 주문번호를 얻는다. `watch` 가 150ms 마다 부르고, 사이트 전체에 걸려 있어
  // **주문상세가 아닌 화면에서도** 도는 함수다. 그래서 `location.search` 가 그대로면
  // `URLSearchParams` 를 새로 만들지 않고 지난 값을 돌려준다 (더현대Hi 와 같은 절약).
  //
  // 주문상세가 아닐 때 `lastSearch` 를 건드리지 않는 건 일부러다 — 목록에 나갔다가 같은
  // 주문건으로 되돌아오면 파싱 없이 캐시가 그대로 맞는다.
  const DETAIL = '/cs/order-detail';
  let lastSearch = null;
  let lastNo = '';

  function ordNo() {
    if (location.pathname !== DETAIL) return '';
    const q = location.search;
    if (q !== lastSearch) {
      lastSearch = q;
      lastNo = (new URLSearchParams(q).get('orderNum') || '').trim();
    }
    return lastNo;
  }

  // ── 주문번호가 찍힌 요소 ────────────────────────────────────────────────
  //
  // 버튼 자리이자 '화면이 지금 주소의 주문건을 그리고 있다' 는 증표다 (윗주석 참고).
  // watch 가 150ms 마다 부르므로 찾은 요소를 캐시한다 — 살아 있으면 문서를 훑지 않는다.
  //
  // **어느 주문에서 찾아 둔 자리인지를 기억한다.** 예전에는 틱마다 `textContent` 로 지금
  // 주문번호가 들어 있는지 확인했는데, 그건 다시 찾을 때를 정하는 데만 쓰였다. 찾을 때 한 번
  // 확인하고 그 주문번호를 적어 두면 판별은 똑같고 문자열은 만들지 않는다 (더현대Hi 와 같다).
  let cached = null;
  let cachedNo = '';

  function anchor() {
    const no = ordNo();
    if (!no) return null; // 주문상세가 아닌 화면 -> 버튼을 뗀다
    if (cached && cachedNo === no && cached.isConnected) return cached;

    cached = null;
    cachedNo = '';
    const dd = document.querySelector('.order-num dd');
    // 화면의 주문번호가 주소와 같을 때만 인정한다 (SPA 전환 찰나 방지 — 윗주석 참고).
    if (dd && dd.textContent.indexOf(no) !== -1) {
      cached = dd;
      cachedNo = no;
    }
    return cached;
  }

  // 값을 못 찾았을 때 화면이 실제로 뭘 담고 있었는지 오류에 같이 실어 보낸다.
  const dump = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.textContent.replace(/\s+/g, ' ').trim().slice(0, 200) : '(없음)';
  };

  function extract() {
    const no = ordNo();
    if (!no) return { error: '주문상세 화면이 아닙니다 (orderNum 을 찾지 못했습니다).' };
    // 화면이 아직 이전 주문건이면 여기서 멈춘다. 섞어 보내느니 안 보내는 게 낫다.
    if (!anchor()) {
      return { error: '화면의 주문번호가 주소(' + no + ')와 다릅니다. 잠시 뒤 다시 눌러주세요.' };
    }

    const p = num((document.querySelector('.total-price dd') || {}).textContent);
    const pd = ((document.querySelector('.order-date dd') || {}).textContent || '').match(PAY_DATE);
    // 배송지가 여럿이면 `.delivery-adress` 도 여럿이다. 망고는 수령인 한 명으로 행을 찾으므로
    // 첫 배송지의 받는사람을 쓴다 (CJ온스타일과 같은 결정). 클래스 철자는 사이트 것 그대로다.
    const who = ((document.querySelector('.delivery-adress .name') || {}).textContent || '').trim();

    const probe = () => '\n[주문] ' + dump('.order-info') + '\n[결제] ' + dump('.payment-info-wrap');
    if (!p) return { error: '최종 결제 금액을 찾지 못했습니다.' + probe() };
    if (!pd) return { error: '주문일자를 찾지 못했습니다.' + probe() };
    if (!who) return { error: '받는사람(수령인)을 찾지 못했습니다.\n[배송] ' + dump('.delivery-info') };

    return {
      url: 'https://m.nsmall.com/cs/order-detail?orderNum=' + no,
      orderNo: no, // 560831002077 — 화면 표기와 주소가 같다
      price: String(p), // 숫자만
      payDate: pd[0], // 2026.08.31
      receiver: who,
      total: comma(p), // "42,690" — 망고 행 매칭 보조키
      // marketTag 없음 — 지마켓·패션플러스·롯데아이몰·더현대Hi·CJ온스타일과 같은 사정.
      // 망고의 발주처 슬롯은 `[LOTTEON.com]` `[SSG.com]` 처럼 도메인 꼴로 찍히는데 NS몰
      // 발주건이 아직 목록에 없어 어떤 표기가 붙는지 확인하지 못했다. 맞지 않는 태그는 점수를
      // 못 얻으면서 후보 행마다 비교 비용만 늘린다 (README 실측).
    };
  }

  window.__LM_SITE__.mount({ extract, anchor, watch: true });
})();
