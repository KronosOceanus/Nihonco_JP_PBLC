/* Windows lite：不把 model/ 和 lib/Cubism Core 打进安装包
 * 用户从官方获取后放到 %APPDATA%\Nihonco\assets
 * full 仍用 package.json 的 build 配置。
 */
const base = require("./package.json").build;
const drop = (f) => f === "model/**" || f === "lib/**" || f.startsWith("model/") || f.startsWith("!model/");

module.exports = {
  ...base,
  files: base.files.filter((f) => !drop(f)),
  asarUnpack: base.asarUnpack.filter((f) => !drop(f)),
  win: {
    ...base.win,
    artifactName: "Nihonco-${version}-lite-${arch}.${ext}",
  },
};
