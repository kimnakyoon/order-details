// 롯데아이몰(롯데홈쇼핑) 주문상세 페이지 -> 망고 전송용 값 추출
//
// 롯데온과 같은 롯데 계열이지만 화면은 전혀 다르다. 값은 페이지 맨 아래 '결제/할인/적립'
// 오른쪽의 결제금액 블록(`.totalN`) 한 곳에 모여 있다.
//
//   <dl class="total">  결제금액  88,540원          <- 실제로 승인된 금액
//   <table class="table_Ninfo">
//     Npay            | 55,650원 | 2026.08.28 승인
//     L.PAY 간편결제  | 88,540원 | [2026.08.28] 하나카드(LOCAL) 승인 [할부형태 : 일시불]
//                                  카드청구 할인가 : 84,110원        <- p.paynoti_txt
//
// 구입금액은 **카드청구 할인가가 있으면 그쪽**을 쓴다. 카드사가 나중에 청구서에서 깎아주는
// 몫이라, 승인금액(88,540)이 아니라 실제로 빠져나가는 돈(84,110)이 신고금액이다.
// 롯데온에서 L.POINT 를, SSG 에서 SSG MONEY 를 빼는 규칙과 결이 같다.
//
// 결제일시도 같은 블록에서 읽는다. 날짜뿐이고 시각은 없다 (롯데온·SSG·패션플러스와 같다).
//
// ── 문서 전체를 훑는 질의를 만들지 않는다 ────────────────────────────────────
//
// 이 페이지에는 `table.table_Ninfo` 가 셋(배송지 정보 / 주문고객정보 / 결제상세 정보)이고
// 셋 다 클래스가 같다. 표를 고르는 기준은 **`<caption>`** 이다 — 클래스와 달리 안 겹친다.
//
// 그런데 caption 으로 찾는 방법이 두 가지고, 비용이 꽤 다르다 (2,427개 요소, 실측).
//
//   querySelectorAll('caption')      0.029ms — 캐시가 없다. 늘 트리를 다 훑는다.
//   getElementsByTagName('caption')  0.000ms — 라이브 컬렉션이라 브라우저가 캐시한다.
//                                    단 **DOM 이 한 번이라도 바뀌면 0.033ms 로 되돌아간다.**
//
// 이 페이지에는 초 단위로 도는 방송 카운트다운이 있어서 캐시는 대개 식어 있다. 그래서
// 라이브 컬렉션만 믿고 짜면 빠를 때와 느릴 때가 10배(0.013 / 0.121ms) 벌어진다 — 망고 쪽에서
// 강제 리플로우를 걷어낸 것과 같은 이유로 피한다. 평균이 아니라 **최악이 안 튀는 쪽**을 쓴다.
//
// 그래서 `querySelector('table.table_Ninfo')` 로 **첫 매치에서 끊고**(문서 순서상 배송지 표다)
// caption 으로 맞는지 확인만 한다. 어긋나면 그때만 전부 훑는다. 캐시 상태와 무관하게 0.026ms 다.
(() => {
  'use strict';

  // 정규식은 부를 때마다 다시 만들지 않는다.
  const CARD_PRICE = /카드청구\s*할인가\s*:\s*([\d,]+)\s*원/;
  const PAY_DATE = /(20\d\d)[.\-](\d{1,2})[.\-](\d{1,2})/;
  const SHOWN_NO = /20\d\d-\d{2}-\d{2}-[A-Z0-9]+/;

  const num = (s) => parseInt(String(s).replace(/[^\d]/g, ''), 10) || 0;
  const comma = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  // 화면 표기는 '2026-08-28-C20072', URL 의 ord_no 는 '20260828C20072' 다.
  // 망고에는 화면 표기를 넣는다 (SSG 와 같은 결정 — 사람이 보는 번호가 그쪽이다).
  const ordNo = () => (new URLSearchParams(location.search).get('ord_no') || '').trim();

  // 캡션으로 표 고르기 (윗주석 참고). 첫 매치가 맞으면 거기서 끝난다.
  function tableByCaption(word) {
    const first = document.querySelector('table.table_Ninfo');
    if (first && first.caption && first.caption.textContent.indexOf(word) !== -1) return first;
    const all = document.getElementsByClassName('table_Ninfo');
    for (let i = 0; i < all.length; i++) {
      const cap = all[i].caption;
      if (cap && cap.textContent.indexOf(word) !== -1) return all[i];
    }
    return null;
  }

  // 결제금액. 카드청구 할인가가 붙어 있으면 그 할인분만큼 깎는다.
  //
  // 결제수단이 하나면 결과는 곧 '카드청구 할인가' 그 값이다. 여러 수단으로 나눠 결제했는데
  // 그중 카드분에만 청구할인이 붙는 경우까지 맞도록, 총액에서 **할인분(승인액-청구액)** 을
  // 빼는 식으로 쓴다. (지금까지 본 주문은 전부 수단 하나짜리였다.)
  function price(box, table) {
    let total = num((box.querySelector('dl.total dd strong') || {}).textContent);
    if (!total || !table) return total;
    const rows = table.rows;
    for (let i = 0; i < rows.length; i++) {
      const noti = rows[i].querySelector('.paynoti_txt');
      const m = noti && noti.textContent.match(CARD_PRICE);
      if (!m) continue;
      const paid = num((rows[i].querySelector('td.price') || {}).textContent);
      const billed = num(m[1]);
      if (paid && billed) total -= paid - billed;
    }
    return total;
  }

  // '2026.08.28 승인' / '[2026.08.28] 하나카드(LOCAL) 승인' — 결제수단에 따라 표기가 다르다.
  // 표에는 금액 말고 날짜꼴 문자열이 없어서 그냥 첫 번째 것을 집는다.
  function payDate(table) {
    const m = (table ? table.textContent : '').match(PAY_DATE);
    if (!m) return '';
    const pad = (v) => (v.length < 2 ? '0' + v : v);
    return `${m[1]}.${pad(m[2])}.${pad(m[3])}`;
  }

  // 배송지의 '받으시는 분' 은 '[배란영] 배란영 / 010-2977-8032' 꼴이다.
  // 앞 대괄호는 배송지명(주소록 이름)이라 떼어내고, 전화번호 앞까지가 수령인이다.
  //
  // 같은 페이지의 '주문하시는 분'(계정 주인)과 섞이지 않도록 **배송지 표 안에서만** 찾는다.
  function receiver(table) {
    if (!table) return '';
    const rows = table.rows;
    for (let i = 0; i < rows.length; i++) {
      const th = rows[i].cells[0];
      if (!th || th.tagName !== 'TH' || th.textContent.indexOf('받으시는') === -1) continue;
      const td = rows[i].cells[1];
      if (!td) continue;
      const line = (td.querySelector('p') || td).textContent.replace(/\s+/g, ' ').trim();
      return line.replace(/^\[[^\]]*\]\s*/, '').split('/')[0].trim();
    }
    return '';
  }

  // 값을 못 찾았을 때 페이지가 실제로 뭘 담고 있었는지 오류에 같이 실어 보낸다.
  const dump = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim().slice(0, 240) : '(없음)');

  function extract() {
    const no = ordNo();
    if (!no) return { error: '주문상세 화면이 아닙니다 (ord_no 를 찾지 못했습니다).' };

    const box = document.querySelector('.totalN');
    if (!box) return { error: '결제금액 블록(.totalN)을 찾지 못했습니다.' };

    // 결제 표는 .totalN 안에 하나뿐이라 캡션을 볼 것 없이 바로 집는다.
    const payTable = box.querySelector('table.table_Ninfo');
    const addrTable = tableByCaption('배송지');

    const p = price(box, payTable);
    const pd = payDate(payTable);
    const who = receiver(addrTable);

    const probe = () => '\n[결제] ' + dump(box) + '\n[배송지] ' + dump(addrTable);
    if (!p) return { error: '결제금액을 찾지 못했습니다.' + probe() };
    if (!pd) return { error: '결제일시를 찾지 못했습니다.' + probe() };
    if (!who) return { error: '받으시는 분(수령인)을 찾지 못했습니다.' + probe() };

    const shown = shownEl();
    const m = shown && shown.textContent.match(SHOWN_NO);

    return {
      url: 'https://www.lotteimall.com/mypage/getOrderDtlInfo.lotte?ord_no=' + no,
      // 화면 표기가 없으면 URL 값을 그 꼴로 되돌린다.
      orderNo: m ? m[0] : no.replace(/^(\d{4})(\d{2})(\d{2})/, '$1-$2-$3-'),
      price: String(p), // 숫자만
      payDate: pd, // 2026.08.28
      receiver: who,
      total: comma(p), // "84,110" — 망고 행 매칭 보조키
      // marketTag 없음 — 지마켓과 같은 사정. 망고의 발주처 슬롯은 `[LOTTEON.com]`
      // `[SSG.com]` `[FashionPlus.co.kr]` 처럼 **도메인 꼴**로 찍히는데, 롯데아이몰 발주건이
      // 아직 목록에 없어 어떤 표기가 붙는지 확인하지 못했다. 맞지 않는 태그는 점수를 더하지
      // 못하면서 후보 행마다 비교 비용만 늘리므로(README 실측) 확인될 때까지 넣지 않는다.
    };
  }

  // 상단 '주문번호 : 2026-08-28-C20072 [인터넷]' 줄은 `anchor()` (버튼 자리) 와 `extract()`
  // (화면 표기 주문번호) 가 둘 다 쓴다. 한 번 찾아 나눠 쓴다 — 서버가 다 그려 주는 문서라
  // 바뀔 일이 없지만, 그래도 떨어져 나갔으면(`isConnected`) 다시 찾는다.
  //
  // 선택자는 그대로 둔다. GS SHOP 에서는 머리글 **안에서** 클래스로 집는 쪽이 빨랐지만, 여기는
  // `.txt` 가 흔한 클래스라 `.Nodview_di1` 안의 `.txt` 컬렉션을 도는 쪽(0.0052 ms)이 하위
  // 선택자 한 번(0.0030 ms)보다 느렸다 (2026-09-02 실측, README 성능 절). 이득은 두 번 찾던
  // 것을 한 번으로 줄이는 데서만 난다 — 추출 한 번이 0.0228 → 0.0196 ms.
  let shownCache = null;
  function shownEl() {
    if (shownCache && shownCache.isConnected) return shownCache;
    shownCache = document.querySelector('.Nodview_di1 p.txt');
    return shownCache;
  }

  // 상단 '주문번호 : 2026-08-28-C20072 [인터넷]' 의 [인터넷] 뒤에 버튼을 붙인다.
  // (p 자체에 붙이면 블록이라 줄이 바뀐다. 안쪽 span 뒤여야 같은 줄에 들어간다.)
  function anchor() {
    const p = shownEl();
    if (!p) return null;
    return p.querySelector('span') || p;
  }

  window.__LM_SITE__.mount({ extract, anchor });
})();
