// 옥션(AUCTION) 주문상세정보 레이어 -> 망고 전송용 값 추출
//
// ── 이 화면은 목록 위에 뜨는 **iframe 한 장**이다 ────────────────────────────
//
// 주문내역조회(`escrow.auction.co.kr/Close/OrderProcessList.aspx`)의 [주문상세보기] 는
// `InProcessAction.PopupOrderDetail(주문번호)` 를 부르고, 그게 목록 위에 900×800 레이어를
// 띄워 그 안의 `iframe#ifContentsid` 에 아래 주소를 넣는다.
//
//   https://escrow.auction.co.kr/Close/OrderProcessDetailLayer.aspx?order_no=<주문번호>
//
// 그래서 content script 를 `all_frames: true` 로 건다 (manifest). 붙는 곳은 이 레이어 문서
// 하나뿐이라 목록 화면 자체에는 아무것도 주입되지 않는다 — 목록은 주문 75건을 다 펼치면
// 요소가 수천 개인 무거운 화면이고, 우리가 읽을 값은 거기 한 줄도 없다.
//
// 레이어를 닫았다 다른 주문건으로 다시 열면 iframe 이 **문서를 새로 읽는다.** content script
// 도 그때 다시 주입되므로 무신사·NS몰처럼 라우트를 지켜볼(`watch`) 이유가 없다. 서버가 값을
// 다 그려서 내려주는 롯데온·GS SHOP 부류라 `place()` 도 첫 호출에 성공한다.
//
// 주소를 직접 열어도(주소창에 붙여넣기) 같은 문서라 그대로 동작한다. 간단메모에 넣는 URL 이
// 바로 그 주소다.
//
// ── 구입금액 = 결제정보의 '신용카드' 줄 ─────────────────────────────────────
//
//   결제정보
//     최종 결제금액    31,650원      <- 망고 행 매칭 보조키(`total`)로만 쓴다
//     신용카드         31,650원      <- 구입금액. tr.sub = 결제수단 내역
//       현대카드/일시불(무이자)
//     상품금액         38,500원      <- 여기서부터는 내역이라 더하지 않는다
//     쿠폰할인금액     -3,000원
//     즉시할인금액     -3,850원
//
// 결제수단 줄만 `tr.sub` 로 따로 표시돼 있어서, 그중 이름에 `카드` 가 든 줄을 더한다.
// 스마일캐시·스마일페이가 섞이면 그만큼 빠진다 — 롯데온에서 L.POINT 를, SSG 에서 SSG MONEY 를,
// GS SHOP 에서 포인트 줄을 빼는 것과 같은 규칙이다.
//
// 최근 75건은 전부 `신용카드` 한 줄뿐이었다 (2026-08-31 확인). 다른 수단만으로 결제한 건이
// 나오면 금액이 0이 되어 토스트에 결제정보 표가 통째로 찍히므로, 그걸 보고 규칙을 고치면 된다.
//
// ── 배송비는 카드 금액에 들어 있을 수도, 아닐 수도 있다 ─────────────────────
//
// 상품 줄의 배송비가 `배송비` 면 최종 결제금액에 포함되고(29,900 + 3,000 − 5,090 = 27,810),
// `추가 배송비` 면 포함되지 않는다(39,000 + 6,000 − 3,750 − 7,800 = 33,450 인데 카드는 27,450).
// 75건 중 8건이 뒤쪽이다. 그래서 **금액을 조립하지 않고 신용카드 줄을 그대로 쓴다** — 어느
// 쪽이든 실제로 카드로 빠져나간 돈은 그 줄이다.
//
// ── 상품이 여럿이면 버튼도 상품마다 ─────────────────────────────────────────
//
// 한 결제번호에 상품이 둘인 주문건이 있다 (75건 중 6건). 그때 레이어는 **두 상품을 모두**
// 보여주고 상품마다 주문번호가 따로다. 망고 행도 상품마다 따로이므로 지마켓처럼 버튼을 상품마다
// 붙이고 누른 자리의 상품만 보낸다 (common.js 의 `key` 참고).
//
// 카드 금액은 결제 전체의 금액이라 상품이 여럿이면 그대로 쓸 수 없다. 그때는 그 상품 줄의
// **상품금액 + 할인금액**을 쓴다 (47,200 − 13,975 = 33,225, 둘을 더하면 카드 66,450 과 맞는다).
// 배송비 칸은 상품 줄 전체에 rowspan 으로 걸려 있어 어느 상품의 몫인지 알 수 없으므로 빼는데,
// 빼고 더한 합이 카드 금액과 어긋나고 **넣으면 맞는** 경우에만 그 줄에 붙인다.
(() => {
  'use strict';

  const ORDER_DATE = /(20\d\d)년\s*(\d{1,2})월\s*(\d{1,2})일/;

  // '38,500원 (1개)' -> 38500 · '-6,850원' -> -6850 (앞의 숫자 하나만 본다)
  function num(s) {
    const m = String(s).replace(/\s/g, '').match(/-?[\d,]+/);
    return m ? parseInt(m[0].replace(/,/g, ''), 10) : 0;
  }

  const label = (el) => el.textContent.replace(/\s/g, '');
  const pad = (v) => (v.length < 2 ? '0' + v : v);

  // ── 상품 줄 ───────────────────────────────────────────────────────────────
  //
  // 주문 목록 표는 상품마다 두 줄을 쓴다 — 윗줄이 상품, 아랫줄이 선택옵션이다. 주문번호가
  // 찍힌 `span.order-number` 는 윗줄에만 있으니 그걸로 상품 줄을 고른다.
  //
  // 화면 아래에는 같은 이름(`주문 목록`)의 표가 하나 더 있다 — 추가비용 결제내역이고 75건
  // 모두 비어 있었다. 그래도 컬럼이 달라(추가비용·결제수단·상태) 금액 칸이 둘 미만이므로,
  // **금액 칸이 둘 이상인 줄**만 남겨 걸러낸다.
  function itemRows() {
    const spans = document.querySelectorAll('span.order-number');
    const out = [];
    for (let i = 0; i < spans.length; i++) {
      const tr = spans[i].closest('tr');
      if (tr && tr.querySelectorAll('td.price').length >= 2) out.push(tr);
    }
    return out;
  }

  function orderNoOf(tr) {
    const s = tr.querySelector('span.order-number');
    return s ? (s.textContent.match(/\d+/) || [''])[0] : ''; // '(2569178034)' -> '2569178034'
  }

  // 금액 칸은 순서대로 상품금액 · 할인금액 · 배송비다. 배송비는 상품 줄 전체에 rowspan 으로
  // 걸려 있어 **첫 상품 줄에만** 있다 (윗주석 참고).
  const priceCells = (tr) => tr.querySelectorAll('td.price');
  const baseOf = (tr) => {
    const p = priceCells(tr);
    return num(p[0].textContent) + num(p[1].textContent);
  };
  const shipOf = (tr) => {
    const p = priceCells(tr);
    return p.length > 2 ? num(p[2].textContent) : 0;
  };

  // ── 결제정보 ──────────────────────────────────────────────────────────────
  //
  // `tr.sub` 가 결제수단 내역이다. 그중 이름에 `카드` 가 든 줄만 더한다 — 표 전체에서 이름으로
  // 고르면 나중에 `카드할인금액` 같은 줄이 생겼을 때 같이 걸린다.
  //
  // **`tr.sep` 을 만나면 끊는다.** 그 줄(`상품금액`)부터는 결제수단이 아니라 금액 내역이라
  // 우리가 쓸 값이 더 없다. 표는 5~6줄인데 3줄만 보게 되어 0.0060 → 0.0041 ms 다 (최악
  // 0.007 → 0.005. 5,000회 × 15시행 중앙값, 2026-08-31 실측). 75건 전부에서 결과가 같다.
  //
  // 끊는 조건에 `total` 을 건다 — 총액을 아직 못 읽었다면 표가 우리가 아는 모양이 아니라는
  // 뜻이라, 그때는 예전처럼 끝까지 훑는다.
  function payment() {
    const t = document.getElementById('payInfoTbl');
    let card = 0;
    let total = '';
    if (!t) return { card, total };
    const rows = t.rows;
    for (let i = 0; i < rows.length; i++) {
      const cls = rows[i].className;
      if (total && cls.indexOf('sep') !== -1) break;
      const th = rows[i].cells[0];
      const td = rows[i].cells[1];
      if (!th || !td) continue;
      const name = label(th);
      if (name === '최종결제금액') {
        total = (td.textContent.match(/[\d,]+/) || [''])[0]; // '31,650'
      } else if (cls.indexOf('sub') !== -1 && name.indexOf('카드') !== -1) {
        card += num(td.textContent); // '31,650원 현대카드/일시불(무이자)' -> 31650
      }
    }
    return { card, total };
  }

  // 상품이 하나면 카드 금액이 곧 그 상품의 청구액이다. 여럿이면 상품 줄에서 조립한다.
  function itemPrice(card, rows, i) {
    if (rows.length === 1) return card;
    const mine = baseOf(rows[i]);
    let base = 0;
    let ship = 0;
    for (let k = 0; k < rows.length; k++) {
      base += baseOf(rows[k]);
      ship += shipOf(rows[k]);
    }
    // 배송비를 빼면 어긋나고 넣으면 맞는 경우에만 그 줄의 배송비를 붙인다.
    if (base !== card && base + ship === card) return mine + shipOf(rows[i]);
    return mine;
  }

  // ── 배송지정보 ────────────────────────────────────────────────────────────
  //
  // 표에 id 가 없어 `caption` 이름으로 고른다. 75건 모두 배송지가 하나였다.
  function shipTable() {
    const ts = document.querySelectorAll('table.order-detail-table');
    for (let i = 0; i < ts.length; i++) {
      const c = ts[i].caption;
      if (c && c.textContent.trim() === '배송지정보') return ts[i];
    }
    return null;
  }

  function receiver() {
    const t = shipTable();
    if (!t) return '';
    const rows = t.rows;
    for (let i = 0; i < rows.length; i++) {
      const th = rows[i].cells[0];
      const td = rows[i].cells[1];
      if (th && td && label(th) === '받으시는분') return td.textContent.trim();
    }
    return '';
  }

  // 값을 못 찾았을 때 화면이 실제로 뭘 담고 있었는지 오류에 같이 실어 보낸다.
  function dump(el) {
    return el ? el.textContent.replace(/\s+/g, ' ').trim().slice(0, 220) : '(없음)';
  }

  function extract(i) {
    const rows = itemRows(); // 누른 자리의 상품은 지금 화면에서 다시 읽는다
    const tr = rows[i];
    if (!tr) return { error: '주문상세정보 화면이 아닙니다 (상품 줄을 찾지 못했습니다).' };

    const orderNo = orderNoOf(tr);
    if (!orderNo) return { error: '상품의 주문번호를 찾지 못했습니다.\n[상품] ' + dump(tr) };

    const pay = payment();
    const price = itemPrice(pay.card, rows, i);

    const head = document.querySelector('.num-date');
    const d = ((head && head.textContent) || '').match(ORDER_DATE);
    const who = receiver();

    if (!price) {
      const seen = dump(document.getElementById('payInfoTbl'));
      return { error: '신용카드 결제금액을 찾지 못했습니다.\n[결제] ' + seen };
    }
    if (!d) return { error: '주문일자를 찾지 못했습니다.\n[머리글] ' + dump(head) };
    if (!who) return { error: '받으시는 분(수령인)을 찾지 못했습니다.\n[배송] ' + dump(shipTable()) };
    // 옥션은 오래된 주문건의 이름을 `허*식` 으로 가린다 (75건 중 63건, 대체로 3주보다 오래된
    // 건이다). 마스킹 전 이름은 화면에도 응답 어디에도 없다 — 더현대Hi 처럼 되살릴 수가 없다.
    // 그대로 보내면 망고에서 아무 행도 잡히지 않으므로 여기서 끊고 이유를 알려준다.
    if (who.indexOf('*') !== -1) {
      return {
        error: '받는 분 이름이 가려져 있습니다 ("' + who + '"). 옥션은 오래된 주문건의 이름을 가립니다.',
      };
    }

    return {
      url: 'https://escrow.auction.co.kr/Close/OrderProcessDetailLayer.aspx?order_no=' + orderNo,
      orderNo, // 2569178034 — 화면 표기와 주소의 order_no 가 같다
      price: String(price), // 숫자만, 신용카드분만
      payDate: d[1] + '.' + pad(d[2]) + '.' + pad(d[3]), // 2026.08.24
      receiver: who,
      total: pay.total, // '31,650' — 망고 행 매칭 보조키
      // marketTag 없음 — 지마켓·패션플러스·롯데아이몰·더현대Hi·CJ온스타일·NS몰·GS SHOP 과
      // 같은 사정. 망고의 발주처 슬롯은 `[LOTTEON.com]` `[SSG.com]` 처럼 도메인 꼴로 찍히는데
      // 옥션 발주건이 아직 목록에 없어 어떤 표기가 붙는지 확인하지 못했다. 맞지 않는 태그는
      // 점수를 못 얻으면서 후보 행마다 비교 비용만 늘린다 (README 실측).
    };
  }

  // ── 상품마다 버튼 하나 ─────────────────────────────────────────────────────
  //
  // 버튼은 **상품명 칸**에 붙인다. 주문번호가 찍힌 첫 칸은 표 너비의 13%(99px)뿐이라 버튼을
  // 넣으면 세 줄로 접힌다 (실측 66×57px). 상품명 칸은 `width:auto` 라 236px 이고, 버튼이
  // 들어가도 팝업이 가로로 넘치지 않는다 (문서 폭 900px 그대로).
  let items = [];
  let scanned = 0;
  let mounts = 0;

  function refresh() {
    // mount 마다 옵저버가 따로 돌아 각자의 틱에 anchor 를 부른다. 같은 틱에 문서를 여러 번
    // 훑지 않도록 묶는다 (지마켓과 같은 장치다).
    const now = Date.now();
    if (now - scanned < 100) return;
    scanned = now;
    items = itemRows();
    while (mounts < items.length) mountOne(mounts++);
  }

  function mountOne(i) {
    window.__LM_SITE__.mount({
      key: 'au' + i, // 껍데기 청소가 옆 상품의 버튼을 지우지 않도록 자리마다 다른 key
      extract: () => extract(i),
      anchor: () => {
        refresh();
        const tr = items[i];
        if (!tr) return null;
        const cell = tr.cells[1]; // 상품명/주문옵션
        return cell ? cell.querySelector('a') : null;
      },
    });
  }

  mountOne(mounts++); // 첫 자리는 미리. 아직 안 그려졌으면 옵저버가 기다린다.
})();
