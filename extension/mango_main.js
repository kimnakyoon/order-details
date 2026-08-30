// 페이지(MAIN) 컨텍스트에서 실행 — 확장이 저장을 트리거하는 동안만 confirm 을 자동 승인.
// content_scripts 로 상주하지 않고, 전송 버튼을 눌렀을 때만 주입된다.
(() => {
  'use strict';
  if (window.__LM_MAIN__) return; // 재주입 방지
  window.__LM_MAIN__ = true;
  window.addEventListener('LM_SUPPRESS_CONFIRM', () => {
    const original = window.confirm;
    window.confirm = () => true;
    setTimeout(() => {
      window.confirm = original;
    }, 3000);
  });
})();
