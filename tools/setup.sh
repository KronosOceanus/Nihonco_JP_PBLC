#!/bin/bash
# 一键准备运行环境（Node 依赖 + Python 虚拟环境 + .env）
set -e
cd "$(dirname "$0")/.." || exit 1
ROOT="$PWD"

echo "== 1/3 Node 依赖"
npm install

echo "== 2/3 Python 虚拟环境（语音识别）"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt

echo "== 3/3 配置 .env"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "已生成 .env，请填入 LLM_API_KEY"
fi

echo
echo "还需要手动准备两样东西（体积大，不放进仓库）："
echo "  1) Live2D 模型 → model/Hiyori/（已随仓库提供）"
echo "  2) VOICEVOX 引擎 → 见 README「小夜的声线」一节"
echo
echo "完成。启动：open Nihonco.app  或  npm start"
