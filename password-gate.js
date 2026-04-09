/**
 * Promlabs PPT Password Gate
 *
 * 클라이언트 사이드 비밀번호 게이트.
 * 페이지가 그려지기 전에 오버레이를 띄우고, 통과 시 7일 동안 기억.
 *
 * 주의: 이건 캐주얼 방문자 차단용입니다. DevTools를 쓰는 사람은 우회 가능합니다.
 * 진짜 보안이 필요하면 Cloudflare Access 같은 서버 사이드 인증을 쓰세요.
 */
(function () {
  const PASSWORD_HASHES = [
    "9d8f66ade47145a23ef1ba82d056088b20c63f9dabf871d7dd9bd9629c556690", // prom0718
    "cbfad02f9ed2a8d1e08d8f74f5303e9eb93637d47f82ab6f1c15871cf8dd0481", // 1212
  ];
  const STORAGE_KEY = "promlabs_ppt_auth";
  const TTL_DAYS = 7;

  // 이미 인증돼 있으면 통과
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      const ageMs = Date.now() - (data.ts || 0);
      if (PASSWORD_HASHES.includes(data.hash) && ageMs < TTL_DAYS * 86400000) {
        return; // 통과
      }
    }
  } catch {}

  // 컨텐츠 가리기
  const hideStyle = document.createElement("style");
  hideStyle.id = "ppt-gate-hide";
  hideStyle.textContent = "html,body{visibility:hidden!important}#ppt-gate{visibility:visible!important}";
  (document.head || document.documentElement).appendChild(hideStyle);

  // 오버레이 생성
  function buildGate() {
    const overlay = document.createElement("div");
    overlay.id = "ppt-gate";
    overlay.innerHTML = `
      <style>
        #ppt-gate {
          position: fixed; inset: 0; z-index: 999999;
          background: #0a0a0f;
          background-image: radial-gradient(circle at 1px 1px, rgba(177, 101, 251, 0.08) 1px, transparent 0);
          background-size: 40px 40px;
          display: flex; align-items: center; justify-content: center;
          font-family: "Noto Sans KR", -apple-system, sans-serif;
          color: #e8e8f0;
        }
        #ppt-gate .gate-card {
          background: rgba(13, 13, 21, 0.85);
          backdrop-filter: blur(8px);
          border: 1px solid rgba(177, 101, 251, 0.4);
          border-radius: 14px;
          padding: 36px 40px;
          width: 360px;
          max-width: calc(100vw - 32px);
          box-sizing: border-box;
          box-shadow: 0 10px 50px rgba(0, 0, 0, 0.6);
        }
        @media (max-width: 600px) {
          #ppt-gate .gate-card { padding: 28px 24px; border-radius: 12px; }
          #ppt-gate h1 { font-size: 18px !important; }
          #ppt-gate p { font-size: 12px !important; margin-bottom: 20px !important; }
        }
        #ppt-gate h1 {
          margin: 0 0 8px 0;
          font-size: 20px;
          font-weight: 700;
          background: linear-gradient(90deg, #B165FB, #5EE3D1);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        #ppt-gate p {
          margin: 0 0 24px 0;
          font-size: 13px;
          color: #8a8a9a;
          line-height: 1.55;
        }
        #ppt-gate input {
          width: 100%;
          background: #0a0a0f;
          border: 1px solid rgba(177, 101, 251, 0.3);
          border-radius: 8px;
          padding: 12px 14px;
          color: #e8e8f0;
          font-size: 14px;
          font-family: inherit;
          outline: none;
          box-sizing: border-box;
        }
        #ppt-gate input:focus { border-color: #B165FB; }
        #ppt-gate button {
          margin-top: 12px;
          width: 100%;
          background: linear-gradient(135deg, #B165FB, #5EE3D1);
          border: none;
          border-radius: 8px;
          padding: 12px;
          color: #0a0a0f;
          font-weight: 700;
          font-size: 14px;
          cursor: pointer;
          font-family: inherit;
        }
        #ppt-gate button:disabled { opacity: 0.5; cursor: not-allowed; }
        #ppt-gate .error {
          color: #FF6B9D;
          font-size: 12px;
          margin-top: 10px;
          min-height: 16px;
        }
      </style>
      <div class="gate-card">
        <h1>Promlabs Tech PPT</h1>
        <p>이 자료는 비공개입니다.<br>접근하려면 비밀번호를 입력하세요.</p>
        <input type="password" placeholder="비밀번호" autocomplete="current-password" />
        <button>입장</button>
        <div class="error"></div>
      </div>
    `;
    return overlay;
  }

  function ready(fn) {
    if (document.body) fn();
    else document.addEventListener("DOMContentLoaded", fn, { once: true });
  }

  ready(() => {
    const gate = buildGate();
    document.body.appendChild(gate);

    const input = gate.querySelector("input");
    const btn = gate.querySelector("button");
    const errEl = gate.querySelector(".error");
    input.focus();

    async function sha256(str) {
      const buf = new TextEncoder().encode(str);
      const hash = await crypto.subtle.digest("SHA-256", buf);
      return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
    }

    async function submit() {
      btn.disabled = true;
      errEl.textContent = "";
      const pw = input.value;
      if (!pw) { btn.disabled = false; return; }
      const h = await sha256(pw);
      if (PASSWORD_HASHES.includes(h)) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ hash: h, ts: Date.now() }));
        } catch {}
        // 가림 해제
        const hide = document.getElementById("ppt-gate-hide");
        if (hide) hide.remove();
        gate.remove();
      } else {
        errEl.textContent = "비밀번호가 틀렸습니다.";
        input.value = "";
        input.focus();
        btn.disabled = false;
      }
    }

    btn.addEventListener("click", submit);
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") submit();
    });
  });
})();
