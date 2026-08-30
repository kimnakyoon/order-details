// 마켓 주문상세 페이지 공통 — 버튼 렌더 / 토스트 / 망고 전송
//
// 사이트별 스크립트(lotteon.js, ssg.js)가 이 다음에 로드되어
// __LM_SITE__.mount({ extract, anchor }) 를 호출한다.
(() => {
  'use strict';
  if (window.__LM_SITE__) return;

  function toast(msg, kind) {
    let t = document.getElementById('lm-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'lm-toast';
      document.body.appendChild(t);
    }
    t.className = 'lm-toast lm-' + (kind || 'info');
    t.textContent = msg;
    t.style.display = 'block';
    t.onclick = () => (t.style.display = 'none');
    clearTimeout(t._timer);
    // 오류는 읽을 시간이 필요하다. 눌러서 닫을 수도 있다.
    t._timer = setTimeout(() => (t.style.display = 'none'), kind === 'err' ? 60000 : 6000);
  }

  // cfg = { extract: () => payload|{error}, anchor: () => Element|null }
  function mount(cfg) {
    const btn = document.createElement('button');
    btn.id = 'lm-send-btn';
    btn.type = 'button';
    btn.textContent = '🥭 망고로 전송';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '전송 중…';
      try {
        const data = await cfg.extract();
        if (data.error) {
          toast('추출 실패: ' + data.error, 'err');
          return;
        }
        const res = await chrome.runtime.sendMessage({ type: 'SEND_TO_MANGO', payload: data });
        if (res && res.ok) {
          toast(`${data.receiver}님 주문건에 반영했습니다. 망고 탭에서 확인하세요.`, 'ok');
        } else {
          // 실패하면 무엇을 뽑아서 보냈는지 같이 보여준다.
          // 추출이 어긋났는지 망고 매칭이 어긋났는지 이걸로 구분된다.
          const seen = `수령인 "${data.receiver}" · 주문번호 ${data.orderNo} · ${data.price}원 · ${data.payDate}`;
          toast('실패: ' + ((res && res.error) || '알 수 없는 오류') + '\n보낸 값 — ' + seen, 'err');
        }
      } catch (e) {
        toast('실패: ' + e.message, 'err');
      } finally {
        btn.disabled = false;
        btn.textContent = '🥭 망고로 전송';
      }
    });

    // 지정한 위치에 버튼을 붙인다. 아직 안 그려졌으면 나타날 때까지 기다린다.
    function place() {
      if (btn.isConnected) return true;
      const el = cfg.anchor();
      if (el && el.parentElement) {
        btn.className = 'lm-btn-inline';
        el.insertAdjacentElement('afterend', btn);
        return true;
      }
      return false;
    }

    if (!place()) {
      // 로딩 중에는 DOM 변경이 쏟아진다. 변경마다 문서를 훑으면 낭비라 150ms 에 한 번으로
      // 묶는다. 버튼이 그만큼 늦게 붙지만 눈에 띄지 않고, 보통 첫 시도에 이미 붙는다.
      let queued = false;
      const obs = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        setTimeout(() => {
          queued = false;
          if (place()) obs.disconnect();
        }, 150);
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      // 끝내 못 찾으면 우측 하단 고정 버튼으로 폴백
      setTimeout(() => {
        if (!btn.isConnected) {
          obs.disconnect();
          btn.className = 'lm-btn';
          document.body.appendChild(btn);
        }
      }, 10000);
    }
  }

  window.__LM_SITE__ = { mount, toast };
})();
