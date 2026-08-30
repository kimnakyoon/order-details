// The.Mango 주문관리 목록에 값 반영 + 주문상태 배송완료 + 저장
//
// 이 파일은 manifest 의 content_scripts 가 아니라, 마켓 주문상세에서 버튼을 눌렀을 때
// background 가 chrome.scripting.executeScript 로 주입한다.
// 따라서 망고 페이지를 그냥 열기만 할 때는 이 코드가 전혀 실행되지 않는다.
(() => {
  'use strict';
  if (window.__LM_MANGO__) return; // 같은 문서에 두 번 주입되어도 한 번만 초기화

  const STATE_DONE = '7';      // 배송완료
  const STATE_PAID = '2';      // 결제완료
  const STATE_CANCELLED = '9'; // 반품/교환/취소완료

  // 간단메모 앞칸 자리표시. 서버가 각 줄을 trim 하고 빈 줄을 버려서, 진짜 빈 칸으로는
  // 자리가 지켜지지 않는다 (writeMemo 주석 참고). NBSP 는 trim 을 통과하고 화면에선 빈 칸이다.
  const MEMO_PAD = '\u00a0';

  const $ = (id) => document.getElementById(id);

  // 값만 넣고 이벤트는 쏘지 않는다.
  //
  // 망고 목록에서 우리가 건드리는 칸에 붙어 있는 핸들러는 jQuery 로 걸린 것 하나뿐이고
  // (텍스트칸은 `keyup`, 주문상태 select 는 `change`), 하는 일은 **그 행의 체크박스를
  // 켜는 것**이 전부다. apply() 는 어차피 전체 체크를 풀고 대상 행만 다시 켜므로 그 효과는
  // 곧바로 덮인다. 저장을 맡는 really_all_select_modify() 도 체크된 행의 값을 id 로
  // `.val()` 해서 읽을 뿐 '수정됨' 표시 같은 건 보지 않고, 체크박스에는 핸들러가 아예 없다.
  //
  // 그래서 이벤트는 전부 낭비다. 한 번 보낼 때 dispatch 15번과, 그중 keyup/change 핸들러가
  // 부르는 **문서 전체 jQuery 조회 4번**이 사라진다.
  // (2026-08-30 망고 50행 목록에서 실측·확인. 망고 화면이 바뀌면 다시 볼 것.)
  function setValue(el, v) {
    if (!el) return false;
    el.value = v;
    return true;
  }

  // 컬럼 위치는 헤더에서 한 번만 읽는다. 못 찾으면 -1 로 두고 행 전체 텍스트로 폴백한다.
  // 이렇게 하면 망고가 컬럼 순서를 바꿔도 따라가고, 못 따라가도 동작은 한다.
  function columnIndex(table) {
    const col = { receiver: -1, price: -1, info: -1 };
    const head = table && table.rows[0];
    if (!head) return col;
    for (let i = 0; i < head.cells.length; i++) {
      const s = head.cells[i].textContent.replace(/\s/g, '');
      if (col.receiver < 0 && s.indexOf('수령인') === 0) col.receiver = i;
      else if (col.price < 0 && s.indexOf('결제금액') === 0) col.price = i;
      else if (col.info < 0 && s.indexOf('주문번호') === 0) col.info = i;
    }
    return col;
  }

  // 필요한 칸만 읽는다. 행 전체(textContent)를 읽으면 트래킹번호 칸에 들어있는
  // <style> 블록과 택배사 <select> 옵션까지 문자열로 만들게 되는데, 그게 행 텍스트의
  // 절반이면서 매칭에는 전혀 쓰이지 않는다.
  const cellText = (tr, i) => (i >= 0 && tr.cells[i] ? tr.cells[i].textContent : tr.textContent);

  // 발주처 태그는 여러 표기를 받는다 (무신사는 '무신사'/'MUSINSA' 둘 다 쓰일 수 있다).
  // 행마다 만들지 않고 스캔 전에 한 번 정규화한다.
  function tagList(p) {
    if (Array.isArray(p.marketTag)) return p.marketTag;
    return p.marketTag ? [p.marketTag] : [];
  }

  function score(tr, uid, p, col, tags) {
    const numEl = $('uid_usd_order_num_' + uid);
    if (numEl && numEl.value.trim() === p.orderNo) return 100; // 같은 건 재전송
    let s = 2;
    if (p.total && cellText(tr, col.price).includes(p.total)) s += 4; // 결제금액 일치
    // some(화살표함수) 는 행마다 클로저를 만든다. 여긴 README 가 매달리는 그 경로라 손으로 돈다.
    if (tags.length) {
      const info = cellText(tr, col.info);
      for (let i = 0; i < tags.length; i++) {
        if (info.indexOf(tags[i]) !== -1) {
          s += 2; // 같은 발주처
          break;
        }
      }
    }
    if (numEl && !numEl.value.trim()) s += 1;      // 아직 안 채워진 건 우선
    const st = $('uid_state_' + uid);
    if (st && st.value === STATE_PAID) s += 1;
    if (st && st.value === STATE_CANCELLED) s -= 5;
    return s;
  }

  function candidates(p) {
    const boxes = document.querySelectorAll('input.chklist[name="uid_check[]"]');
    const out = [];
    if (!boxes.length) return { rows: out, boxes };
    const table = boxes[0].closest('table');
    const col = columnIndex(table);
    const tags = tagList(p);
    for (let i = 0; i < boxes.length; i++) {
      const cb = boxes[i];
      const tr = cb.closest('tr');
      if (!tr) continue;
      // 1단계 — 수령인 칸만 읽어 거른다. 행 전체의 1/150 이라 대부분 여기서 끝난다.
      if (!cellText(tr, col.receiver).includes(p.receiver)) continue;
      // 2단계 — 살아남은 소수의 행만 나머지 칸을 읽는다.
      const s = score(tr, cb.value, p, col, tags);
      if (s > 0) out.push({ uid: cb.value, cb, tr, s });
    }
    out.sort((a, b) => b.s - a.s);
    return { rows: out, boxes, table };
  }

  // 간단메모 N번째 칸에 쓴다.
  //
  // 이 칸만 다른 칸들과 구조가 다르다. 실제로 저장되는 값은 숨어 있는
  // `uid_usd_memo_<uid>`(name="uid_usd_memo[]") **하나**뿐이고, 화면에 보이는 입력칸 3개는
  // 그 값을 줄 단위로 쪼개 놓은 편집 UI 다. 사람이 타이핑하면 사이트 쪽 핸들러가 세 칸을 도로
  // 합쳐 숨은 칸에 넣는데, 우리는 이벤트를 쏘지 않으므로(setValue 주석 참고) 그 합치기가
  // 돌지 않는다 — 보이는 칸에만 쓰면 화면에는 URL 이 보이지만 **저장하면 사라진다.**
  //
  // 그래서 보이는 칸에 넣은 뒤 숨은 칸도 같은 규칙으로 직접 다시 만든다: 빈 칸을 빼고 '\n' 로
  // 잇는다 (망고 목록 50행 전부에서 이 규칙이 맞는 것을 확인했다. 2026-08-30).
  //
  // 앞칸이 비어 있으면 URL 이 한 칸 앞으로 밀린다 — 그래서 NBSP 로 자리를 지킨다.
  //
  // URL 은 2번 칸에 넣기로 했는데(README 표), 1번 칸이 비어 있으면 숨은 칸이 'URL' 한 줄이
  // 되고 저장 후 다시 그려질 때 첫 줄이 곧 1번 칸이라 URL 이 1번에 붙는다. 빈 줄로 자리를
  // 지워 보려 했지만 **서버가 각 줄을 trim 하고 빈 줄을 버린다** — '\nURL' 도, 공백 한 칸을
  // 넣은 ' \nURL' 도 저장하면 그냥 'URL' 이 된다 (2026-08-31 실측, 저장 후 재조회로 확인).
  //
  // 그래서 앞칸을 NBSP(U+00A0) 로 채운다. 서버 trim 을 통과해 그대로 살아남는 것을 확인했고
  // (U+3000·U+200B 도 통과했다), 화면에서는 그냥 빈 칸으로 보인다. 앞칸을 채우고 나면
  // 잇는 규칙은 사이트 원래 규칙 그대로여도 결과가 같다.
  //
  // 칸을 고를 때 **레이아웃을 읽지 않는다.**
  //
  // 예전에는 `offsetParent` 로 보이는 칸만 남기고 `getBoundingClientRect().y` 로 정렬했는데,
  // 둘 다 강제 리플로우다. 요소 1.7만 개짜리 이 페이지에서는 레이아웃이 깨끗할 때 0.014ms,
  // 더러울 때 **0.065ms** 까지 튄다 — 확장이 망고를 느리게 만들 수 있는 마지막 경로였다.
  // 셀 안의 순서는 DOM 순서가 곧 화면 순서라(50행 전부에서 확인), 숨은 저장칸만 걸러내면
  // 같은 결과가 나온다. 0.002ms 이고 레이아웃 상태와 무관하다.
  function writeMemo(uid, index, value) {
    const hidden = $('uid_usd_memo_' + uid);
    if (!hidden || !hidden.parentElement) return false;
    const nodes = hidden.parentElement.querySelectorAll('input[type=text], textarea');
    const slots = [];
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i] !== hidden) slots.push(nodes[i]);
    }
    if (!slots[index]) return false;
    slots[index].value = value;
    // 앞칸이 비어 있으면 NBSP 로 자리를 지킨다 (윗주석 참고). 이게 없으면 서버가
    // 빈 줄을 버려서 URL 이 1번 칸으로 밀려 올라간다.
    for (let i = 0; i < index; i++) {
      if (slots[i].value === '') slots[i].value = MEMO_PAD;
    }
    let joined = '';
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].value === '') continue;
      joined += (joined ? '\n' : '') + slots[i].value;
    }
    hidden.value = joined;
    return true;
  }

  function apply(row, p, boxes, table) {
    const uid = row.uid;
    const st = $('uid_state_' + uid);
    if (st && st.value === STATE_CANCELLED) {
      return { ok: false, error: '해당 주문건이 반품/교환/취소완료 상태라 건드리지 않았습니다.' };
    }

    const memoWritten = writeMemo(uid, 1, p.url);

    const written = [
      setValue($('uid_usd_order_num_' + uid), p.orderNo),
      setValue($('uid_usd_order_price_' + uid), p.price),
      setValue($('uid_usd_delivery_num_' + uid), p.payDate),
      memoWritten,
    ];
    if (written.some((w) => !w)) {
      return { ok: false, error: '입력칸을 일부 찾지 못했습니다 (망고 화면 구조 변경 가능성).' };
    }
    if (st) setValue(st, STATE_DONE);

    // 저장 시 다른 행이 함께 수정되지 않도록 체크된 것을 해제하고 대상 행만 체크한다.
    // 문서 전체를 다시 훑지 않고, 후보를 고를 때 이미 모아둔 목록을 재사용한다.
    // 선택수정이 읽는 값은 uid_check[] 뿐이라 이 목록이 곧 전부다.
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].checked) boxes[i].checked = false;
    }
    // 헤더의 전체선택 체크박스도 풀어준다 (제출값은 아니지만 화면이 어긋나 보인다).
    // 표는 후보를 고를 때 이미 찾아 둔 것을 그대로 쓴다 (closest 를 다시 타지 않는다).
    const all = table && table.rows[0] && table.rows[0].querySelector('input[type=checkbox]');
    if (all && all.checked) all.checked = false;
    row.cb.checked = true;

    return { ok: true, uid };
  }

  // [선택수정] 버튼. onclick 속성으로 한 번에 집는다.
  //
  // 예전에는 a/button/input 1,543개를 돌며 innerText 를 읽었다 — 0.49ms 인 데다
  // innerText 는 요소마다 레이아웃을 강제한다. 속성 선택자는 0.02ms 다.
  // 망고가 핸들러 이름을 바꾸면 예전 방식(라벨 텍스트, 단 textContent)으로 떨어진다.
  function saveButton() {
    const el = document.querySelector('[onclick*="really_all_select_modify"]');
    if (el) return el;
    const nodes = document.querySelectorAll('a, button, input[type=button]');
    for (let i = 0; i < nodes.length; i++) {
      const label = nodes[i].textContent || nodes[i].value || '';
      if (label.trim() === '선택수정') return nodes[i];
    }
    return null;
  }

  function save() {
    const link = saveButton();
    if (!link) {
      alert('[선택수정] 버튼을 찾지 못했습니다. 직접 눌러 저장해주세요.');
      return false;
    }
    // MAIN world 스크립트가 이 신호를 받아 confirm 을 자동 승인한다 (동기 실행)
    window.dispatchEvent(new CustomEvent('LM_SUPPRESS_CONFIRM'));
    link.click();
    return true;
  }

  // 스타일은 후보 선택 UI 가 실제로 필요할 때만 한 번 주입한다 (평소 페이지에는 CSS 비용 0)
  const CSS = `
.lm-banner{position:fixed;top:0;left:0;right:0;z-index:2147483000;padding:10px 16px;
 font:600 14px/1.4 "Malgun Gothic",sans-serif;color:#fff;background:#c92a2a;text-align:center}
tr.lm-cand{outline:3px solid #f59f00;outline-offset:-3px}
.lm-pick{display:block;margin:6px 0 0;padding:4px 8px;font:600 12px/1.2 "Malgun Gothic",sans-serif;
 color:#fff;background:#f59f00;border:none;border-radius:4px;cursor:pointer}`;

  function ensureStyle() {
    if ($('lm-style')) return;
    const s = document.createElement('style');
    s.id = 'lm-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // 후보 UI 를 띄운 적이 없으면 훑을 것도 없다. run() 이 시작할 때마다 무조건 부르는
  // 자리라, 압도적으로 흔한 '한 방에 매칭' 경로에서 문서 조회 3번을 통째로 없앤다.
  let picking = false;

  function clearPicker() {
    if (!picking) return;
    picking = false;
    document.querySelectorAll('.lm-pick').forEach((e) => e.remove());
    document.querySelectorAll('tr.lm-cand').forEach((e) => e.classList.remove('lm-cand'));
    const b = $('lm-banner');
    if (b) b.remove();
  }

  function showPicker(rows, p, boxes, table) {
    ensureStyle();
    clearPicker();
    picking = true;
    const banner = document.createElement('div');
    banner.id = 'lm-banner';
    banner.className = 'lm-banner';
    banner.textContent = `"${p.receiver}" 후보가 ${rows.length}건입니다. 반영할 주문건의 [여기에 적용]을 눌러주세요.`;
    document.body.appendChild(banner);

    rows.forEach((row) => {
      row.tr.classList.add('lm-cand');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lm-pick';
      btn.textContent = '여기에 적용';
      btn.addEventListener('click', () => {
        clearPicker();
        const res = apply(row, p, boxes, table);
        if (!res.ok) alert(res.error);
        else save();
      });
      (row.cb.parentElement || row.tr.cells[0]).appendChild(btn);
    });
    rows[0].tr.scrollIntoView({ block: 'center' });
  }

  function run(p) {
    clearPicker();
    const { rows: cands, boxes, table } = candidates(p);
    if (!cands.length) {
      return { ok: false, error: `"${p.receiver}" 주문건을 이 목록에서 찾지 못했습니다.` };
    }
    const tied = cands.filter((c) => c.s === cands[0].s);
    if (tied.length > 1) {
      showPicker(tied, p, boxes, table);
      return {
        ok: false,
        needsPick: true,
        error: `"${p.receiver}" 후보가 ${tied.length}건입니다. 망고 탭에서 직접 선택해주세요.`,
      };
    }
    const res = apply(cands[0], p, boxes, table);
    // 저장은 결과를 반환한 뒤에 — confirm 승인 직후 페이지가 이동해도 결과가 유실되지 않도록
    if (res.ok) setTimeout(save, 0);
    return res;
  }

  window.__LM_MANGO__ = { run };
})();
