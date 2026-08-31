// CJ온스타일(base.cjonstyle.com) 주문상세 페이지 -> 망고 전송용 값 추출
//
// ── 화면은 XHR 응답이 온 뒤에 그려진다 ───────────────────────────────────────
//
// 서버가 내려주는 HTML 에는 핸들바 템플릿(`<script type="text/x-handlebars-template">`)만
// 들어 있고 값은 하나도 없다 — 문서를 그대로 받아 뒤져 보면 주문번호도 수령인도 금액도
// 나오지 않는다. `/c/rest/myzone/v2/orderInfo/<주문번호>` 응답이 온 뒤에야 주문번호·결제정보·
// 배송정보가 **한 번에** 그려진다.
//
//   DOMContentLoaded    150ms
//   load                296ms   <- content script 가 붙는 시점 (document_idle)
//   orderInfo XHR 종료  1681ms  <- 이때 화면이 생긴다 (실측)
//
// 그래서 `place()` 는 첫 호출에 반드시 실패하고 `MutationObserver` 가 자리를 잡아준다.
// 10초 폴백 타이머도 만들어지지만 그 전에(1.7초) 붙는다. 값과 버튼 자리가 같은 응답 하나로
// 함께 그려지므로 **버튼이 보이면 값도 이미 있다** — 눌렀는데 비어 있는 상태가 없다.
//
// SPA 는 아니다. 주문목록의 주문건 링크가 평범한 `<a href="…/orderInfo/…">` 라 문서를 다시
// 읽는다. `watch` 도 API 호출도 필요 없다.
//
// ── 결제일시가 어디에도 없다 -> 주문번호에서 얻는다 ──────────────────────────
//
// 화면에 결제일시가 없고, API 의 `paymentTuple.payDate` 도 null 이다 (최근 10건 전부).
// 그래서 **주문번호 앞 8자리**를 쓴다 — `20260830077359` -> `2026.08.30`. 주문목록에 찍힌
// 주문일자와 10건 전부 일치한다. SSG 에서 화면 날짜를 못 찾았을 때 쓰는 폴백과 같은 규칙이고,
// 롯데온·SSG·패션플러스·롯데아이몰처럼 시각 없이 날짜만 들어간다.
//
// ── 구입금액 = 결제정보의 '원' 항목 합 ───────────────────────────────────────
//
//   총 결제금액   41,700원      <- .total_payment          (망고 행 매칭 보조키)
//   결제정보
//     네이버페이  41,700원      <- .total_info_payment .result_report li
//
// 단위는 템플릿의 `paymentUnitName` 이 `span.won` 안에 그대로 찍힌다 — 클래스 이름이 `won`
// 이어도 내용은 포인트면 `P` 다. 그래서 **`원` 인 항목만** 더한다. 롯데온에서 L.POINT 를,
// SSG 에서 SSG MONEY 를 빼는 규칙과 결이 같다.
//
// 클래스 이름은 해시가 아니라 사람이 붙인 것(`order_id`·`total_payment`·`receiver`)이라
// 빌드마다 바뀌지 않는다. 무신사·더현대처럼 라벨 텍스트로 더듬어 찾을 이유가 없어 그대로 쓴다.
// 문서도 565개 요소짜리로 가볍다.
(() => {
  'use strict';

  // 정규식은 부를 때마다 다시 만들지 않는다.
  const ORD_PATH = /\/orderInfo\/(\d+)/;
  const SHOWN_NO = /20\d\d-\d{2}-\d{2}-\d+/;

  const num = (s) => parseInt(String(s).replace(/[^\d]/g, ''), 10) || 0;

  // URL 은 `20260830077359`, 화면 표기는 `2026-08-30-077359`.
  const ordNo = () => (location.pathname.match(ORD_PATH) || ['', ''])[1];
  const pageUrl = (no) => 'https://base.cjonstyle.com/p/myzone/orderInfo/' + no;

  // 결제정보의 '원' 항목만 더한다 (윗주석 참고).
  function price() {
    let sum = 0;
    const lis = document.querySelectorAll('.total_info_payment .result_report li');
    for (let i = 0; i < lis.length; i++) {
      const box = lis[i].querySelector('.item_price');
      if (!box) continue;
      const unit = box.querySelector('.won');
      if (unit && unit.textContent.trim() !== '원') continue;
      sum += num((box.querySelector('strong') || {}).textContent);
    }
    return sum;
  }

  // 주문번호 앞 8자리 = 주문일자 (윗주석 참고).
  function payDate(no) {
    const m = /^(20\d\d)(\d{2})(\d{2})/.exec(no);
    return m ? `${m[1]}.${m[2]}.${m[3]}` : '';
  }

  // 값을 못 찾았을 때 화면이 실제로 뭘 담고 있었는지 오류에 같이 실어 보낸다.
  const dump = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.textContent.replace(/\s+/g, ' ').trim().slice(0, 200) : '(없음)';
  };

  function extract() {
    const no = ordNo();
    if (!no) return { error: '주문상세 화면이 아닙니다 (주문번호를 찾지 못했습니다).' };

    const p = price();
    const pd = payDate(no);
    // 배송지가 여러 개면 `.receiver` 도 여러 개다. 망고는 수령인 한 명으로 행을 찾으므로
    // 첫 배송지의 받는사람을 쓴다.
    const who = (document.querySelector('.receiver') || {}).textContent?.trim() || '';
    const total = (document.querySelector('.total_payment dd strong') || {}).textContent?.trim() || '';

    const probe = () =>
      '\n[결제] ' + dump('.total_info_payment') + '\n[배송] ' + dump('.info_user_view');
    if (!p) return { error: '결제금액을 찾지 못했습니다.' + probe() };
    if (!pd) return { error: '주문번호에서 결제일시를 얻지 못했습니다 — ' + no };
    if (!who) return { error: '받는사람(수령인)을 찾지 못했습니다.' + probe() };

    const shown = (document.querySelector('.order_id') || {}).textContent || '';
    const m = shown.match(SHOWN_NO);

    return {
      url: pageUrl(no),
      // 화면 표기를 넣는다 (SSG·롯데아이몰과 같은 결정 — 사람이 보는 번호가 그쪽이다).
      // 화면에 없으면 URL 값을 그 꼴로 되돌린다.
      orderNo: m ? m[0] : no.replace(/^(\d{4})(\d{2})(\d{2})/, '$1-$2-$3-'),
      price: String(p), // 숫자만
      payDate: pd, // 2026.08.30
      receiver: who,
      total, // "41,700" — 망고 행 매칭 보조키
      // marketTag 없음 — 지마켓·패션플러스·롯데아이몰·더현대Hi 와 같은 사정. 망고의 발주처
      // 슬롯은 `[LOTTEON.com]` `[SSG.com]` 처럼 도메인 꼴로 찍히는데 CJ온스타일 발주건이 아직
      // 목록에 없어 어떤 표기가 붙는지 확인하지 못했다. 맞지 않는 태그는 점수를 못 얻으면서
      // 후보 행마다 비교 비용만 늘린다 (README 실측).
    };
  }

  // 상단 '주문번호 2026-08-30-077359' 의 번호 뒤에 붙인다.
  // (바깥 `div.order_id` 에 붙이면 블록이라 줄이 바뀐다.)
  function anchor() {
    const box = document.querySelector('.order_id');
    return box ? box.querySelector('span') : null;
  }

  window.__LM_SITE__.mount({ extract, anchor });
})();
