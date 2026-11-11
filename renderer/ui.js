/* 渲染层的小 UI 工具：HUD / 黄卡 / 计数 / 复习标签
 *
 * 只依赖 renderer/state.js 里的 DOM 引用；不碰语音、不碰卡片内容。
 */
/* 显示 HUD / 黄卡：必须先摘掉 .gone，否则内容虽然改了但看不见
 * （#hud.gone 是 opacity:0，#note.gone 是 display:none） */
let hudTimer = null;
/** 写模式按钮里的「已学/全部」计数（固定宽度，先补零不需要，靠 CSS 对齐） */
function setCount(id, seen, total) {
  const el = document.getElementById(id);
  if (!el) return;
  if (typeof seen !== "number" || typeof total !== "number") return;
  el.textContent = `${seen}/${total}`;
}

/** 「復習」按钮的文字：只改文字节点，别把错题数徽标覆盖掉 */
function setReviewLabel(text) {
  const el = document.getElementById("reviewLabel");
  if (el) el.textContent = text;
}

function hudShow(text, ms = 1600) {
  hud.classList.remove("gone");
  hud.textContent = text;
  if (hudTimer) clearTimeout(hudTimer);
  hudTimer = ms ? setTimeout(() => hud.classList.add("gone"), ms) : null;
}
function noteShow(text) {
  noteEl.classList.remove("gone");
  noteEl.textContent = text;
}

function applyModeUI(mode = chatMode) {
  const t = MODE_UI[mode] || MODE_UI.conv;

  const g = document.getElementById("gLevel");
  if (g) g.style.display = t.gLevel ? "flex" : "none";

  const nb = document.getElementById("newbatch");
  if (nb) nb.classList.toggle("show", t.batch);

  for (const [id, show] of [["wordLvWrap", t.wordLv], ["patternLvWrap", t.patternLv]]) {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? "flex" : "none";
  }

  const rv = document.getElementById("review");
  if (rv) {
    rv.classList.toggle("show", t.review);
    if (!t.review) rv.classList.remove("active");
  }

  const wc = document.getElementById("wrongCount");
  if (wc) wc.classList.toggle("on", t.wrong && !!wc.textContent);

  alignUI();          // 对齐函数在 main() 里注入（依赖模型/按钮实测宽度）
}


/** 根据后端 info 更新「復習」按钮与进度 */
