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
  //
  // **셋을 다 찾으면 거기서 끊는다.** 헤더는 7칸인데 우리가 쓰는 셋은 1·2·3번이고,
  // 그 뒤 5번 `주문상태` 칸에는 정렬 드롭다운이 들어 있어 textContent 가 들여쓰기 공백만
  // 200자가 넘는다 — `replace(/\s/g,'')` 가 이 한 칸에서 대부분의 시간을 쓴다.
  // 끊고 나면 그 칸을 아예 문자열로 만들지 않는다 (0.0042 → 0.0014ms, 2026-08-31 실측).
  //
  // 순서가 바뀌어 셋이 뒤쪽에 있어도 결과는 같다. 끊는 조건이 '몇 번째 칸까지' 가 아니라
  // '셋을 다 찾았는가' 라, 못 찾으면 예전처럼 끝까지 훑는다.

  // ── 표와 헤더는 문서당 한 번만 찾는다 (2026-08-31 실측) ────────────────────
  //
  // 이 셋(`querySelector` + `closest` + 헤더 읽기)은 **전송마다 같은 답**을 낸다. 목록을
  // 새로 검색하거나 저장이 끝나면 망고가 페이지를 통째로 다시 읽으므로(폼 POST) 그때는
  // 문서가 통째로 새것이고 이 캐시도 함께 사라진다.
  //
  //   매번 다시 찾기  0.0035 ms (최악 0.0049)
  //   캐시            0.0001 ms (최악 0.0001)
  //
  // 스캔 한 번이 0.0204 → 0.017 ms 다 (3,000회·500회 × 15시행 중앙값). [선택수정] 버튼을
  // 문서당 한 번만 찾는 것과 같은 장치이고, 같은 안전장치를 쓴다 — **낡았는지 스스로
  // 확인한다.** 표가 갈려 나갔으면 `isConnected` 가 false 라 다시 찾고, 표는 그대로인데
  // 헤더 행이 새로 그려졌으면 그 행이 다른 객체라 칸 위치를 다시 읽는다.
  let tableEl = null;
  let headEl = null;
  let colCache = null;

  function listTable() {
    if (tableEl && tableEl.isConnected) return tableEl;
    const first = document.querySelector('input.chklist[name="uid_check[]"]');
    tableEl = first ? first.closest('table') : null;
    headEl = null; // 표가 바뀌었으면 칸 위치도 다시 읽는다
    return tableEl;
  }

  function columnIndex(table) {
    const head = table && table.rows[0];
    if (!head) return { receiver: -1, price: -1, info: -1 };
    if (headEl === head) return colCache;
    const col = { receiver: -1, price: -1, info: -1 };
    let left = 3;
    for (let i = 0; i < head.cells.length && left; i++) {
      const s = head.cells[i].textContent.replace(/\s/g, '');
      if (col.receiver < 0 && s.indexOf('수령인') === 0) {
        col.receiver = i;
        left--;
      } else if (col.price < 0 && s.indexOf('결제금액') === 0) {
        col.price = i;
        left--;
      } else if (col.info < 0 && s.indexOf('주문번호') === 0) {
        col.info = i;
        left--;
      }
    }
    headEl = head;
    colCache = col;
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

  // 상품주문번호 칸은 **한 번만** trim 한다. 예전에는 '같은 주문번호인가' 와 '아직 비었는가' 를
  // 각각 `numEl.value.trim()` 으로 확인해서, 후보 행마다 같은 문자열을 두 번 만들었다.
  // 한 번 만들어 두면 판정은 글자 그대로 같고(50행 전부에서 결과가 일치하는 것을 확인),
  // 후보가 많을 때의 최악값이 줄어든다 — 50행이 전부 후보인 최악에서 0.098 → 0.090ms
  // (300회 × 15시행 × 3회차 중앙값, 2026-08-31 실측). 흔한 0·1건 경로는 원래도 거의 0이다.
  function score(tr, uid, p, col, tags) {
    const numEl = $('uid_usd_order_num_' + uid);
    const cur = numEl ? numEl.value.trim() : null;
    if (cur === p.orderNo) return 100; // 같은 건 재전송
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
    if (cur === '') s += 1;                        // 아직 안 채워진 건 우선
    const st = $('uid_state_' + uid);
    if (st && st.value === STATE_PAID) s += 1;
    if (st && st.value === STATE_CANCELLED) s -= 5;
    return s;
  }

  // 행의 체크박스. 첫 칸 안에서만 찾으므로 문서를 훑지 않는다.
  const rowBox = (tr) => {
    const c = tr.cells[0];
    return c ? c.querySelector('input.chklist') : null;
  };

  // 행 목록은 **표에서** 얻는다 (`table.rows`). 문서 전체를 훑지 않는다.
  //
  // 예전에는 `querySelectorAll('input.chklist[name="uid_check[]"]')` 로 체크박스 50개를 먼저
  // 모으고 각각 `closest('tr')` 로 행을 거슬러 올라갔다. 그 두 단계가 스캔 시간의 **절반**이었다
  // (요소 16,697개 목록에서 문서 조회 0.035ms + closest 50번 0.012ms).
  //
  // 그런데 후보 판정의 1단계는 **수령인 칸 하나**만 본다. 체크박스는 그 관문을 통과한 소수의
  // 행에만 필요하다. 그래서 `table.rows`(51행)를 돌며 수령인 칸부터 읽고, 살아남은 행에서만
  // 첫 칸의 체크박스를 집는다. 표를 찾는 데 드는 문서 조회는 **하나(첫 체크박스)** 뿐이고,
  // 그것도 `listTable()` 이 문서당 한 번만 낸다 (윗절).
  //
  // `table.rows` 는 라이브 컬렉션이라 DOM 이 바뀌면 캐시가 식지만, 다시 만드는 비용이 문서가
  // 아니라 **그 표의 행 수**에 묶인다 — 실측 0.031ms(식음) / 0.029ms(따뜻함)로 차이가 없다.
  // 문서 전체를 훑는 라이브 컬렉션(`getElementsByName`)이 식었을 때 0.38ms 로 튀는 것과 다르다.
  // 그래서 롯데아이몰에서 라이브 컬렉션을 피한 이유(최악이 튄다)가 여기서는 걸리지 않는다.
  //
  // 헤더 행(0번)도 그냥 같이 돈다. 수령인 칸이 `수령인` 이라 이름과 겹칠 일이 없고, 겹치더라도
  // 첫 칸에 체크박스가 없어 걸러진다 — 행을 체크박스로 찾던 예전과 결과가 같다.
  function candidates(p) {
    const out = [];
    const table = listTable();
    if (!table) return { rows: out, table: null };
    const col = columnIndex(table);
    const tags = tagList(p);
    const trs = table.rows;

    // 1단계는 **행마다 도는 유일한 구간**이라 여기서만 손으로 편다.
    //
    // `cellText()` 호출과 그 안의 조건 두 번, `col.receiver`·`p.receiver`·`trs.length`
    // property 로드가 행마다 붙는다. 51행이면 각각 51번이다. 편 쪽이 꾸준히 20% 싸고,
    // 무엇보다 **최악값이 좁아진다** — 0.0184 / 최악 0.038 → 0.0145 / 최악 0.020ms
    // (500회 × 15시행 × 3회차 중앙값, 2026-08-31 실측).
    //
    // 폴백 규칙은 `cellText()` 와 글자 그대로 같다: 칸 위치를 못 찾았거나(-1) 그 칸이 없으면
    // 행 전체 텍스트로 떨어진다. `cellText()` 자체는 그대로 둔다 — `score()` 에서 결제금액·
    // 주문번호 칸을 읽는 데 쓰는데, 그쪽은 1단계를 통과한 소수의 행에서만 돈다.
    //
    // `trs.length` 를 밖으로 뺐지만 루프 안에서 DOM 을 바꾸지 않으므로(읽기만 한다)
    // 라이브 컬렉션의 길이가 도중에 달라질 일이 없다.
    const rc = col.receiver;
    const who = p.receiver;
    // 마스킹된 수령인은 '*' 를 와일드카드로 본다. W컨셉은 주문상세에 이름을 '최*영' 처럼
    // 가려 내려주는데, 망고 목록에는 실명이 들어 있어 부분일치(includes)로는 걸러지지 않는다.
    // '*' 를 '.+' 로 바꿔 성+끝글자로 좁힌다 ('최*영' → /최.+영/). 결제금액이 뒤에서 +4 로
    // 후보를 마저 가르고, 그래도 동점이면 선택창이 뜬다.
    //
    // '*' 가 없는 나머지 사이트는 rx 가 null 이라 예전 그대로 includes 를 탄다 — 정규식을
    // 만들지도, 테스트하지도 않는다. 정규식은 루프 밖에서 딱 한 번 만든다 (행마다 도는 1단계
    // 비용은 그대로).
    const rx =
      who.indexOf('*') !== -1
        ? new RegExp(who.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.+'))
        : null;
    const n = trs.length;
    for (let i = 0; i < n; i++) {
      const tr = trs[i];
      // 1단계 — 수령인 칸만 읽어 거른다. 행 전체의 1/150 이라 대부분 여기서 끝난다.
      const cell = rc >= 0 ? tr.cells[rc] : null;
      const str = cell ? cell.textContent : tr.textContent;
      if (rx ? !rx.test(str) : !str.includes(who)) continue;
      // 2단계 — 살아남은 소수의 행만 체크박스와 나머지 칸을 읽는다.
      const cb = rowBox(tr);
      if (!cb) continue;
      const s = score(tr, cb.value, p, col, tags);
      if (s > 0) out.push({ uid: cb.value, cb, tr, s });
    }
    out.sort((a, b) => b.s - a.s);
    return { rows: out, table };
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

  function apply(row, p, table) {
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
    // 문서를 다시 훑지 않고 후보를 고를 때 찾아 둔 표의 행만 돈다. 선택수정이 읽는 값은
    // uid_check[] 뿐이라 이 표의 체크박스가 곧 전부다.
    //
    // 스캔에서 체크박스를 모으지 않게 됐으니(candidates 주석) 여기서 행마다 집는다 — 0.013ms 다.
    // 문서 조회로 모으면 0.026~0.028ms 라 이쪽이 싸고, 매칭에 실패한 전송에서는 아예 돌지 않는다.
    //
    // ── 더 빨라 보이는 두 방법을 재보고 버렸다 (2026-08-31 실측) ────────────────
    //
    // 50개를 한 번에 집는 라이브 컬렉션이 warm 일 때는 4배 빠르다. 그런데 **DOM 이 한 번이라도
    // 바뀌면** 캐시가 날아가면서 문서 크기(요소 16,697개)에 묶인 비용으로 되돌아간다.
    //
    //   행마다 querySelector (지금)        warm 0.0134ms   DOM 바뀐 뒤 0.0136ms
    //   table.getElementsByClassName        warm 0.0032ms   DOM 바뀐 뒤 0.3892ms  (122배)
    //   form.elements['uid_check[]']        warm 0.0042ms   DOM 바뀐 뒤 0.8964ms  (213배)
    //
    // 그리고 이 자리는 **DOM 이 막 바뀐 직후일 확률이 높다** — 바로 위에서 writeMemo 가 값을
    // 넣고, 후보 UI 를 띄웠던 전송이라면 clearPicker() 가 요소를 지우고 시작한다.
    // 롯데아이몰에서 라이브 컬렉션을 피한 것과 같은 이유다: 평균이 아니라 **최악이 안 튀는 쪽**.
    // 지금 방식은 warm/cold 차이가 없다 (0.0134 / 0.0136ms).
    const trs = table ? table.rows : [];
    for (let i = 0; i < trs.length; i++) {
      const cb = rowBox(trs[i]);
      if (cb && cb.checked) cb.checked = false;
    }
    // 헤더의 전체선택 체크박스도 풀어준다 (제출값은 아니지만 화면이 어긋나 보인다).
    // 이건 `.chklist` 가 아니라 별도 클래스라 위 루프에 걸리지 않는다.
    const all = table && table.rows[0] && table.rows[0].querySelector('input[type=checkbox]');
    if (all && all.checked) all.checked = false;
    row.cb.checked = true;

    return { ok: true, uid };
  }

  // [선택수정] 버튼. onclick 속성으로 한 번에 집는다.
  //
  // 예전에는 a/button/input 1,543개를 돌며 innerText 를 읽었다 — 0.49ms 인 데다
  // innerText 는 요소마다 레이아웃을 강제한다. 속성 선택자는 그보다 30배 싸다.
  //
  // **클래스로 먼저 좁힌다.** `[onclick*=…]` 만 쓰면 인덱스가 없어 문서(요소 16,697개)를
  // 순서대로 훑는다. 앞에 `a.defbtn_med` 를 붙이면 브라우저가 클래스 인덱스로 후보를 32개까지
  // 줄인 뒤 그 안에서만 속성을 본다 — 0.0155 → 0.0080ms (400회 × 15시행 × 3회차 중앙값,
  // 2026-08-31 실측).
  //
  // 못 찾으면 **클래스 없는 예전 선택자**로, 그것도 아니면 라벨 텍스트로 떨어진다. 망고가
  // 버튼 클래스를 바꾸든 핸들러 이름을 바꾸든 한 단계씩 물러나며 계속 찾는다.
  //
  // 이 비용은 **한 문서에서 한 번만** 낸다. 버튼은 목록을 다시 그리지 않는 한 그대로 있다.
  // 목록을 새로 검색하면 문서가 통째로 바뀌므로(전체 페이지 이동) 이 캐시도 함께 사라진다.
  // 그 사이에 사라졌다면 `isConnected` 가 false 라 다시 찾는다.
  const SAVE_CALL = '[onclick*="really_all_select_modify"]';
  let saveEl = null;

  function saveButton() {
    if (saveEl && saveEl.isConnected) return saveEl;
    saveEl = document.querySelector('a.defbtn_med' + SAVE_CALL) || document.querySelector(SAVE_CALL);
    if (saveEl) return saveEl;
    const nodes = document.querySelectorAll('a, button, input[type=button]');
    for (let i = 0; i < nodes.length; i++) {
      const label = nodes[i].textContent || nodes[i].value || '';
      if (label.trim() === '선택수정') {
        saveEl = nodes[i];
        return saveEl;
      }
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

  function showPicker(rows, p, table) {
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
        const res = apply(row, p, table);
        if (!res.ok) alert(res.error);
        else save();
      });
      (row.cb.parentElement || row.tr.cells[0]).appendChild(btn);
    });
    rows[0].tr.scrollIntoView({ block: 'center' });
  }

  function run(p) {
    clearPicker();
    const { rows: cands, table } = candidates(p);
    if (!cands.length) {
      return { ok: false, error: `"${p.receiver}" 주문건을 이 목록에서 찾지 못했습니다.` };
    }
    const tied = cands.filter((c) => c.s === cands[0].s);
    if (tied.length > 1) {
      showPicker(tied, p, table);
      return {
        ok: false,
        needsPick: true,
        error: `"${p.receiver}" 후보가 ${tied.length}건입니다. 망고 탭에서 직접 선택해주세요.`,
      };
    }
    const res = apply(cands[0], p, table);
    // 저장은 결과를 반환한 뒤에 — confirm 승인 직후 페이지가 이동해도 결과가 유실되지 않도록
    if (res.ok) setTimeout(save, 0);
    return res;
  }

  window.__LM_MANGO__ = { run };
})();
