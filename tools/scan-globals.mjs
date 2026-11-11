/* 顶层声明扫描（供 tools/scan.mjs 与测试使用）
 *
 * 目的：找出经典脚本在同一个全局词法环境里的顶层重名。
 * 做法：去掉字符串/注释/正则，把大括号内的内容抹成空格，只留顶层代码。
 * 注意：正则字面量必须识别，否则 /['"]/ 或 /\{/ 会把后续代码吃掉。
 */

const REGEX_PREV = /[=([{,:;!&|?+\-*%^~<>]/;
const REGEX_WORD = /^(return|case|throw|typeof|instanceof|in|of|delete|void|new|yield|await|else|do)$/;

function canStartRegex(src, i, prev) {
  if (!prev) return true;
  if (REGEX_PREV.test(prev)) return true;
  const before = src.slice(0, i).match(/([A-Za-z_$][\w$]*)\s*$/);
  return !!(before && REGEX_WORD.test(before[1]));
}

/** 吃掉一个正则字面量；返回结束位置（不含），不是正则则返回 -1 */
function regexEnd(src, start) {
  let i = start + 1, inClass = false;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") { i += 2; continue; }
    if (c === "\n") return -1;
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      i++;
      while (i < src.length && /[a-z]/i.test(src[i])) i++;   // flags
      return i;
    }
    i++;
  }
  return -1;
}

/** 去掉字符串/注释/正则，把非顶层内容抹成空格 */
export function topLevelCode(src) {
  let out = "", depth = 0, i = 0, quote = "", prev = "";
  while (i < src.length) {
    const c = src[i], n = src[i + 1];

    if (quote) {
      if (c === "\\") { out += " "; i += 2; continue; }
      if (c === quote) { quote = ""; prev = c; }
      out += c === "\n" ? "\n" : " ";
      i++;
      continue;
    }

    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      i += 2;
      continue;
    }
    if (c === "/" && canStartRegex(src, i, prev)) {
      const end = regexEnd(src, i);
      if (end > i) {
        out += " ".repeat(end - i);
        prev = "/";
        i = end;
        continue;
      }
    }
    if (c === "'" || c === '"' || c === "`") { quote = c; out += " "; i++; continue; }
    if (c === "{") { depth++; out += " "; i++; continue; }
    if (c === "}") { depth = Math.max(0, depth - 1); out += " "; i++; continue; }
    if (depth === 0 && !/\s/.test(c)) prev = c;
    out += depth === 0 ? c : " ";
    i++;
  }
  return out;
}

/** 顶层声明名（const/let/var/function/class） */
export function topLevelNames(src) {
  const code = topLevelCode(src);
  const names = [];
  for (const m of code.matchAll(/(?:^|\n)\s*(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    names.push(m[1]);
  }
  return names;
}
