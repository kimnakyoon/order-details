// 더현대Hi(hi.thehyundai.com) 주문상세 페이지 -> 망고 전송용 값 추출
//
// ── 금액·일시는 '결제수단 & 승인내역' 에서 읽는다 ────────────────────────────
//
//   결제정보                        결제수단 & 승인내역
//     상품금액       10,000원         네이버페이   10,590원
//     할인금액       -2,000원         H.Point         410원
//     판매금액        8,000원         승인일시   2026.08.27 07:42:09
//     배송비          3,000원         승인금액       10,590원
//     포인트 사용       -410P
//     총 결제 금액   10,590원
//
// 결제금액은 **승인금액**, 결제일시는 **승인일시** 다. 왼쪽 '총 결제 금액' 과 값이 같아 보여도
// 신고 기준은 실제로 승인이 떨어진 금액이라 그쪽에서 읽는다. 승인 블록은 결제수단마다 붙으므로
// 합산한다 — H.Point 처럼 승인 블록이 없는 수단은 자연히 빠지는데, 롯데온에서 L.POINT 를
// SSG 에서 SSG MONEY 를 빼는 규칙과 결이 같다. 승인일시는 첫 번째 것을 쓴다.
//
// 취소된 주문에는 '결제수단 & 승인내역' 섹션이 아예 없다 ('환불 정보' 가 대신 붙는다).
// 그래서 승인금액을 못 찾고 멈추는데, 취소건은 어차피 망고에 보낼 게 아니라 그대로 둔다.
//
// 값은 전부 `<dl><dt>라벨</dt><dd>값</dd></dl>` 꼴이다. 클래스는 CSS 모듈 해시
// (`PaymentApprovalInfo_appr__Fm5Jy`)라 빌드마다 바뀌므로 쓰지 않고 **라벨 텍스트**로 찾는다.
// 문서 전체의 `dt` 가 16개뿐이라(요소 507개짜리 가벼운 페이지다) 한 번 훑는 게 가장 싸다.
//
// ── 수령인은 화면에 없다 ─────────────────────────────────────────────────────
//
// 배송지의 받는 분이 `서*애` 로 마스킹되어 있고, 옆의 [마스킹 해제] 는 휴대폰·네이버·카카오·
// 토스 **본인인증**을 요구한다. 망고는 수령인 이름으로 행을 찾으므로(README '주문건 매칭')
// 마스킹된 이름을 보내면 아무 행도 잡히지 않는다.
//
// 그런데 서버가 화면을 그리라고 보낸 RSC 페이로드에는 마스킹 전 이름이 **그대로 들어 있다** —
// 주문상품 항목의 `rcvnCustNm` 이 원본이고, 배송지 블록의 같은 이름과 `maskedRcvnCustNm` 이
// 마스킹본이다. 그래서 `*` 가 없는 첫 `rcvnCustNm` 을 쓴다.
//
// ── SPA — 문서에 박힌 페이로드는 '처음 읽은 문서' 것뿐이다 ───────────────────
//
// 주문목록에서 [주문상세] 를 누르면 문서를 다시 읽지 않고 넘어간다(Next.js App Router).
// 그때 RSC 페이로드는 fetch 로 받아 화면만 갈아끼우고, 문서 안의 `self.__next_f` 스크립트는
// **처음 읽은 문서 것 그대로 남는다.** 그걸 그냥 믿으면 A 를 열어 둔 채 B 로 넘어갔을 때
// A 의 수령인을 B 의 주문번호와 함께 보내게 된다 — 조용히 틀리는 쪽이라 제일 위험하다.
//
// 그래서 **지금 주문번호를 함께 담고 있는 스크립트에서만** 읽고, 없으면 그 주문의 페이지를
// 다시 받아서 읽는다. 주소로 바로 들어왔으면 인라인이 맞아떨어져 요청이 아예 없고, 목록에서
// 눌러 넘어왔으면 한 번 받는다(57KB · 실측 133ms). 그 왕복이 `전송 중…` 으로 보이지 않도록
// **버튼이 붙는 순간 미리 받아 둔다** (지마켓과 같은 방식).
//
// `RSC: 1` 헤더를 붙이면 HTML 없이 플라이트만 41KB 로 받을 수 있지만(실측 146ms — HTML 과
// 차이가 없다) 그건 Next.js 내부 규약이라 버전이 바뀌면 조용히 깨진다. 브라우저가 새로고침할
// 때 받는 것과 같은 HTML 을 받는다.
//
// ── SPA — 그래서 사이트 전체에 건다 ─────────────────────────────────────────
//
// 문서를 다시 읽지 않는다는 말은 **content script 도 다시 주입되지 않는다**는 말이다.
// 주입되는 건 브라우저가 문서를 읽은 그 한 번뿐이고, 그 뒤의 이동은 전부 화면만 갈아끼운다.
//
// `/mypage/*` 에만 걸면 마이페이지 안에서 오가는 건 잡히지만 **밖에서 들어오는 길이 빠진다.**
// 물건을 사고 주문완료에서 주문상세로 넘어가거나, 홈피드·상품에서 마이페이지로 들어가면
// 문서를 읽은 곳이 `/mypage/*` 가 아니라 스크립트가 아예 없다 — 버튼이 안 나오고, 새로고침해야
// (그제서야 `/mypage/*` 주소로 문서를 읽으니까) 나온다. 실제로 그렇게 걸렸다.
//
// 그래서 `hi.thehyundai.com` 전체에 건다. SPA 경계가 마이페이지가 아니라 사이트 전체이므로
// 매칭 범위도 거기에 맞춰야 한다. 주문상세가 아닌 화면에서는 `anchor()` 가 `ordNo` 가 없는 걸
// 보고 바로 `null` 을 주므로 버튼은 붙지 않는다.
//
// 값싸다 — 홈피드(요소 488)와 상품 상세(요소 1,126)에서 5초씩 굴려 보니(무한스크롤 포함)
// watch 틱이 **0번** 돌았다. 그 화면들은 뜬 뒤로 DOM 을 건드리지 않아 옵저버가 깨지도 않는다.
(() => {
  'use strict';

  // 정규식은 부를 때마다 다시 만들지 않는다.
  const APPR_DATE = /(20\d\d)\.(\d{2})\.(\d{2})\s+(\d{2}:\d{2}:\d{2})/;
  // 플라이트는 HTML 안에서 자바스크립트 문자열 리터럴이라 따옴표가 `\"` 로 이스케이프된다.
  const RCVN = /\\?"rcvnCustNm\\?"\s*:\s*\\?"([^"\\]+)/g;

  // 부호를 살린다. 취소 승인이 `-28,000원` 으로 붙는 자리가 있어서(결제정보 변경 내역이 그렇다)
  // 절댓값으로 더하면 취소분이 매입처럼 보태진다. 빼는 쪽으로 두면 합이 0 이 되어 오류로 잡힌다.
  const num = (s) => {
    const t = String(s);
    const n = parseInt(t.replace(/[^\d]/g, ''), 10) || 0;
    return /-\s*[\d,]/.test(t) ? -n : n;
  };

  // watch 틱마다 불린다. 주소는 좀처럼 안 바뀌므로 `location.search` 가 그대로면 그대로 돌려준다
  // — 사이트 전체에 걸린 뒤로는 주문상세가 아닌 화면에서도 도는 함수라 매번 URLSearchParams 를
  // 새로 만들 이유가 없다.
  let seenSearch = null;
  let seenOrdNo = '';
  const ordNo = () => {
    const q = location.search;
    if (q !== seenSearch) {
      seenSearch = q;
      seenOrdNo = (new URLSearchParams(q).get('ordNo') || '').trim();
    }
    return seenOrdNo;
  };

  const pageUrl = (no) => 'https://hi.thehyundai.com/mypage/order/detail?ordNo=' + no;

  // 브라우저가 **문서를 실제로 읽어 온 주소**의 주문번호. 인라인 플라이트가 누구 것인지는
  // 이걸로 정해진다 (inline() 참고). 문서마다 한 번만 구하면 되고 바뀌지 않는다.
  // `null` = 알 수 없음 (그러면 예전처럼 뒤져 본다), `''` = 그 주소에 ordNo 가 없었다.
  const docOrdNo = (() => {
    const nav = performance.getEntriesByType('navigation')[0];
    if (!nav || !nav.name) return null;
    const q = nav.name.indexOf('?');
    if (q === -1) return '';
    return (new URLSearchParams(nav.name.slice(q)).get('ordNo') || '').trim();
  })();

  // '2026.08.27 07:42:09' 을 그대로 쓴다. 형태가 어긋나면 빈 값 -> 오류로 잡힌다.
  function when(s) {
    const m = String(s).match(APPR_DATE);
    return m ? `${m[1]}.${m[2]}.${m[3]} ${m[4]}` : '';
  }

  // 필요한 라벨을 한 번에 긁는다. 버튼 자리(주문번호 칸)도 여기서 같이 집는다.
  function labels() {
    const r = { price: 0, payDate: '', total: '', ordDd: null };
    const dts = document.getElementsByTagName('dt');
    for (let i = 0; i < dts.length; i++) {
      const key = dts[i].textContent.replace(/\s/g, '');
      const dd = dts[i].nextElementSibling;
      if (!dd || dd.tagName !== 'DD') continue;
      if (key === '승인금액') r.price += num(dd.textContent);
      else if (key === '승인일시' && !r.payDate) r.payDate = when(dd.textContent);
      else if (key === '주문번호' && !r.ordDd) r.ordDd = dd;
      // '총 결제 금액' 라벨 뒤에는 [자세히] 버튼 글자가 붙어 있어 완전일치로는 안 잡힌다.
      else if (!r.total && key.indexOf('총결제금액') === 0) {
        r.total = (dd.textContent.match(/[\d,]+/) || [''])[0];
      }
    }
    return r;
  }

  // ── 수령인 ─────────────────────────────────────────────────────────────
  //
  // 마스킹본(`서*애`)과 원본이 같은 키로 여러 번 나온다. `*` 가 없는 첫 값이 원본이다.
  function pick(text) {
    RCVN.lastIndex = 0;
    let m;
    while ((m = RCVN.exec(text))) {
      const v = m[1].trim();
      if (v && v.indexOf('*') === -1) return v;
    }
    return '';
  }

  // 문서에 박혀 있는 플라이트. **지금 주문번호를 함께 담고 있을 때만** 믿는다 (윗주석 참고).
  //
  // 그런데 담고 있을 수 있는 문서는 애초에 하나뿐이다. Next.js 가 `self.__next_f` 스크립트를
  // 붙이는 건 **문서를 스트리밍하는 동안**뿐이고, 클라이언트 이동은 fetch 로 받아 화면만
  // 갈아끼울 뿐 스크립트를 새로 붙이지 않는다. 그러니 문서를 읽어 온 주소가 이 주문이 아니면
  // 나올 리가 없다 — 스크립트 97개(54KB)를 전부 문자열로 만들어 훑는 일을 통째로 건너뛰고
  // 바로 받으러 간다. 목록·홈피드에서 눌러 들어온 경로가 전부 여기에 해당한다.
  function inline(no) {
    if (docOrdNo !== null && docOrdNo !== no) return '';
    const s = document.getElementsByTagName('script');
    for (let i = 0; i < s.length; i++) {
      const t = s[i].textContent;
      if (!t || t.indexOf(no) === -1 || t.indexOf('rcvnCustNm') === -1) continue;
      const v = pick(t);
      if (v) return v;
    }
    return '';
  }

  async function load(no) {
    const r = await fetch(pageUrl(no), { credentials: 'same-origin' });
    if (!r.ok) throw new Error('응답 ' + r.status);
    return pick(await r.text());
  }

  // 지금 보고 있는 주문 하나만 들고 있고, 화면을 떠나면 버린다 (지마켓과 같은 방식).
  let cache = { no: '', name: null };
  let asked = '';

  function receiver(no) {
    if (cache.no !== no) cache = { no, name: null };
    if (!cache.name) {
      const v = inline(no);
      cache.name = v ? Promise.resolve(v) : load(no);
    }
    // 실패한 응답을 물고 있지 않는다 — 다음 클릭은 새로 받는다.
    return cache.name.catch((e) => {
      if (cache.no === no) cache.name = null;
      throw e;
    });
  }

  function prefetch(no) {
    if (!no || asked === no) return;
    asked = no;
    receiver(no).catch(() => {}); // 실패해도 조용히 — 클릭할 때 다시 받는다
  }

  function forget() {
    if (!asked && !cache.no) return;
    asked = '';
    cache = { no: '', name: null };
  }

  // 값을 못 찾았을 때 화면이 실제로 뭘 담고 있었는지 오류에 같이 실어 보낸다.
  function probe() {
    const dts = document.getElementsByTagName('dt');
    const out = [];
    const flat = (el) => el.textContent.replace(/\s+/g, ' ').trim();
    for (let i = 0; i < dts.length && out.length < 20; i++) {
      const dd = dts[i].nextElementSibling;
      out.push(flat(dts[i]) + ' = ' + (dd && dd.tagName === 'DD' ? flat(dd) : '?'));
    }
    return '\n[항목] ' + (out.join(' / ') || '(없음)');
  }

  async function extract() {
    const no = ordNo();
    if (!no) return { error: '주문상세 화면이 아닙니다 (ordNo 를 찾지 못했습니다).' };

    const v = labels();
    if (v.price <= 0) return { error: '승인금액을 찾지 못했습니다.' + probe() };
    if (!v.payDate) return { error: '승인일시를 찾지 못했습니다.' + probe() };

    let who;
    try {
      who = await receiver(no); // 대개 이미 받아 둔 값이라 기다리지 않는다
    } catch (e) {
      return { error: '수령인을 불러오지 못했습니다 — ' + e.message };
    }
    if (!who) return { error: '수령인(배송지 받는 분)을 찾지 못했습니다.' + probe() };

    return {
      url: pageUrl(no),
      orderNo: no, // 260827001839005
      price: String(v.price), // 숫자만 — 승인금액
      payDate: v.payDate, // 2026.08.27 07:42:09 — 승인일시
      receiver: who,
      total: v.total, // "10,590" — 망고 행 매칭 보조키
      // marketTag 없음 — 지마켓·패션플러스·롯데아이몰과 같은 사정. 망고의 발주처 슬롯은
      // `[LOTTEON.com]` `[SSG.com]` 처럼 도메인 꼴로 찍히는데 더현대 발주건이 아직 목록에
      // 없어 어떤 표기가 붙는지 확인하지 못했다. 맞지 않는 태그는 점수를 못 얻으면서
      // 후보 행마다 비교 비용만 늘린다 (README 실측).
    };
  }

  // ── 버튼 자리 = 상단 '주문번호 260827001839005' 의 복사 버튼 뒤 ─────────────
  //
  // SPA 라 watch 가 이 함수를 주기적으로 부른다. 매번 dt 를 훑지 않도록 찾은 요소를 캐시하고,
  // 찾아 둔 주문이 그대로이고 요소가 아직 붙어 있는 동안에는 그대로 돌려준다 (무신사와 같다).
  let cached = null;
  let cachedNo = '';

  function anchor() {
    const no = ordNo();
    if (!no) {
      // 주문상세가 아닌 화면이다 — 버튼을 떼고 받아 둔 수령인도 버린다.
      cached = null;
      cachedNo = '';
      forget();
      return null;
    }
    // 어느 주문에서 찾아 둔 자리인지를 기억한다. 예전에는 칸의 `textContent` 에 지금 주문번호가
    // 들어 있는지로 판단했는데, 그건 틱마다 칸을 문자열로 새로 만드는 일이었다. 다시 찾을 때를
    // 정하는 데 쓰일 뿐이라 주문번호를 들고 있으면 똑같이 판별되고 문자열은 만들지 않는다.
    if (cachedNo !== no || !cached || !cached.isConnected) {
      const dd = labels().ordDd;
      // 복사 버튼 뒤에 붙여야 번호와 같은 줄에 들어간다. 없으면 번호 뒤에 붙인다.
      cached = dd && (dd.querySelector('button') || dd.querySelector('p'));
      if (!cached) return null;
      cachedNo = no;
    }
    // 버튼 자리가 있다 = 주문상세가 그려졌다. 이때 수령인을 미리 받아 둔다.
    prefetch(no);
    return cached;
  }

  window.__LM_SITE__.mount({ extract, anchor, watch: true });
})();
