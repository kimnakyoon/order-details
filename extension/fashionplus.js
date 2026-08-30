// 패션플러스 주문상세 페이지 -> 망고 전송용 값 추출
//
// 롯데온과 같은 구조의 정적 페이지다. 다만 값이 전부 <th>라벨 / <td>값 표에 들어 있어서,
// 본문 텍스트를 정규식으로 훑는 대신 표를 라벨로 읽는다 — 라벨 문구가 겹쳐도(주문자 정보와
// 배송지 정보에 '주문자명'이 둘 다 있다) 어느 표인지로 갈린다.
//
// 결제금액·결제일시는 '결제수단 정보' 표에서 가져온다.
//   결제금액   44,700원   -> 구입금액(신고금액)
//   결제승인일 2026-08-29 -> 트래킹번호(결제일시). 다른 마켓과 맞춰 점 표기로 바꾼다.
// 위쪽 '최종 결제금액' 블록의 총 결제 예상금액은 망고 행 매칭 보조키(total)로만 쓴다.
(() => {
  'use strict';

  const DETAIL = /\/mypage\/order\/detail\/(\d+)/;
  const orderNo = () => (location.pathname.match(DETAIL) || [])[1] || '';

  // 표 바로 위(또는 몇 단계 위 컨테이너 앞)에 붙어 있는 제목으로 표를 고른다.
  function sectionTable(title) {
    for (const t of document.querySelectorAll('table')) {
      for (let p = t, i = 0; p && i < 5; p = p.parentElement, i++) {
        const prev = p.previousElementSibling;
        if (prev && prev.textContent.trim().indexOf(title) === 0) return t;
      }
    }
    return null;
  }

  // 값 칸에서 버튼·링크를 걷어내고 읽는다.
  // 배송지의 이름 칸에는 '배송지 변경' 링크가 이름 뒤에 붙어 있다 ('서미경 배송지 변경').
  function cellText(td) {
    const c = td.cloneNode(true);
    for (const n of c.querySelectorAll('a, button')) n.remove();
    return c.textContent.replace(/\s+/g, ' ').trim();
  }

  // 라벨(th)이 붙은 행들의 값(td)을 순서대로. 결제수단이 여러 개면 같은 라벨이 여러 줄이다.
  function rowValues(table, label) {
    const out = [];
    if (!table) return out;
    for (const tr of table.rows) {
      const th = tr.cells[0];
      if (!th || th.tagName !== 'TH') continue;
      if (th.textContent.trim() !== label) continue;
      if (tr.cells[1]) out.push(cellText(tr.cells[1]));
    }
    return out;
  }

  const rowValue = (table, label) => rowValues(table, label)[0] || '';

  const num = (s) => parseInt(String(s).replace(/[^\d]/g, ''), 10) || 0;

  // '2026-08-29' -> '2026.08.29' / '2026-08-29 14:03:11' -> '2026.08.29 14:03:11'
  function payDate(raw) {
    const m = (raw || '').match(/(20\d\d)[-.](\d{1,2})[-.](\d{1,2})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?/);
    if (!m) return '';
    const pad = (v) => (v.length < 2 ? '0' + v : v);
    return `${m[1]}.${pad(m[2])}.${pad(m[3])}` + (m[4] ? ' ' + m[4] : '');
  }

  // 값을 못 찾았을 때 페이지가 실제로 뭘 담고 있었는지 오류에 같이 실어 보낸다.
  function probe(pay, addr) {
    const dump = (t) =>
      t
        ? [...t.rows]
            .map((tr) => [...tr.cells].map((c) => c.textContent.replace(/\s+/g, ' ').trim()).join(': '))
            .join(' / ')
            .slice(0, 300)
        : '(표 없음)';
    return `[결제수단 정보] ${dump(pay)}\n[배송지 정보] ${dump(addr)}`;
  }

  function extract() {
    const no = orderNo();
    if (!no) return { error: '주문상세 화면이 아닙니다 (주문번호를 찾지 못했습니다).' };

    const pay = sectionTable('결제수단 정보');
    const addr = sectionTable('배송지 정보');

    // 결제수단이 나뉘어 있으면 결제금액 줄이 여러 개다. 전부 더한다.
    const price = rowValues(pay, '결제금액').reduce((a, v) => a + num(v), 0);
    const pd = payDate(rowValue(pay, '결제승인일'));
    const receiver = rowValue(addr, '주문자명');

    // '총 결제 예상금액(1건)44,700' — 망고 행 매칭 보조키. '(1건)' 은 건너뛴다.
    const t = (document.body.innerText || '').replace(/\r/g, '');
    const total = (t.match(/총\s*결제\s*예상금액\s*(?:\([^)]*\))?\s*([\d,]+)/) || [])[1] || '';

    if (!price) return { error: '결제금액을 찾지 못했습니다.\n' + probe(pay, addr) };
    if (!pd) return { error: '결제승인일(결제일시)을 찾지 못했습니다.\n' + probe(pay, addr) };
    if (!receiver) return { error: '배송지 주문자명(수령인)을 찾지 못했습니다.\n' + probe(pay, addr) };

    return {
      url: 'https://www.fashionplus.co.kr/mypage/order/detail/' + no,
      orderNo: no, // 141324230
      price: String(price), // 숫자만
      payDate: pd, // 2026.08.29
      receiver,
      total, // "44,700"
    };
  }

  // 제목 줄의 주문번호('141324230 (신청일: 2026-08-29)') 옆에 버튼을 붙인다.
  function anchor() {
    const no = orderNo();
    if (!no) return null;
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (n.nodeValue.length > 60) continue;
      if (n.nodeValue.indexOf(no) === -1) continue;
      const el = n.parentElement;
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  window.__LM_SITE__.mount({ extract, anchor });
})();
