// The.Mango 주문관리 목록에 값 반영 + 주문상태 배송완료 + 저장
//
// 이 파일은 manifest 의 content_scripts 가 아니라, 롯데온에서 버튼을 눌렀을 때
// background 가 chrome.scripting.executeScript 로 주입한다.
// 따라서 망고 페이지를 그냥 열기만 할 때는 이 코드가 전혀 실행되지 않는다.
(() => {
  'use strict';
  if (window.__LM_MANGO__) return; // 같은 문서에 두 번 주입되어도 한 번만 초기화

  const STATE_DONE = '7';      // 배송완료
  const STATE_PAID = '2';      // 결제완료
  const STATE_CANCELLED = '9'; // 반품/교환/취소완료

  const $ = (id) => document.getElementById(id);

  function fire(el) {
    ['input', 'change', 'keyup'].forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));
  }
  function setValue(el, v) {
    if (!el) return false;
    el.value = v;
    fire(el);
    return true;
  }

  // 후보 판정에는 innerText 대신 textContent 를 쓴다.
  // innerText 는 행마다 레이아웃을 강제해서 행이 많은 목록에서 눈에 띄게 느려진다.
  function rowText(tr) {
    return tr.textContent;
  }

  function score(tr, uid, p, text) {
    if (!text.includes(p.receiver)) return -1; // 수령인 불일치 = 후보 아님
    const numEl = $('uid_usd_order_num_' + uid);
    if (numEl && numEl.value.trim() === p.orderNo) return 100; // 같은 건 재전송
    let s = 2;
    if (p.total && text.includes(p.total)) s += 4; // 결제금액 일치
    if (text.indexOf('LOTTEON') !== -1) s += 2;    // 롯데온 발주건
    if (numEl && !numEl.value.trim()) s += 1;      // 아직 안 채워진 건 우선
    const st = $('uid_state_' + uid);
    if (st && st.value === STATE_PAID) s += 1;
    if (st && st.value === STATE_CANCELLED) s -= 5;
    return s;
  }

  function candidates(p) {
    const out = [];
    const boxes = document.querySelectorAll('input.chklist[name="uid_check[]"]');
    for (let i = 0; i < boxes.length; i++) {
      const cb = boxes[i];
      const tr = cb.closest('tr');
      if (!tr) continue;
      const s = score(tr, cb.value, p, rowText(tr));
      if (s > 0) out.push({ uid: cb.value, cb, tr, s });
    }
    out.sort((a, b) => b.s - a.s);
    return out;
  }

  // 간단메모 2번째 칸: 저장 필드(uid_usd_memo_<uid>)와 같은 셀 안에서 위에서 두 번째로 보이는 입력칸.
  // 매칭된 1개 행에서만 호출하므로 레이아웃 강제는 한 번뿐이다.
  function memoSlot(uid, index) {
    const hidden = $('uid_usd_memo_' + uid);
    if (!hidden || !hidden.parentElement) return null;
    const slots = [...hidden.parentElement.querySelectorAll('input[type=text], textarea')]
      .filter((e) => e.offsetParent !== null)
      .sort((a, b) => a.getBoundingClientRect().y - b.getBoundingClientRect().y);
    return slots[index] || null;
  }

  function apply(row, p) {
    const uid = row.uid;
    const st = $('uid_state_' + uid);
    if (st && st.value === STATE_CANCELLED) {
      return { ok: false, error: '해당 주문건이 반품/교환/취소완료 상태라 건드리지 않았습니다.' };
    }

    const written = [
      setValue($('uid_usd_order_num_' + uid), p.orderNo),
      setValue($('uid_usd_order_price_' + uid), p.price),
      setValue($('uid_usd_delivery_num_' + uid), p.payDate),
      setValue(memoSlot(uid, 1), p.url),
    ];
    if (written.some((w) => !w)) {
      return { ok: false, error: '입력칸을 일부 찾지 못했습니다 (망고 화면 구조 변경 가능성).' };
    }
    if (st) setValue(st, STATE_DONE);

    // 저장 시 다른 행이 함께 수정되지 않도록 체크된 것 전부 해제 후 대상 행만 체크
    document.querySelectorAll('input[type=checkbox]:checked').forEach((c) => {
      c.checked = false;
      fire(c);
    });
    row.cb.checked = true;
    fire(row.cb);

    return { ok: true, uid };
  }

  function save() {
    const nodes = document.querySelectorAll('a, button, input[type=button]');
    let link = null;
    for (let i = 0; i < nodes.length; i++) {
      const label = nodes[i].innerText || nodes[i].value || '';
      if (label.trim() === '선택수정') {
        link = nodes[i];
        break;
      }
    }
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

  function clearPicker() {
    document.querySelectorAll('.lm-pick').forEach((e) => e.remove());
    document.querySelectorAll('tr.lm-cand').forEach((e) => e.classList.remove('lm-cand'));
    const b = $('lm-banner');
    if (b) b.remove();
  }

  function showPicker(rows, p) {
    ensureStyle();
    clearPicker();
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
        const res = apply(row, p);
        if (!res.ok) alert(res.error);
        else save();
      });
      (row.cb.parentElement || row.tr.cells[0]).appendChild(btn);
    });
    rows[0].tr.scrollIntoView({ block: 'center' });
  }

  function run(p) {
    clearPicker();
    const cands = candidates(p);
    if (!cands.length) {
      return { ok: false, error: `"${p.receiver}" 주문건을 이 목록에서 찾지 못했습니다.` };
    }
    const tied = cands.filter((c) => c.s === cands[0].s);
    if (tied.length > 1) {
      showPicker(tied, p);
      return {
        ok: false,
        needsPick: true,
        error: `"${p.receiver}" 후보가 ${tied.length}건입니다. 망고 탭에서 직접 선택해주세요.`,
      };
    }
    const res = apply(cands[0], p);
    // 저장은 결과를 반환한 뒤에 — confirm 승인 직후 페이지가 이동해도 결과가 유실되지 않도록
    if (res.ok) setTimeout(save, 0);
    return res;
  }

  window.__LM_MANGO__ = { run };
})();
