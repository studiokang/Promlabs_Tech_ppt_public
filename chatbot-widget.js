/**
 * Promlabs PPT Chatbot Widget
 *
 * presentation.html에 <script src="../../chatbot-widget.js"></script>로 주입.
 * - 멀티턴 대화 (localStorage 저장, PPT별 격리)
 * - 스트리밍 응답 (SSE)
 * - 풀 마크다운 렌더링 (코드블록, 표, 리스트, 헤딩, 링크, 인용)
 */
(function () {
  const WORKER_URL = "https://promlabs-ppt-chatbot.promlabs-dev.workers.dev/chat";
  const HISTORY_KEY = "ppt_chat_history:" + location.pathname;
  const MAX_HISTORY_TURNS = 20;

  // -------------------- PPT 컨텍스트 추출 --------------------

  function extractPptText() {
    const slides = document.querySelectorAll(".reveal .slides section");
    const parts = [];
    slides.forEach((s, i) => {
      if (s.classList.contains("stack")) return;
      const text = s.innerText.replace(/\s+/g, " ").trim();
      if (text) parts.push(`[슬라이드 ${i + 1}] ${text}`);
    });
    return parts.join("\n\n");
  }

  function getPptTitle() {
    return document.title || "PPT";
  }

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
      return { index: indices.h + 1, total: totalH, title, text };
    } catch {
      return null;
    }
  }

  // -------------------- 히스토리 (localStorage) --------------------

  let history = [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) history = parsed.slice(-MAX_HISTORY_TURNS);
    }
  } catch {}

  function saveHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY_TURNS)));
    } catch {}
  }

  function clearHistory() {
    history = [];
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
  }

  // -------------------- 마크다운 파서 --------------------

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;");
  }

  // 인라인: **bold**, *italic*, `code`, [text](url)
  function renderInline(text) {
    let s = escapeHtml(text);
    s = s.replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`);
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) =>
      `<a href="${escapeAttr(u)}" target="_blank" rel="noopener">${t}</a>`);
    return s;
  }

  // 블록 단위 파서
  function renderMarkdown(md) {
    if (!md) return "";
    const lines = md.split("\n");
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // 코드블록
      const fence = line.match(/^```(\w*)\s*$/);
      if (fence) {
        const lang = fence[1] || "";
        i++;
        const codeLines = [];
        while (i < lines.length && !/^```\s*$/.test(lines[i])) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++; // skip closing ```
        out.push(`<pre><code class="lang-${escapeAttr(lang)}">${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        continue;
      }

      // 헤딩 (### 이상만, 위젯에선 작은 공간이니 h4 고정)
      const h = line.match(/^(#{1,6})\s+(.+)$/);
      if (h) {
        const level = Math.min(h[1].length + 3, 6); // h4~h6
        out.push(`<h${level}>${renderInline(h[2])}</h${level}>`);
        i++;
        continue;
      }

      // 인용
      if (/^>\s?/.test(line)) {
        const quoteLines = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          quoteLines.push(lines[i].replace(/^>\s?/, ""));
          i++;
        }
        out.push(`<blockquote>${renderInline(quoteLines.join(" "))}</blockquote>`);
        continue;
      }

      // 표 (header | --- | data)
      if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:-|]+\|\s*$/.test(lines[i + 1])) {
        const headerCells = line.trim().slice(1, -1).split("|").map(c => c.trim());
        i += 2; // skip header and separator
        const rows = [];
        while (i < lines.length && /^\s*\|.+\|\s*$/.test(lines[i])) {
          const cells = lines[i].trim().slice(1, -1).split("|").map(c => c.trim());
          rows.push(cells);
          i++;
        }
        let t = "<table><thead><tr>";
        headerCells.forEach(c => { t += `<th>${renderInline(c)}</th>`; });
        t += "</tr></thead><tbody>";
        rows.forEach(r => {
          t += "<tr>";
          r.forEach(c => { t += `<td>${renderInline(c)}</td>`; });
          t += "</tr>";
        });
        t += "</tbody></table>";
        out.push(t);
        continue;
      }

      // 순서 없는 리스트
      if (/^\s*[-*+]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
          i++;
        }
        out.push("<ul>" + items.map(it => `<li>${renderInline(it)}</li>`).join("") + "</ul>");
        continue;
      }

      // 순서 있는 리스트
      if (/^\s*\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
          i++;
        }
        out.push("<ol>" + items.map(it => `<li>${renderInline(it)}</li>`).join("") + "</ol>");
        continue;
      }

      // 빈 줄 → 단락 경계
      if (line.trim() === "") {
        i++;
        continue;
      }

      // 일반 단락 (연속된 텍스트 줄을 묶음)
      const paraLines = [];
      while (i < lines.length && lines[i].trim() !== "" &&
             !/^```/.test(lines[i]) &&
             !/^#{1,6}\s+/.test(lines[i]) &&
             !/^>\s?/.test(lines[i]) &&
             !/^\s*[-*+]\s+/.test(lines[i]) &&
             !/^\s*\d+\.\s+/.test(lines[i]) &&
             !/^\s*\|.+\|\s*$/.test(lines[i])) {
        paraLines.push(lines[i]);
        i++;
      }
      out.push(`<p>${renderInline(paraLines.join(" "))}</p>`);
    }

    return out.join("\n");
  }

  // -------------------- 스타일 --------------------

  const css = `
    .ppt-chat-fab {
      position: fixed; bottom: 60px; right: 24px;
      width: 42px; height: 42px; border-radius: 12px;
      background: rgba(13, 13, 21, 0.85);
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      border: 1px solid rgba(177, 101, 251, 0.5);
      cursor: pointer;
      box-shadow: 0 2px 12px rgba(177, 101, 251, 0.3);
      z-index: 9999;
      display: flex; align-items: center; justify-content: center;
      color: #B165FB;
      transition: all 0.2s ease;
      padding: 0;
    }
    .ppt-chat-fab svg { width: 18px; height: 18px; }
    .ppt-chat-fab:hover {
      border-color: #B165FB;
      box-shadow: 0 4px 20px rgba(177, 101, 251, 0.6);
      color: #5EE3D1;
      transform: translateY(-1px);
    }
    .ppt-chat-panel {
      position: fixed; bottom: 112px; right: 24px;
      width: 400px; max-width: calc(100vw - 40px);
      height: 600px; max-height: calc(100vh - 140px);
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
      padding: 12px 16px;
      background: linear-gradient(90deg, rgba(177,101,251,0.15), rgba(94,227,209,0.1));
      border-bottom: 1px solid rgba(177,101,251,0.25);
      color: #e8e8f0;
      display: flex; justify-content: space-between; align-items: center;
      gap: 8px;
    }
    .ppt-chat-header h3 {
      margin: 0; font-size: 13px; font-weight: 600; color: #fff;
    }
    .ppt-chat-header .ppt-chat-sub {
      font-size: 11px; color: #8a8a9a; margin-top: 2px;
    }
    .ppt-chat-header-btns { display: flex; gap: 4px; }
    .ppt-chat-header-btns button {
      background: none; border: none; color: #8a8a9a;
      cursor: pointer; padding: 4px 6px; border-radius: 4px;
      font-size: 11px; line-height: 1; font-family: inherit;
    }
    .ppt-chat-header-btns button:hover { color: #fff; background: rgba(255,255,255,0.06); }
    .ppt-chat-close { font-size: 18px !important; }
    .ppt-chat-messages {
      flex: 1; overflow-y: auto; padding: 14px;
      display: flex; flex-direction: column; gap: 10px;
      scroll-behavior: smooth;
    }
    .ppt-chat-msg {
      max-width: 90%;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 13px;
      line-height: 1.6;
      color: #e8e8f0;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    .ppt-chat-msg.user {
      align-self: flex-end;
      background: rgba(177, 101, 251, 0.2);
      border: 1px solid rgba(177, 101, 251, 0.4);
      white-space: pre-wrap;
    }
    .ppt-chat-msg.bot {
      align-self: flex-start;
      background: rgba(94, 227, 209, 0.06);
      border: 1px solid rgba(94, 227, 209, 0.2);
    }
    .ppt-chat-msg.error {
      align-self: flex-start;
      background: rgba(255, 107, 157, 0.1);
      border: 1px solid rgba(255, 107, 157, 0.4);
      color: #FF6B9D;
    }
    .ppt-chat-msg p { margin: 0 0 8px 0; }
    .ppt-chat-msg p:last-child { margin-bottom: 0; }
    .ppt-chat-msg h4, .ppt-chat-msg h5, .ppt-chat-msg h6 {
      margin: 10px 0 6px 0; color: #fff; font-weight: 700;
    }
    .ppt-chat-msg h4 { font-size: 14px; }
    .ppt-chat-msg h5 { font-size: 13px; }
    .ppt-chat-msg h6 { font-size: 12px; color: #5EE3D1; }
    .ppt-chat-msg ul, .ppt-chat-msg ol {
      margin: 6px 0; padding-left: 20px;
    }
    .ppt-chat-msg li { margin-bottom: 3px; }
    .ppt-chat-msg blockquote {
      margin: 6px 0; padding: 4px 10px;
      border-left: 3px solid #B165FB;
      color: #c8c8d4; font-style: italic;
      background: rgba(177,101,251,0.05);
    }
    .ppt-chat-msg a { color: #5EE3D1; text-decoration: underline; }
    .ppt-chat-msg code {
      background: rgba(0,0,0,0.5);
      padding: 1px 6px; border-radius: 3px;
      font-family: "JetBrains Mono", "Consolas", "Noto Sans KR", monospace;
      font-size: 12px; color: #5EE3D1;
    }
    .ppt-chat-msg pre {
      background: #0a0a0f;
      border: 1px solid rgba(177,101,251,0.25);
      border-radius: 6px;
      padding: 10px 12px;
      overflow-x: auto;
      margin: 8px 0;
    }
    .ppt-chat-msg pre code {
      background: none; padding: 0; color: #e0e0ec;
      font-size: 11.5px; line-height: 1.5;
      display: block; white-space: pre;
    }
    .ppt-chat-msg table {
      width: 100%; border-collapse: collapse; margin: 8px 0;
      font-size: 12px;
    }
    .ppt-chat-msg th, .ppt-chat-msg td {
      border: 1px solid rgba(177,101,251,0.2);
      padding: 5px 8px; text-align: left;
    }
    .ppt-chat-msg th {
      background: rgba(177,101,251,0.12); color: #B165FB; font-weight: 600;
    }
    .ppt-chat-msg.bot .ppt-cursor {
      display: inline-block; width: 7px; height: 13px;
      background: #5EE3D1; vertical-align: text-bottom;
      margin-left: 2px; animation: pptBlink 0.9s infinite;
    }
    @keyframes pptBlink { 0%,50% { opacity: 1; } 51%,100% { opacity: 0; } }
    .ppt-chat-input-area {
      padding: 10px 12px;
      border-top: 1px solid rgba(177,101,251,0.25);
      display: flex; gap: 8px;
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
      line-height: 1.4;
    }
    .ppt-chat-input:focus { border-color: #B165FB; }
    .ppt-chat-send {
      background: linear-gradient(135deg, #B165FB, #5EE3D1);
      border: none;
      border-radius: 8px;
      padding: 0 16px;
      color: #0a0a0f;
      font-weight: 700;
      cursor: pointer;
      font-size: 13px;
      font-family: inherit;
    }
    .ppt-chat-send:disabled { opacity: 0.5; cursor: not-allowed; }
    .ppt-chat-empty {
      color: #8a8a9a; font-size: 12px;
      text-align: center; padding: 28px 20px;
      line-height: 1.7;
    }
  `;
  const styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // -------------------- DOM --------------------

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
      <div class="ppt-chat-header-btns">
        <button class="ppt-chat-reset" title="대화 초기화">초기화</button>
        <button class="ppt-chat-close" aria-label="닫기" title="닫기">×</button>
      </div>
    </div>
    <div class="ppt-chat-messages"></div>
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
  const resetBtn = panel.querySelector(".ppt-chat-reset");

  // -------------------- 렌더링 --------------------

  function renderEmpty() {
    messagesEl.innerHTML = `
      <div class="ppt-chat-empty">
        이 PPT의 내용을 기반으로 답변합니다.<br>
        예: "이 슬라이드 요약해줘", "전체 PPT 핵심 3가지"
      </div>
    `;
  }

  function renderHistory() {
    messagesEl.innerHTML = "";
    if (history.length === 0) {
      renderEmpty();
      return;
    }
    history.forEach(m => {
      const el = document.createElement("div");
      el.className = `ppt-chat-msg ${m.role === "user" ? "user" : "bot"}`;
      if (m.role === "user") {
        el.textContent = m.content;
      } else {
        el.innerHTML = renderMarkdown(m.content);
      }
      messagesEl.appendChild(el);
    });
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendUserMsg(text) {
    const emptyEl = messagesEl.querySelector(".ppt-chat-empty");
    if (emptyEl) emptyEl.remove();
    const el = document.createElement("div");
    el.className = "ppt-chat-msg user";
    el.textContent = text;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendBotMsg() {
    const el = document.createElement("div");
    el.className = "ppt-chat-msg bot";
    el.innerHTML = '<span class="ppt-cursor"></span>';
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function appendErrorMsg(text) {
    const el = document.createElement("div");
    el.className = "ppt-chat-msg error";
    el.textContent = text;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // -------------------- 전송 (스트리밍) --------------------

  async function send() {
    const question = inputEl.value.trim();
    if (!question) return;
    inputEl.value = "";
    sendBtn.disabled = true;

    // 히스토리에 추가
    history.push({ role: "user", content: question });
    saveHistory();
    appendUserMsg(question);

    const botEl = appendBotMsg();
    let fullText = "";

    try {
      const res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.slice(-MAX_HISTORY_TURNS),
          stream: true,
          pptTitle: getPptTitle(),
          pptContext: extractPptText().slice(0, 28000),
          currentSlide: getCurrentSlideInfo(),
        }),
      });

      if (!res.ok) {
        // 에러면 JSON으로 와요
        let errMsg = `오류: ${res.status}`;
        try {
          const data = await res.json();
          errMsg = data.error || errMsg;
        } catch {}
        botEl.remove();
        appendErrorMsg(errMsg);
        // 실패한 user turn은 히스토리에서 롤백
        history.pop();
        saveHistory();
        return;
      }

      // 스트리밍 응답 파싱
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let eol;
        while ((eol = buf.indexOf("\n\n")) !== -1) {
          const block = buf.slice(0, eol);
          buf = buf.slice(eol + 2);
          const line = block.split("\n").find(l => l.startsWith("data: "));
          if (!line) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          try {
            const data = JSON.parse(jsonStr);
            if (data.error) {
              botEl.remove();
              appendErrorMsg(data.error);
              history.pop();
              saveHistory();
              return;
            }
            if (data.done) {
              // 스트림 끝
              break;
            }
            if (data.text) {
              fullText += data.text;
              botEl.innerHTML = renderMarkdown(fullText) + '<span class="ppt-cursor"></span>';
              messagesEl.scrollTop = messagesEl.scrollHeight;
            }
          } catch {}
        }
      }

      // 커서 제거, 최종 렌더링
      botEl.innerHTML = renderMarkdown(fullText);

      if (fullText) {
        history.push({ role: "assistant", content: fullText });
        saveHistory();
      } else {
        botEl.remove();
        appendErrorMsg("빈 응답을 받았어요.");
        history.pop();
        saveHistory();
      }
    } catch (e) {
      botEl.remove();
      appendErrorMsg(`네트워크 오류: ${e.message}`);
      history.pop();
      saveHistory();
    } finally {
      sendBtn.disabled = false;
      inputEl.focus();
    }
  }

  // -------------------- 이벤트 --------------------

  fab.addEventListener("click", () => {
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) {
      inputEl.focus();
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  });
  closeBtn.addEventListener("click", () => panel.classList.remove("open"));
  resetBtn.addEventListener("click", () => {
    if (!confirm("대화 기록을 모두 지울까요?")) return;
    clearHistory();
    renderEmpty();
  });

  sendBtn.addEventListener("click", send);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  // 초기 렌더
  renderHistory();
})();
