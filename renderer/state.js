/* 渲染层共享状态与常量（先于其它 renderer 脚本加载）
 *
 * 约定：跨文件共享的 let/const 只在这里声明一次；其它文件只引用，不重名声明
 *       （classic script 顶层会共享同一个全局词法环境，重复声明直接 SyntaxError）。
 */
const q = new URLSearchParams(location.search);

const MODEL_URL = q.get("model") || "model/Hiyori/Hiyori.model3.json";
const FLIP_X = Number(q.get("fx") || 1);
const FLIP_Y = Number(q.get("fy") || -1);
// 取景倍率：默认 2.4 = 只露上半身（?zoom=1 回到全身）
// 识别语言由当前模式决定（翻译模式用中文，其余日语）；?asr= 可强制覆盖
const ASR_FORCE = q.get("asr") || "";

const hud = document.getElementById("hud");
const input = document.getElementById("say");
const replyEl = document.getElementById("reply");
const replyTextEl = document.getElementById("replyText");
let lastSpoken = "";        // 最近一次朗读的文本（会话模式的「再读一遍」用）
let lastCardSay = "";       // 最近一张卡片的朗读文本（单词+例句 / 例句）；「再读一遍」优先用它
let lastContentSay = "";    // 最近一次「内容」朗读（卡片正文 / 对话回复 / 搭话）；不含模式提示音
let lastConvSay = "";       // 最近一次会話/解説回复（重播按钮在 conv/teach 只认它）

const noteEl = document.getElementById("note");
const modeBar = document.getElementById("modes");

// 四种模式（标签统一日语）；翻译模式下语音输入用中文
const MODES = [
  { id: "conv",      label: "会話", tip: "会話モード",          asr: "ja", say: "かいわモード" },
  { id: "teach",     label: "解説", tip: "解説モード",          asr: "ja", say: "かいせつモード" },
  { id: "word",      label: "単語", tip: "単語モード",          asr: "ja", say: "たんごモード" },
  { id: "pattern",   label: "例文", tip: "例文モード",          asr: "ja", say: "れいぶんモード" },
];
let speakLang = "ja";                       // 语音识别语言：ja / zh（默认日语）
const asrLang = () => speakLang;
// 语言由模式决定：日本語模式固定 ja，中国語模式固定 zh。
// 不再根据文本里有没有假名/中文特征词做输入路由。

let chatMode = "conv";           // conv | teach | word | pattern
let convSubMode = "conv";        // 会話 / 解説 的子模式：切到单词/例文再回来要还原
let chatBusy = false;
let speechMuted = false;         // 静音：只影响朗读，不影响文字/识别
let chatSource = "text";   // voice | text（诊断用）

/* ---- 跨文件共享的运行时状态（只在这里声明） ---- */
let speaking = false;              // 语音是否正在合成/播放（speech.js 读写）
let turnId = 0;                    // 对话轮次：丢弃被抢占的旧结果
let casualSeq = 0;                 // 主动搭话轮次：旧的中文翻译不许贴到新内容上
const isTalkMode = (m) => m === "conv" || m === "teach";
let chatQueue = [];                // 模型思考期间收到的输入排队
let alignUI = () => {};            // app-ui 注入：重新对齐批次/档位按钮
let pendingModeSay = null;         // 切模式后要念的提示音
const MODE_SAY_GAP_MS = 400;       // 提示音与卡片语音之间的停顿
const sayLog = [];                 // 念过的提示语（排障/自检用）
let dailyCard = null;              // 当前待默写的词
let dailyBusy = false;
let dailySeq = 0;                  // 批次序号：连点/打断时让旧循环失效
let wordMode = "daily";            // 后端当前单词模式
let patternMode = "daily";         // 例句模式子模式
let patternCard = null;            // 当前例句卡
let patternReviewHadWords = false; // 进復習时错题本本来有内容
let reviewHadWords = false;        // 本轮復習开始时错题本是否非空
let lastNewDone = -1;              // 今日新词完成数（提示只弹一次）
