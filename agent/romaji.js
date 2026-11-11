/* 假名 → 罗马字（Hepburn 风格），用于提示「键盘上怎么打」
 * 目的不是学术转写，而是让学习者知道 IME 里敲什么能出这个音。
 */

const BASIC = {
  あ:"a",い:"i",う:"u",え:"e",お:"o",
  か:"ka",き:"ki",く:"ku",け:"ke",こ:"ko",
  が:"ga",ぎ:"gi",ぐ:"gu",げ:"ge",ご:"go",
  さ:"sa",し:"shi",す:"su",せ:"se",そ:"so",
  ざ:"za",じ:"ji",ず:"zu",ぜ:"ze",ぞ:"zo",
  た:"ta",ち:"chi",つ:"tsu",て:"te",と:"to",
  だ:"da",ぢ:"ji",づ:"zu",で:"de",ど:"do",
  な:"na",に:"ni",ぬ:"nu",ね:"ne",の:"no",
  は:"ha",ひ:"hi",ふ:"fu",へ:"he",ほ:"ho",
  ば:"ba",び:"bi",ぶ:"bu",べ:"be",ぼ:"bo",
  ぱ:"pa",ぴ:"pi",ぷ:"pu",ぺ:"pe",ぽ:"po",
  ま:"ma",み:"mi",む:"mu",め:"me",も:"mo",
  や:"ya",ゆ:"yu",よ:"yo",
  ら:"ra",り:"ri",る:"ru",れ:"re",ろ:"ro",
  わ:"wa",ゐ:"i",ゑ:"e",を:"wo",ん:"n",
  ぁ:"a",ぃ:"i",ぅ:"u",ぇ:"e",ぉ:"o",
  ゃ:"ya",ゅ:"yu",ょ:"yo",ゎ:"wa",
  ゔ:"vu",ゕ:"ka",ゖ:"ke",
};

const DIGRAPH = {
  "きゃ":"kya","きゅ":"kyu","きょ":"kyo",
  "ぎゃ":"gya","ぎゅ":"gyu","ぎょ":"gyo",
  "しゃ":"sha","しゅ":"shu","しょ":"sho",
  "じゃ":"ja","じゅ":"ju","じょ":"jo",
  "ちゃ":"cha","ちゅ":"chu","ちょ":"cho",
  "ぢゃ":"ja","ぢゅ":"ju","ぢょ":"jo",
  "にゃ":"nya","にゅ":"nyu","にょ":"nyo",
  "ひゃ":"hya","ひゅ":"hyu","ひょ":"hyo",
  "びゃ":"bya","びゅ":"byu","びょ":"byo",
  "ぴゃ":"pya","ぴゅ":"pyu","ぴょ":"pyo",
  "みゃ":"mya","みゅ":"myu","みょ":"myo",
  "りゃ":"rya","りゅ":"ryu","りょ":"ryo",
  "ふぁ":"fa","ふぃ":"fi","ふぇ":"fe","ふぉ":"fo",
  "てぃ":"ti","でぃ":"di","うぃ":"wi","うぇ":"we","うぉ":"wo",
  // ちぇ/しぇ/じぇ：外来语核心组合，缺了会变成 chie / shie / jie
  "ちぇ":"che","しぇ":"she","じぇ":"je","ぢぇ":"je",
  "いぇ":"ye","とぅ":"tu","どぅ":"du",
  "つぁ":"tsa","つぃ":"tsi","つぇ":"tse","つぉ":"tso",
  "きぇ":"kye","ぎぇ":"gye","にぇ":"nye","ひぇ":"hye",
  "びぇ":"bye","ぴぇ":"pye","みぇ":"mye","りぇ":"rye",
  "ゔぁ":"va","ゔぃ":"vi","ゔぇ":"ve","ゔぉ":"vo",
};

/** 片假名 → 平假名 */
function toHiragana(s) {
  return s.replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

function kanaToRomaji(input) {
  if (!input) return "";
  const s = toHiragana(String(input));
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];

    // 促音：双写下一个辅音
    if (c === "っ") {
      const next = s.slice(i + 1, i + 3);
      const rom = DIGRAPH[next] || BASIC[s[i + 1]] || "";
      if (rom) {
        // まっちゃ → matcha、みっつ → mittsu（ch/ts 前的促音写 t）
        out += (rom.startsWith("ch") || rom.startsWith("ts")) ? "t" : rom[0];
      }
      continue;
    }

    // 拨音：统一 n（IME 里 shinichi 就能出「しんいち」，不用加撇号）
    if (c === "ん") { out += "n"; continue; }

    // 长音符：IME 里是按「-」输入的（のーと = no-to，不是 nooto）
    if (c === "ー") { out += "-"; continue; }

    const two = s.slice(i, i + 2);
    if (DIGRAPH[two]) { out += DIGRAPH[two]; i++; continue; }
    if (BASIC[c]) { out += BASIC[c]; continue; }

    // 汉字/标点等原样保留
    out += c;
  }
  return out;
}

module.exports = { kanaToRomaji, toHiragana };
