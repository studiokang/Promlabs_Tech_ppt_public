/**
 * Promlabs PPT Chatbot Widget
 *
 * presentation.html에 <script src="../../chatbot-widget.js"></script>로 주입.
 * 페이지 로드 시 현재 PPT의 텍스트를 추출해서 Worker에 컨텍스트로 전달.
 */
(function () {
  const WORKER_URL = "https://promlabs-ppt-chatbot.promlabs-dev.workers.dev/chat";

  // 페이지에서 PPT 텍스트 추출
  function extractPptText() {
    const slides = document.querySelectorAll(".reveal .slides section");
    const parts = [];
    slides.forEach((s, i) => {
      // 중첩 stack의 자식 section은 별도 처리되므로 stack 자체는 스킵
      if (s.classList.contains("stack")) return;
      const text = s.innerText.replace(/\s+/g, " ").trim();
      if (text) parts.push(`[슬라이드 ${i + 1}] ${text}`);
    });
    return parts.join("\n\n");
  }

  function getPptTitle() {
    return document.title || "PPT";
  }

  // 현재 보고 있는 슬라이드 정보 추출
  function getCurrentSlideInfo() {
    try {
      const reveal = window.Reveal;
      if (!reveal || typeof reveal.getCurrentSlide !== "function") return null;
      const slide = reveal.getCurrentSlide();
      if (!slide) return null;
      const indices = reveal.getIndices(slide);
      const totalH = reveal.getTotalSlides();
      const title = slide.querySelector("h1, h2, h3")?.innerText?.trim() || "";
      const text = slide.innerText.replace(/\s+/g, " ").trim().slice(0, 1500);
      return {
        index: indices.h + 1,
        total: totalH,
        title,
        text,
      };
    } catch {
      return null;
    }
  }

  // 위젯 스타일 주입
  const css = `
    .ppt-chat-fab {
      position: fixed;
      bottom: 60px;
      right: 24px;
      width: 42px;
      height: 42px;
      border-radius: 12px;
      background: rgba(13, 13, 21, 0.85);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid rgba(177, 101, 251, 0.5);
      cursor: pointer;
      box-shadow: 0 2px 12px rgba(177, 101, 251, 0.3);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #B165FB;
      transition: all 0.2s ease;
      padding: 0;
    }
    .ppt-chat-fab svg {
      width: 18px;
      height: 18px;
    }
    .ppt-chat-fab:hover {
      border-color: #B165FB;
      box-shadow: 0 4px 20px rgba(177, 101, 251, 0.6);
      color: #5EE3D1;
      transform: translateY(-1px);
    }
    .ppt-chat-panel {
      position: fixed;
      bottom: 112px;
      right: 24px;
      width: 380px;
      max-width: calc(100vw - 40px);
      height: 560px;
      max-height: calc(100vh - 120px);
      background: #0d0d15;
      border: 1px solid rgba(177, 101, 251, 0.4);
      border-radius: 14px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
      z-index: 9999;
      display: none;
      flex-direction: column;
      overflow: hidden;
      font-family: "Noto Sans KR", -apple-system, sans-serif;
    }
    .ppt-chat-panel.open { display: flex; }
    .ppt-chat-header {
      padding: 14px 18px;
      background: linear-gradient(90deg, rgba(177,101,251,0.15), rgba(94,227,209,0.1));
      border-bottom: 1px solid rgba(177,101,251,0.25);
      color: #e8e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .ppt-chat-header h3 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: #fff;
    }
    .ppt-chat-header .ppt-chat-sub {
      font-size: 11px;
      color: #8a8a9a;
      margin-top: 2px;
    }
    .ppt-chat-close {
      background: none;
      border: none;
      color: #8a8a9a;
      font-size: 20px;
      cursor: pointer;
      padding: 0;
      width: 24px;
      height: 24px;
      line-height: 1;
    }
    .ppt-chat-close:hover { color: #fff; }
    .ppt-chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .ppt-chat-msg {
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 13px;
      line-height: 1.55;
      color: #e8e8f0;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .ppt-chat-msg.user {
      align-self: flex-end;
      background: rgba(177, 101, 251, 0.2);
      border: 1px solid rgba(177, 101, 251, 0.4);
    }
    .ppt-chat-msg.bot {
      align-self: flex-start;
      background: rgba(94, 227, 209, 0.08);
      border: 1px solid rgba(94, 227, 209, 0.25);
    }
    .ppt-chat-msg.error {
      align-self: flex-start;
      background: rgba(255, 107, 157, 0.1);
      border: 1px solid rgba(255, 107, 157, 0.4);
      color: #FF6B9D;
    }
    .ppt-chat-msg code {
      background: rgba(0,0,0,0.4);
      padding: 1px 6px;
      border-radius: 3px;
      font-family: "JetBrains Mono", "Consolas", monospace;
      font-size: 12px;
      color: #5EE3D1;
    }
    .ppt-chat-msg pre {
      background: #0a0a0f;
      border: 1px solid rgba(177,101,251,0.25);
      border-radius: 6px;
      padding: 10px;
      overflow-x: auto;
      margin: 8px 0;
    }
    .ppt-chat-msg pre code {
      background: none;
      padding: 0;
      color: #e0e0ec;
    }
    .ppt-chat-input-area {
      padding: 12px;
      border-top: 1px solid rgba(177,101,251,0.25);
      display: flex;
      gap: 8px;
    }
    .ppt-chat-input {
      flex: 1;
      background: #0a0a0f;
      border: 1px solid rgba(177,101,251,0.3);
      border-radius: 8px;
      padding: 10px 12px;
      color: #e8e8f0;
      font-size: 13px;
      font-family: inherit;
      resize: none;
      outline: none;
    }
    .ppt-chat-input:focus { border-color: #B165FB; }
    .ppt-chat-send {
      background: linear-gradient(135deg, #B165FB, #5EE3D1);
      border: none;
      border-radius: 8px;
      padding: 0 16px;
      color: #0a0a0f;
      font-weight: 600;
      cursor: pointer;
      font-size: 13px;
    }
    .ppt-chat-send:disabled { opacity: 0.5; cursor: not-allowed; }
    .ppt-chat-typing {
      color: #8a8a9a;
      font-size: 12px;
      font-style: italic;
      align-self: flex-start;
      padding: 6px 12px;
    }
    .ppt-chat-empty {
      color: #8a8a9a;
      font-size: 12px;
      text-align: center;
      padding: 20px;
      line-height: 1.6;
    }
  `;
  const styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // 위젯 DOM 생성
  const fab = document.createElement("button");
  fab.className = "ppt-chat-fab";
  fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  fab.title = "PPT 챗봇";
  fab.setAttribute("aria-label", "챗봇 열기");

  const panel = document.createElement("div");
  panel.className = "ppt-chat-panel";
  panel.innerHTML = `
    <div class="ppt-chat-header">
      <div>
        <h3>PPT 챗봇</h3>
        <div class="ppt-chat-sub">이 발표 자료에 대해 질문해보세요</div>
      </div>
      <button class="ppt-chat-close" aria-label="닫기">×</button>
    </div>
    <div class="ppt-chat-messages">
      <div class="ppt-chat-empty">
        이 PPT의 내용을 기반으로 답변합니다.<br>
        예: "tmux는 왜 필요한가?", "포트포워딩 다시 설명해줘"
      </div>
    </div>
    <div class="ppt-chat-input-area">
      <textarea class="ppt-chat-input" rows="2" placeholder="질문을 입력하세요..."></textarea>
      <button class="ppt-chat-send">전송</button>
    </div>
  `;

  document.body.appendChild(fab);
  document.body.appendChild(panel);

  const messagesEl = panel.querySelector(".ppt-chat-messages");
  const inputEl = panel.querySelector(".ppt-chat-input");
  const sendBtn = panel.querySelector(".ppt-chat-send");
  const closeBtn = panel.querySelector(".ppt-chat-close");
  const emptyEl = panel.querySelector(".ppt-chat-empty");

  fab.addEventListener("click", () => {
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) inputEl.focus();
  });
  closeBtn.addEventListener("click", () => panel.classList.remove("open"));

  function addMsg(text, type) {
    if (emptyEl.parentNode) emptyEl.remove();
    const el = document.createElement("div");
    el.className = `ppt-chat-msg ${type}`;
    if (type === "bot") {
      el.innerHTML = renderMarkdown(text);
    } else {
      el.textContent = text;
    }
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  // 매우 가벼운 마크다운 (코드블록, 인라인 코드, 줄바꿈)
  function renderMarkdown(text) {
    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code>${code.replace(/\n$/, "")}</code></pre>`);
    html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    return html;
  }

  async function send() {
    const question = inputEl.value.trim();
    if (!question) return;
    inputEl.value = "";
    addMsg(question, "user");
    sendBtn.disabled = true;

    const typing = document.createElement("div");
    typing.className = "ppt-chat-typing";
    typing.textContent = "답변 생성 중...";
    messagesEl.appendChild(typing);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    try {
      const res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          pptTitle: getPptTitle(),
          pptContext: extractPptText().slice(0, 28000),
          currentSlide: getCurrentSlideInfo(),
        }),
      });
      typing.remove();
      const data = await res.json();
      if (!res.ok) {
        addMsg(data.error || `오류: ${res.status}`, "error");
      } else {
        addMsg(data.answer || "(빈 응답)", "bot");
      }
    } catch (e) {
      typing.remove();
      addMsg(`네트워크 오류: ${e.message}`, "error");
    } finally {
      sendBtn.disabled = false;
      inputEl.focus();
    }
  }

  sendBtn.addEventListener("click", send);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
})();
