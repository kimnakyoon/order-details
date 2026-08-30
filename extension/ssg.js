// SSG 주문상세 페이지 -> 망고 전송용 값 추출
//
// 결제일시: 전자영수증의 '발급일시'는 영수증을 뽑은 시각(= 지금)이라 결제일시가 아니다.
// 영수증 결제내역의 '승인일시'도 날짜뿐(2026/08/27)이라, 주문상세 맨 위에 찍힌
// 주문일자를 쓴다. 롯데온과 마찬가지로 날짜까지만 얻을 수 있다.
(() => {
  'use strict';

  const T = () => document.body.innerText.replace(/\r/g, '');

  // 화면은 '20260827-61F020', URL 은 '2026082761F020'. 하이픈/공백을 떼고 대조한다.
  const key = (v) => (v || '').replace(/[^0-9A-Za-z]/g, '');

  // 주문상세 상단의 '2026.08.27'. 없으면 주문번호 앞 8자리(YYYYMMDD)에서 만든다.
  function payDate(t, orderNo) {
    const shown = (t.match(/20\d\d\.\d{2}\.\d{2}/) || [])[0];
    if (shown) return shown;
    const m = key(orderNo).match(/^(20\d\d)(\d{2})(\d{2})/);
    return m ? `${m[1]}.${m[2]}.${m[3]}` : '';
  }

  // 수령인 이름으로 볼 수 없는 값. SSG 페이지에는 배송지 변경 레이어가 숨어 있고
  // 거기에 '받으시는 분' 제목과 '받으시는 분 성함' 입력 라벨이 들어 있어서,
  // 텍스트 근접성만으로 찾으면 라벨 문구를 이름으로 착각한다.
  const LABEL =
    /성함|연락처|전화|휴대|번호|주소|메시지|메세지|배송|받으시는|받는|수령인|주문자|정보|이름|입력|선택|변경/;

  // '양은영 010-2977-8032 (안심번호 사용안함)' -> '양은영'
  function pickName(raw) {
    const s = (raw || '').trim();
    const n = s.split(/[\d(]/)[0].trim();
    if (!n || n.length > 20 || LABEL.test(n)) return '';
    // 라벨 문구를 값으로 착각하지 않도록 한 겹 더 — 뒤에 전화번호가 붙어 있거나,
    // 값 자체가 공백 없는 사람 이름 모양이어야 한다.
    const hasPhone = /0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}/.test(s);
    const looksName = /^[가-힣]{2,6}$/.test(n) || /^[A-Za-z][A-Za-z.\s]{1,19}$/.test(n);
    return hasPhone || looksName ? n : '';
  }

  const IS_LABEL_CELL = /^(받으시는\s*분|받는\s*분|수령인)$/;

  // 값 칸의 직속 텍스트 노드만 모은다.
  // SSG 는 <dd> 안에 <span class="blind">받으시는 분 성함</span> 같은 스크린리더용
  // 라벨을 값 사이사이에 끼워 넣는다. 라벨은 요소 안에 있고 값은 직속 텍스트라 이걸로 갈린다.
  function ownText(el) {
    let s = '';
    for (const n of el.childNodes) if (n.nodeType === 3) s += n.nodeValue;
    return s;
  }

  // 값이 요소로 감싸여 있어 ownText 로 안 잡히는 경우의 대비.
  // 라벨 span 들만 걷어내고 읽는다 (자식 요소가 없는 것만 지워, 통째로 날리지 않는다).
  function stripLabels(el) {
    const c = el.cloneNode(true);
    for (const n of c.querySelectorAll('*')) {
      if (!n.children.length && LABEL.test(n.textContent.trim())) n.remove();
    }
    return c.textContent;
  }

  // 1순위: DOM 에서 '받으시는 분' 라벨 칸을 찾아 같은 행의 값 칸을 읽는다.
  function receiverFromDom() {
    for (const lab of document.querySelectorAll('body *')) {
      if (lab.children.length) continue;
      if (!IS_LABEL_CELL.test(lab.textContent.trim())) continue;
      const val =
        lab.nextElementSibling || (lab.parentElement && lab.parentElement.nextElementSibling);
      if (!val) continue;
      const name = pickName(ownText(val)) || pickName(stripLabels(val));
      if (name) return name;
    }
    return '';
  }

  // 2순위: 본문 텍스트. 라벨 줄 다음의 몇 줄을 훑어 라벨이 아닌 첫 값을 고른다.
  // '받으시는 분 / 받으시는 분 성함 / 양은영' 처럼 라벨이 한 줄 더 끼어들기 때문에
  // 바로 다음 줄만 보면 안 된다.
  function receiverFromText(t) {
    const lines = t.split('\n').map((s) => s.trim());
    for (let i = 0; i < lines.length; i++) {
      if (!/^(받으시는\s*분|받는\s*분|수령인)/.test(lines[i])) continue;
      // 같은 줄에 값이 붙어 있는 경우 먼저
      const same = pickName(lines[i].replace(/^(받으시는\s*분|받는\s*분|수령인)\s*/, ''));
      if (same) return same;
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const name = pickName(lines[j]);
        if (name) return name;
      }
    }
    return '';
  }

  const findReceiver = (t) => receiverFromDom() || receiverFromText(t);

  // 수령인을 못 찾았을 때, 페이지가 실제로 뭘 담고 있는지 오류 메시지에 같이 실어 보낸다.
  // 화면을 직접 볼 수 없는 상태에서 원인을 좁히기 위한 것.
  function probe(t) {
    const labels = [...document.querySelectorAll('body *')].filter(
      (el) => !el.children.length && /받으시는|받는\s*분|수령인/.test(el.textContent)
    );
    const lines = labels
      .slice(0, 4)
      .map((el) => `${el.tagName.toLowerCase()}${el.offsetParent ? '' : '(숨김)'}: ${el.textContent.trim().slice(0, 40)}`);
    const i = t.indexOf('받으시는');
    const around = i < 0 ? '(본문에 "받으시는" 없음)' : t.slice(i, i + 160).replace(/\n/g, '⏎');
    return `[요소 ${labels.length}건] ${lines.join(' | ')}\n[본문] ${around}`;
  }

  function extract() {
    const t = T();

    // 화면 표기('주문번호 20260827-61F020')를 우선. 못 찾으면 URL 의 orordNo.
    const urlNo = new URLSearchParams(location.search).get('orordNo') || '';
    const orderNo = (t.match(/주문번호\s*([\dA-Z][\dA-Z-]{6,})/) || [])[1] || urlNo;
    if (!orderNo) return { error: '주문번호를 찾지 못했습니다.' };

    // '총 결제금액 30,253원' — 포인트(SSG MONEY) 를 이미 제외한 실제 청구액.
    const total = (t.match(/총\s*결제금액[\s\S]{0,10}?([\d,]+)\s*원/) || [])[1] || '';
    const price = total.replace(/,/g, '');

    const receiver = findReceiver(t);

    const pd = payDate(t, orderNo);

    if (!price) return { error: '총 결제금액을 찾지 못했습니다.' };
    if (!receiver) return { error: '받으시는 분(수령인)을 찾지 못했습니다.\n' + probe(t) };
    if (!pd) return { error: '주문일자(결제일시)를 찾지 못했습니다.' };

    return {
      url: `https://pay.ssg.com/myssg/orderInfoDetail.ssg?orordNo=${urlNo || key(orderNo)}&viewType=Ssg`,
      orderNo, // 20260827-61F020
      price, // 숫자만
      payDate: pd, // 2026.08.27
      receiver,
      total, // "30,253"
      marketTag: 'SSG.com', // 망고 목록 행에 표시되는 발주처 태그
    };
  }

  // 주문번호가 찍힌 요소 바로 옆에 버튼을 붙인다.
  //
  // 태그 이름을 찍어서 찾지 않는다. SSG 는 주문번호를 어떤 태그에 담을지 알 수 없고,
  // '20260827-'/'61F020' 처럼 두 요소로 쪼개 놓을 수도 있다. 그래서
  // "정규화한 텍스트가 주문번호를 담고 있는 요소들" 중 가장 좁은 것을 고른다.
  // 쪼개져 있으면 둘을 감싸는 부모가, 한 덩어리면 그 요소 자신이 자연스럽게 뽑힌다.
  const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|HEAD)$/;

  function orderNoAnchor() {
    const no = key(new URLSearchParams(location.search).get('orordNo'));
    if (!no) return null;

    // 빠른 경로 — 텍스트 노드를 훑어 주문번호가 통째로 든 노드를 찾는다.
    // 아래 전수 조사는 요소마다 textContent 를 만드는데, 조상은 자손 텍스트를 다시
    // 이어붙이므로 문서가 커질수록 비용이 급격히 는다. 보통 여기서 끝난다.
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (n.nodeValue.length > 200) continue;
      if (!key(n.nodeValue).includes(no)) continue;
      const el = n.parentElement;
      if (el && el.offsetParent !== null) return el;
    }

    // 느린 경로 — 주문번호가 여러 요소로 쪼개져 있으면 위에서 못 찾는다.
    // 그때만 전수 조사해서 번호를 담고 있는 가장 좁은 요소를 고른다.
    const hits = [];
    for (const el of document.querySelectorAll('body *')) {
      if (SKIP.test(el.tagName)) continue;
      const len = el.textContent.length;
      // 주문번호 한 줄보다 훨씬 긴 요소는 '감싸는 컨테이너'라 버튼 자리로 부적합
      if (len > 200) continue;
      if (!key(el.textContent).includes(no)) continue;
      hits.push(el);
    }
    if (!hits.length) return null;

    hits.sort((a, b) => a.textContent.length - b.textContent.length);
    // 보이는 것 우선. offsetParent 는 여기서만(후보 몇 개) 확인해 레이아웃 강제를 줄인다.
    return hits.filter((el) => el.offsetParent !== null)[0] || hits[0];
  }

  window.__LM_SITE__.mount({ extract, anchor: orderNoAnchor });
})();
