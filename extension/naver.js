// 네이버페이 주문상세 페이지 -> 망고 전송용 값 추출
//
// 결제금액: '결제정보' 블록에서 **카드로 결제한 금액만** 더한다.
//   주문금액 41,800원 = 네이버페이 포인트 1,087원 + 카드 간편결제 40,713원 이면 40,713 을 쓴다.
//   포인트·충전결제(네이버페이 머니)는 실제 카드 청구액이 아니라서 뺀다.
//
// 결제일시: 주문번호 바로 위에 '2026.08.26. 08:24:52' 로 찍혀 있다. 초까지 나오는 건
//   무신사와 여기뿐이다. 날짜 뒤의 점만 떼고 '2026.08.26 08:24:52' 로 넘긴다.
(() => {
  'use strict';

  const DETAIL = /^\/order\/status\/(\d{10,})/;
  const orderNo = () => (location.pathname.match(DETAIL) || [])[1] || '';

  const T = () => (document.body.innerText || '').replace(/\r/g, '');

  // '2026.08.26. 08:24:52' — 날짜 끝에 점이 하나 더 붙는다.
  const DT = /20\d\d\.\s?\d{1,2}\.\s?\d{1,2}\.?\s+\d{1,2}:\d{2}(?::\d{2})?/;
  // 2026.08.26. 08:24:52 -> 2026.08.26 08:24:52
  const cleanDT = (s) => s.replace(/\s+/g, ' ').replace(/\.\s(?=\d{1,2}:)/, ' ');

  // ── 주문번호가 찍힌 요소 ────────────────────────────────────────────────
  //
  // 버튼 자리이자 결제일시를 찾는 기준점이다. 네이버페이는 SPA 라 주문목록에서
  // 주문상세로 문서를 다시 읽지 않고 넘어간다. common.js 의 watch 가 anchor 를 계속
  // 부르므로, 찾은 요소를 캐시해 매번 문서를 훑지 않게 한다 (무신사와 같은 이유).
  // 어느 주문에서 찾아 둔 자리인지를 기억한다. textContent 로 확인하면 틱마다 요소를
  // 문자열로 새로 만든다 — 다시 찾을 때를 정하는 데만 쓰이는 값이라, 찾을 때의 주문번호를
  // 들고 있으면 판별은 똑같고 문자열은 만들지 않는다 (더현대Hi·NS몰과 같은 절약).
  let cached = null;
  let cachedNo = '';

  function anchor() {
    const no = orderNo();
    if (!no) return null; // 주문상세가 아닌 화면 -> 버튼을 뗀다
    if (cached && cachedNo === no && cached.isConnected) return cached;

    cached = null;
    cachedNo = '';
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (n.nodeValue.length > 60) continue;
      if (n.nodeValue.indexOf(no) === -1) continue;
      const el = n.parentElement;
      if (el && el.offsetParent !== null) {
        cached = el;
        cachedNo = no;
        break;
      }
    }
    return cached;
  }

  // 주문번호 요소에서 위로 올라가며 처음 만나는 날짜+시각.
  // 같은 카드 안에 주문번호 바로 위에 찍혀 있어서 두세 단계면 잡힌다.
  // 못 찾으면 본문 전체에서 처음 나오는 날짜+시각으로 떨어진다.
  function payDate() {
    for (let n = anchor(), i = 0; n && i < 6; n = n.parentElement, i++) {
      const m = (n.innerText || '').match(DT);
      if (m) return cleanDT(m[0]);
    }
    const m = T().match(DT);
    return m ? cleanDT(m[0]) : '';
  }

  // ── 결제정보 블록 ──────────────────────────────────────────────────────
  //
  // 본문 텍스트에서 '결제정보'부터 다음 섹션 제목까지 잘라 쓴다. 스타일드컴포넌트
  // 클래스 해시로 블록을 찾을 수 없고, 필요한 건 라벨-금액 쌍이라 텍스트로 충분하다.
  const NEXT_SECTION = /\n\s*(포인트\s*혜택|주문자\s*정보|현금영수증|판매자\s*정보|주문상품)/;

  function payText(t) {
    const i = t.indexOf('결제정보');
    if (i < 0) return '';
    const seg = t.slice(i);
    const end = seg.search(NEXT_SECTION);
    return end > 0 ? seg.slice(0, end) : seg.slice(0, 1500);
  }

  const AMOUNT = /([\d,]+)\s*원/;
  // 결제수단 줄이 아닌 것들. '카드'가 들어가도 금액 줄이 아니다.
  //   '카드즉시할인 -1,000원'         -> 할인
  //   '현대 5165 **** **** ****'      -> 마스킹된 카드번호
  //   '· 무이자 … 카드사로 문의하시면' -> 안내 문구
  const NOT_METHOD = /할인|적립|무이자|문의|안내|혜택|사용하기|\*/;

  // 카드로 결제한 금액만 더한다. 카드 두 장으로 나눠 결제했으면 둘 다 잡힌다.
  // 라벨과 금액이 같은 줄에 있든(플렉스가 한 줄로 합쳐진 경우) 다음 줄에 있든 잡히게
  // 두 줄을 묶어서 본다.
  function cardTotal(seg) {
    const lines = seg.split('\n').map((s) => s.trim()).filter(Boolean);
    let sum = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.indexOf('카드') === -1) continue;
      if (line.length > 30 || NOT_METHOD.test(line)) continue;
      const m = (line + ' ' + (lines[i + 1] || '')).match(AMOUNT);
      if (!m) continue;
      sum += parseInt(m[1].replace(/,/g, ''), 10);
    }
    return sum;
  }

  // 주문금액 총액 (망고 행 매칭 보조키로만 쓴다)
  function orderTotal(seg) {
    const m = seg.match(/주문금액[\s\S]{0,20}?총\s*([\d,]+)\s*원/) || seg.match(/총\s*([\d,]+)\s*원/);
    return m ? m[1] : '';
  }

  // ── 수령인 ─────────────────────────────────────────────────────────────
  //
  // 배송지 첫 줄이 '함용녀(집)' 처럼 이름 뒤에 배송지 별칭이 붙는다. 괄호부터 잘라낸다.
  const LABEL = /^(배송지|받는\s*사람|받으시는\s*분|수령인)/;
  const NAME_OK = /^[가-힣]{2,6}$|^[A-Za-z][A-Za-z.\s]{1,19}$/;

  function receiver(t) {
    const lines = t.split('\n').map((s) => s.trim());
    for (let i = 0; i < lines.length; i++) {
      if (!LABEL.test(lines[i])) continue;
      // 라벨 줄에 값이 붙어 있을 수도, 다음 줄일 수도 있다.
      for (let j = i; j < Math.min(i + 4, lines.length); j++) {
        const name = lines[j].replace(LABEL, '').split('(')[0].trim();
        if (name && NAME_OK.test(name)) return name;
      }
    }
    return '';
  }

  // 값을 못 찾았을 때 페이지가 실제로 뭘 담고 있었는지 오류에 같이 실어 보낸다.
  // 네이버는 브라우저 도구로 열 수 없어 화면을 직접 볼 수 없다 (SSG 와 같은 사정).
  function probe(t, seg) {
    const head = seg ? seg.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 14).join(' / ')
                     : '(본문에 "결제정보" 없음)';
    const i = t.indexOf('배송지');
    const around = i < 0 ? '(본문에 "배송지" 없음)' : t.slice(i, i + 80).replace(/\n/g, '⏎');
    return `[결제정보] ${head}\n[배송지] ${around}`;
  }

  function extract() {
    const no = orderNo();
    if (!no) return { error: '주문상세 화면이 아닙니다 (주문번호를 찾지 못했습니다).' };

    const t = T();
    const seg = payText(t);
    const price = cardTotal(seg);
    const name = receiver(t);
    const pd = payDate();

    if (!price) {
      return {
        error: '카드 결제금액을 찾지 못했습니다.\n' + probe(t, seg),
      };
    }
    if (!name) return { error: '수령인(배송지 받는 사람)을 찾지 못했습니다.\n' + probe(t, seg) };
    if (!pd) return { error: '결제일시를 찾지 못했습니다 (주문번호 위의 날짜·시각).' };

    return {
      url: 'https://orders.pay.naver.com/order/status/' + no,
      orderNo: no, // 2026082632274171
      price: String(price), // 카드 결제분만, 숫자만
      payDate: pd, // 2026.08.26 08:24:52
      receiver: name,
      total: orderTotal(seg), // "41,800" — 망고 행 매칭 보조키
      // 망고 목록 행에 어느 표기로 찍혀 있어도 잡히도록
      marketTag: ['네이버', 'NAVER', '스마트스토어'],
    };
  }

  window.__LM_SITE__.mount({ extract, anchor, watch: true });
})();
