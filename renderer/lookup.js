/* 点词查询：只增强「日语正文」的文本节点，点击弹小浮层
 * 范围：会话/解説气泡、黄卡与例文卡的例句（.jp）
 * 不做：目标词、中文翻译/讲解、标签、按钮、输入框、回显
 */
let wordPop = null;
const lookupCache = new Map();
const LOOKUP_CACHE_MAX = 200;
const KANA = /[\u3040-\u30ff]/;
const SKIP_SEL = ".word-hit, rt, ruby > rt, .zh, .lbl, button, input, textarea, .echo, script, style";

function initLookup() {
  wordPop = document.getElementById("wordPop");
  if (!wordPop) return;
  document.addEventListener("click", (e) => {
    const hit = e.target && e.target.closest ? e.target.closest(".word-hit") : null;
    if (hit) { e.preventDefault(); e.stopPropagation(); showWordPop(hit); return; }
    if (!wordPop.contains(e.target)) hideWordPop();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideWordPop(); });
  const btn = wordPop.querySelector(".wp-say");
  if (btn) btn.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    if (typeof say === "function") say(btn.dataset.speak || "", { replay: false, interrupt: true });
  });
}

function hideWordPop() {
  if (wordPop) wordPop.classList.add("gone");
}

function showWordPop(el) {
  if (!wordPop) return;
  const word = el.dataset.word || el.textContent || "";
  const read = el.dataset.read || "";
  const base = el.dataset.base || "";
  wordPop.querySelector(".wp-word").textContent = base && base !== word ? `${word}（原形 ${base}）` : word;
  wordPop.querySelector(".wp-read").textContent = read;
  wordPop.querySelector(".wp-zh").textContent = el.dataset.zh || "";
  wordPop.querySelector(".wp-meta").textContent = el.dataset.meta || "";
  const speak = wordPop.querySelector(".wp-say");
  if (speak) {
    speak.dataset.speak = el.dataset.speak || word;
    speak.title = `朗读：${read || word}`;
  }
  wordPop.classList.remove("gone");

  const r = el.getBoundingClientRect();
  const pw = wordPop.offsetWidth, ph = wordPop.offsetHeight;
  let left = Math.min(Math.max(6, r.left), window.innerWidth - pw - 6);
  let top = r.top - ph - 6;
  if (top < 6) top = r.bottom + 6;
  wordPop.style.left = `${Math.round(left)}px`;
  wordPop.style.top = `${Math.round(top)}px`;
}

function cacheGet(text) {
  if (!lookupCache.has(text)) return undefined;
  const v = lookupCache.get(text);
  lookupCache.delete(text);                 // 命中后移到队尾（最近使用）
  lookupCache.set(text, v);
  return v;
}

function cacheSet(text, tokens) {
  if (lookupCache.has(text)) lookupCache.delete(text);
  lookupCache.set(text, tokens);
  while (lookupCache.size > LOOKUP_CACHE_MAX) {
    lookupCache.delete(lookupCache.keys().next().value);   // 淘汰最老的
  }
}

async function lookupTokens(text) {
  const hit = cacheGet(text);
  if (hit !== undefined) return hit;
  let res = null;
  try { res = await window.pet.lookup(text); } catch (e) { return null; }
  if (!res || !res.tokens) return null;     // 未预热：不缓存，下次重试
  cacheSet(text, res.tokens);
  return res.tokens;
}

function collectNodes(root, only) {
  const areas = only ? [...root.querySelectorAll(only)] : [root];
  const out = [];
  for (const area of areas) {
    const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const t = n.nodeValue || "";
        if (!t.trim()) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (!p || p.closest(SKIP_SEL)) return NodeFilter.FILTER_REJECT;
        if (!KANA.test(t) && !p.closest(".jp") && !p.closest("ruby")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) out.push(walker.currentNode);
  }
  return out;
}

/** 把日语文本节点包成可点词；只在渲染后调用 */
async function enhanceJapanese(root, { only = "" } = {}) {
  if (!root || !window.pet || !window.pet.lookup) return;
  for (const node of collectNodes(root, only)) {
    const text = node.nodeValue;
    const tokens = await lookupTokens(text);
    if (!node.isConnected || node.nodeValue !== text) continue;
    if (!tokens || !tokens.length) continue;

    const frag = document.createDocumentFragment();
    let cur = 0, changed = false;
    for (const tk of tokens) {
      if (!tk || !tk.t) continue;
      const at = text.indexOf(tk.t, cur);
      if (at < 0) break;
      if (at > cur) frag.appendChild(document.createTextNode(text.slice(cur, at)));
      if (tk.ok) {
        const sp = document.createElement("span");
        sp.className = "word-hit";
        sp.textContent = tk.t;
        sp.dataset.word = tk.t;
        sp.dataset.read = tk.r || "";
        sp.dataset.base = tk.b || tk.t;
        sp.dataset.speak = tk.kana || tk.b || tk.t;
        sp.dataset.zh = tk.zh || "";
        sp.dataset.meta = [tk.level, tk.pos].filter(Boolean).join(" · ");
        frag.appendChild(sp);
        changed = true;
      } else {
        frag.appendChild(document.createTextNode(tk.t));
      }
      cur = at + tk.t.length;
    }
    if (!changed) continue;
    if (cur < text.length) frag.appendChild(document.createTextNode(text.slice(cur)));
    node.parentNode.replaceChild(frag, node);
  }
}

initLookup();
