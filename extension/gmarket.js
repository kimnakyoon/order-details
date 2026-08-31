// 지마켓(G마켓) 주문상세 페이지 -> 망고 전송용 값 추출
//
// 화면을 긁지 않고, 주문상세가 이미 부르는 **같은 오리진 API** 에서 값을 가져온다.
//   GET /api/pay-detail/<장바구니번호>
//     payPayment.paymentDateTime    결제일시 (UTC ISO) -> KST 로 바꿔 넣는다
//     payPayment.paymentMethodList  결제수단별 금액 (카드분만 골라내는 데 쓴다)
//     payDelivery.receiverName      수령인
//     orderList[].orderNo/paymentAmount  상품별 주문번호·결제금액
// 화면(DOM)에서 읽는 건 **버튼 자리와 그 자리의 주문번호뿐**이다. 지마켓 화면은 클래스가
// 의미대로 붙어 있어(`box__order-number`, `text__value`) 긁어도 되지만, 결제일시만은 화면에
// 아예 없다 — 어차피 API 를 부를 거라면 나머지도 거기서 읽는 편이 어긋날 곳이 적다.
//
// 결제일시: 카드전표(`receipt.gmarket.co.kr/Card/CardReceipt?contr_no=<주문번호>`)의 `거래일자`와
//   같은 값이다 (전표 `2026-08-31 8:19:57 AM` / API `2026-08-30T23:19:56.373Z` = KST 08:19:56 —
//   카드 승인과 결제 요청의 1초 차이). 전표는 서버가 HTML 로 내주지 않고 `/Card/CardReceiptForm`
//   을 다시 POST 해서 그리는 화면이라 읽으려면 백그라운드 탭으로 띄워야 하는데(무신사 영수증과
//   같은 사정), 같은 값을 API 가 즉시 주므로 탭을 열지 않는다.
//
// 상품이 여러 개면 상품마다 주문번호·결제금액·카드전표가 따로다. 그래서 **버튼도 상품마다
// 하나씩** 붙이고 누른 자리의 상품만 보낸다 (common.js 의 `key` 참고).
(() => {
  'use strict';

  const DETAIL = /^\/ko\/pc\/detail\/basic\/(\d+)/;
  // URL 경로에 들어가는 건 장바구니번호(= Next.js 의 payNo)다. 상품 주문번호가 아니다.
  const payNo = () => (location.pathname.match(DETAIL) || [])[1] || '';

  const comma = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  // '2026-08-30T23:19:56.373Z' -> '2026.08.31 08:19:56'
  //
  // 브라우저 시간대에 기대지 않는다. UTC 에 9시간을 더해 UTC 게터로 읽으면 PC 시계가 어디에
  // 맞춰져 있든 KST 가 나온다. 오프셋 표기가 없으면 이미 현지 표기로 보고 그대로 쓴다.
  function kst(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    if (!m) return '';
    if (!/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) return `${m[1]}.${m[2]}.${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
    const p = (v) => String(v).padStart(2, '0');
    const d = new Date(Date.parse(iso) + 9 * 3600 * 1000);
    return (
      `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())} ` +
      `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
    );
  }

  // ── 버튼 자리 = 상품의 주문번호 칸 ──────────────────────────────────────
  //
  // `주문번호 4484872454` 는 클릭하면 번호가 복사되는 버튼이고, 상품마다 하나씩 있다.
  // 주문내역 목록 화면에도 똑같은 마크업이 있어서, 주문상세 경로일 때만 훑는다.
  function orderButtons() {
    if (!payNo()) return [];
    const out = [];
    for (const b of document.querySelectorAll('button.button-copy')) {
      const label = b.querySelector('.text__label');
      if (!label || label.textContent.replace(/\s/g, '') !== '주문번호') continue;
      if (!b.querySelector('.text__value')) continue;
      out.push(b);
    }
    return out;
  }

  const orderNoOf = (b) =>
    ((b.querySelector('.text__value') || {}).textContent || '').replace(/[^\d]/g, '');

  // ── 주문정보 — 한 화면을 보는 동안 한 번만 받는다 ──────────────────────
  //
  // 이 경로에서 유일하게 밀리초 단위인 구간이 API 왕복이다 (실측 180~322ms). 클릭한 뒤에
  // 받으면 그 시간이 고스란히 `전송 중…` 으로 보인다. 그래서 **버튼이 붙는 순간 미리 받아
  // 둔다.** 버튼 자리가 생겼다는 건 주문상세가 이미 다 그려졌다는 뜻이라(페이지가 자기
  // `/api/pay-detail` 요청을 끝내고 그린 결과다) 로딩과 겹치지 않는다.
  //
  // `requestIdleCallback` 으로 더 얌전히 보내려다 되돌렸다. 이 페이지는 광고·트래커가 계속
  // 돌아 한가한 틈이 생기지 않아 **타임아웃(3초)까지 밀렸고**, 그 전에 누르면 결국 기다리게
  // 된다 (실측: 프리페치를 rIC 로 걸었을 때 첫 클릭이 134ms 대기). 8KB GET 하나라 그냥 보낸다.
  //
  // 캐시는 **지금 보고 있는 주문상세 하나뿐**이고 화면을 떠나면 버린다. 페이지도 로드할 때
  // 같은 요청을 한 번 하고 그대로 그려 두므로, 우리가 보내는 값은 사용자가 보고 있는 화면과
  // 같은 시점의 값이다. (그 화면에서 취소·반품을 신청한 직후처럼 값이 바뀌었는데 화면을
  // 떠나지 않은 경우에는 캐시가 낡을 수 있다. 그때는 새로고침하면 된다.)
  let cache = { no: '', data: null };
  let asked = '';

  function load(no) {
    return fetch('/api/pay-detail/' + no, { headers: { Accept: 'application/json' } })
      .then((r) => {
        if (!r.ok) throw new Error('응답 ' + r.status);
        return r.json();
      })
      .then((j) => j.data);
  }

  function detail(no) {
    if (cache.no !== no) cache = { no, data: null };
    if (!cache.data) cache.data = load(no);
    // 실패한 응답을 물고 있지 않는다 — 다음 클릭은 새로 받는다.
    return cache.data.catch((e) => {
      if (cache.no === no) cache.data = null;
      throw e;
    });
  }

  function prefetch(no) {
    if (!no || asked === no) return;
    asked = no;
    detail(no).catch(() => {}); // 실패해도 조용히 — 클릭할 때 다시 받는다
  }

  // 주문상세를 떠났다 = 다음에 들어올 때 다시 받는다.
  function forget() {
    if (!asked && !cache.no) return;
    asked = '';
    cache = { no: '', data: null };
  }

  // ── 구입금액 = 실제 카드 청구액 ────────────────────────────────────────
  //
  // 상품이 하나면 결제수단에서 카드분만 더한 값이 곧 그 상품의 청구액이다. 스마일캐시·포인트가
  // 섞이면 상품 결제금액보다 작아지는데, 롯데온에서 L.POINT 를 SSG 에서 SSG MONEY 를 빼는
  // 규칙과 결이 같다. 상품이 여러 개면 카드분을 상품별로 나눌 근거가 없어 그 상품의
  // 결제금액을 그대로 쓴다.
  function cardPrice(pay, list, item) {
    const card = (pay.paymentMethodList || [])
      .filter((m) => !m.canceledPayment && (m.isUsedCardInfo || m.cardName))
      .reduce((a, m) => a + (m.paymentAmount || 0), 0);
    if (list.length === 1 && card) return card;
    return item.paymentAmount || 0;
  }

  // 값을 못 찾았을 때 API 가 실제로 뭘 담고 있었는지 오류에 같이 실어 보낸다.
  function probe(d, item) {
    const pay = d.payPayment || {};
    const methods = (pay.paymentMethodList || [])
      .map((m) => `${m.cardName || m.paymentMethodEnum}:${m.paymentAmount}`)
      .join(' / ');
    return (
      `[결제] 총 ${pay.totalPaymentAmount} · 수단 ${methods || '없음'} · ` +
      `일시 ${pay.paymentDateTime || d.payDate || '없음'}\n` +
      `[상품] 결제금액 ${item.paymentAmount} · [배송] ${(d.payDelivery || {}).receiverName || '이름 없음'}`
    );
  }

  async function extract(i) {
    const no = payNo();
    if (!no) return { error: '주문상세 화면이 아닙니다 (장바구니번호를 찾지 못했습니다).' };

    // 누른 자리의 주문번호는 지금 화면에서 다시 읽는다 (캐시가 낡았을 수 있다).
    const btn = orderButtons()[i];
    const orderNo = btn ? orderNoOf(btn) : '';
    if (!orderNo) return { error: '상품의 주문번호를 찾지 못했습니다.' };

    let d;
    try {
      d = await detail(no); // 대개 이미 받아 둔 값이라 기다리지 않는다
    } catch (e) {
      return { error: '주문정보를 불러오지 못했습니다 — ' + e.message };
    }
    if (!d) return { error: `주문정보가 비어 있습니다 (/api/pay-detail/${no}).` };

    const list = d.orderList || [];
    const item = list.filter((o) => String(o.orderNo) === orderNo)[0];
    if (!item) {
      const seen = list.map((o) => o.orderNo).join(', ') || '없음';
      return { error: `주문번호 ${orderNo} 가 주문정보에 없습니다 (API 의 번호: ${seen}).` };
    }

    const pay = d.payPayment || {};
    const price = cardPrice(pay, list, item);
    const payDate = kst(pay.paymentDateTime || d.payDate);
    const receiver = ((d.payDelivery || {}).receiverName || '').trim();

    if (!price) return { error: '결제금액을 찾지 못했습니다.\n' + probe(d, item) };
    if (!payDate) return { error: '결제일시를 찾지 못했습니다.\n' + probe(d, item) };
    if (!receiver) return { error: '수령인(배송정보 이름)을 찾지 못했습니다.\n' + probe(d, item) };

    return {
      url: 'https://my.gmarket.co.kr/ko/pc/detail/basic/' + no,
      orderNo, // 4484872454 — 장바구니번호가 아니라 상품별 주문번호
      price: String(price), // 숫자만
      payDate, // 2026.08.31 08:19:56
      receiver,
      total: pay.totalPaymentAmount ? comma(pay.totalPaymentAmount) : '', // "39,330"
      // marketTag 없음 — 망고 발주처가 지마켓으로 찍히지 않는다 (패션플러스와 같은 사정).
    };
  }

  // ── 상품마다 버튼 하나 ─────────────────────────────────────────────────
  //
  // 자리(index)는 화면이 다시 그려져도 그대로라, index 로 mount 해 두고 그 자리에 지금 있는
  // 상품을 그때그때 읽는다. SPA 라 다른 주문으로 넘어가도 mount 를 다시 만들지 않는다 —
  // 상품이 더 많은 주문을 열었을 때만 모자란 만큼 더 붙이고, 적은 주문에서는 남는 mount 의
  // anchor 가 null 을 줘서 (watch 모드가) 버튼을 떼어낸다.
  let buttons = [];
  let scanned = 0;
  let mounts = 0;

  function refresh() {
    // mount 마다 옵저버가 따로 돌아 각자의 틱에 anchor 를 부른다. 같은 틱에 문서를 여러 번
    // 훑지 않도록 묶는다 (클래스 선택자 하나라 원래도 싸지만, 상품 수만큼 곱해지는 자리다).
    const now = Date.now();
    if (now - scanned < 100) return;
    scanned = now;
    buttons = orderButtons();
    // 버튼 자리가 있다 = 주문상세가 그려졌다. 이때 주문정보를 미리 받아 둔다.
    if (buttons.length) prefetch(payNo());
    else forget();
    while (mounts < buttons.length) mountOne(mounts++);
  }

  function mountOne(i) {
    window.__LM_SITE__.mount({
      key: 'gm' + i, // 껍데기 청소가 옆 상품의 버튼을 지우지 않도록 자리마다 다른 key
      extract: () => extract(i),
      anchor: () => {
        refresh();
        return buttons[i] || null;
      },
      watch: true,
    });
  }

  mountOne(mounts++); // 첫 자리는 미리. 화면이 아직 안 그려졌으면 옵저버가 기다린다.
})();
