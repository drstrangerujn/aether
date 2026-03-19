<p align="center">
  <br>
  <strong>A · E · T · H · E · R</strong>
  <br>
  <em>看不见，但无处不在——连接 AI 与浏览器的第五元素。</em>
  <br><br>
  <a href="#快速开始">快速开始</a> ·
  <a href="#hint-map-页面感知">Hint Map</a> ·
  <a href="#safe-mode-安全模式">Safe Mode</a> ·
  <a href="#作为-skill-使用">Skill</a> ·
  <a href="#路线图">路线图</a>
</p>

---

别的浏览器 Agent 在跟网站打架。Aether 不打。

它不造新浏览器，不伪造指纹，不偷 cookie。它做一件别人没做的事——**附身到你已经在用的浏览器上**。一个轻量级 Chrome 插件，把你的真实浏览器通过 MCP 协议桥接给任何 AI 应用。你的登录态、cookie、IP、指纹全是真的。网站看到的就是一个正常人，因为那本来就是你的浏览器。

## 为什么

你试过让 AI 操控浏览器。你知道会发生什么。

无头 Chrome 一开，什么都没有——没 cookie、没登录态、一片空白。你对每个网站来说都是陌生人。Cloudflare 直接拦你。于是你装 stealth 插件、伪造 User-Agent、随机化 Canvas 指纹。周二能跑通，周四又挂了。网站更新检测，你更新伪装，来回拉扯，没有赢家。就算你过了这关，AI 面对 5 万 token 的原始 DOM，还是点错按钮。

Aether 不跟你玩这套。它直接跑在你已经打开的浏览器里。你的登录态、你的 cookie、你的指纹——本来就在。没什么好伪装的，也没什么好对抗的。

## 原理

```
┌──────────────────────────────────────────┐
│  你的真实浏览器                             │
│                                          │
│  ✓ 你的登录态    ✓ 你的 cookie            │
│  ✓ 你的 IP      ✓ 你的浏览器指纹          │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │ Aether 插件 (< 30KB)            │    │
│  │  · Hint Map — 页面感知层         │    │
│  │  · Safe Mode — 敏感操作拦截      │    │
│  └────────────┬─────────────────────┘    │
└───────────────┼──────────────────────────┘
                │ WebSocket（仅本地通信）
┌───────────────┼──────────────────────────┐
│ Aether MCP Server（本地运行）              │
│  · 13 个工具 · 操作日志 · 策略引擎        │
└───────────────┼──────────────────────────┘
                │ MCP 协议 (stdio)
┌───────────────┼──────────────────────────┐
│ 任意 AI：Claude · OpenClaw · GPT · 自建  │
└──────────────────────────────────────────┘
```

不需要 Docker。不需要云服务。不需要 API key。一个插件，一个本地服务。

## 快速开始

**1. 克隆仓库 & 加载插件**

```bash
git clone https://github.com/drstrangerujn/aether.git
```

打开 `chrome://extensions` → 开启开发者模式 → 加载已解压的扩展程序 → 选择 `aether/extension` 文件夹。

**2. 启动服务**

```bash
cd aether/server && npm install && npm start
```

**3. 连接你的 AI**

Claude Desktop（编辑 `claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "aether": {
      "command": "node",
      "args": ["/你的路径/aether/server/src/index.js"]
    }
  }
}
```

OpenClaw：把 `aether/skill/` 复制到 `~/.openclaw/skills/aether`。

插件右上角显示蓝色 **ON** 就说明连接成功了。搞定。

## Hint Map（页面感知）

核心思想：不给 AI 看原始 HTML 或截图，给它看一张**结构化的页面感知图**。

```json
{
  "summary": "47 个元素，分布在 [nav, main, sidebar] 🍪 检测到 cookie 横幅",
  "interactables": [
    { "id": "h0", "type": "input",  "region": "main", "priority": 90, "placeholder": "搜索..." },
    { "id": "h1", "type": "button", "region": "main", "priority": 85, "text": "搜索" },
    { "id": "h2", "type": "link",   "region": "nav",  "priority": 60, "text": "电子产品" }
  ],
  "content": {
    "semantics": { "price": ["¥299", "¥199"], "count": ["128 条评价"] },
    "tables": [{ "headers": ["名称", "价格", "评分"], "rowCount": 25 }]
  },
  "state": { "popup": false, "login": false, "captcha": false, "cookieBanner": true }
}
```

跟 accessibility snapshot 或 DOM dump 的区别在哪：

- **区域识别** — 每个元素都标注了它在导航栏、主内容区、侧栏还是弹窗里。AI 可以忽略无关区域的噪音。
- **优先级排序** — 元素按视口可见性、尺寸、可操作性打分排序。弹窗里的元素排最前。
- **语义提取** — 价格、日期、邮箱、数量、百分比自动提取好了。AI 不需要自己写正则。
- **去重** — 同一像素位置的重叠元素自动合并。
- **一句话摘要** — AI 读一句话就知道自己在哪个页面。

Token 消耗：每页约 200-800 个 token，而原始 DOM 需要 10,000-50,000。

## Safe Mode（安全模式）

当 AI 要点击"删除账户"或"确认支付"这种按钮时，Aether 会自动拦截：

```json
{
  "_aether_approval_required": true,
  "category": "delete",
  "description": "操作: click | 目标: \"删除账户\"",
  "options": [
    "approve       — 执行这次操作",
    "approve_all   — 以后这类操作都自动放行",
    "reject        — 取消",
    "reject_always — 永远拦截这类操作"
  ]
}
```

AI 会把这个请求展示给你，由你决定。分类：**支付（payment）**、**删除（delete）**、**发送（send）**、**账户（account）**、**下载（download）**、**代码执行（code_execution）**。

对你信任的类别设一次 `approve_all`，以后就不再问了。对你想锁死的类别设 `reject_always`，永远拦截。你的策略，你做主。

## 工具集

| | 工具 | 功能 |
|-|------|------|
| 👁 | `get_hint_map` | 结构化页面感知。**每次操作前必须先调用。** |
| 👁 | `screenshot` | 截图 |
| 👁 | `extract` | 提取元素文本 |
| ✋ | `navigate` | 打开 URL（永远安全，不触发审批） |
| ✋ | `click` | 点击元素。敏感目标 → 触发 Safe Mode |
| ✋ | `type` | 输入文字。`pressEnter` 可提交表单 |
| ✋ | `scroll` | 滚动页面 |
| ✋ | `wait_for` | 等待元素 / 文本 / URL 变化 |
| ✋ | `execute_js` | 执行 JS。**永远需要审批** |
| 🔒 | `safe_mode_respond` | 处理审批请求 |
| 🔒 | `safe_mode_policy` | 查看/修改审批策略 |
| 📋 | `get_tabs` | 列出已打开的标签页 |
| 📋 | `get_audit_log` | 查看完整操作日志 |

## 作为 Skill 使用

Aether 自带 `skill/SKILL.md`——一份教 AI agent 如何高效使用浏览器工具的指南。包括：Hint Map 工作流、Safe Mode 审批处理、多步任务模式（搜索→筛选→提取）、弹窗处理、安全规则。

```bash
# OpenClaw
cp -r aether/skill ~/.openclaw/skills/aether

# Claude Code
cp -r aether/skill ~/.claude/skills/aether
```

## 对比

| | Aether | browser-use | Stagehand | Manus Operator |
|-|--------|-------------|-----------|----------------|
| 登录态保持 | ✅ 用你的真实浏览器 | ⚠️ 需要配置 | ❌ 云端 session | ✅ 你的浏览器 |
| 反检测 | ✅ 根本无需反检测 | ⚠️ stealth 插件 | ❌ 无 | ✅ 根本无需反检测 |
| 兼容任意 AI | ✅ MCP 标准协议 | ⚠️ Python SDK | ⚠️ 自有 SDK | ❌ 仅限 Manus |
| 开源 | ✅ MIT | ✅ | ✅ | ❌ 闭源 |
| 页面感知 | ✅ Hint Map | ❌ 原始 DOM | ⚠️ 部分支持 | ❓ 未知 |
| 安全模式 | ✅ 内置 | ❌ | ❌ | ❌ |
| 非开发者友好 | ✅ Skill + GUI 规划中 | ❌ 需写代码 | ❌ 需写代码 | ✅ |

## 项目结构

```
aether/
├── extension/          Chrome 插件（Manifest V3）
│   ├── content.js      Hint Map v2 + 页面操作
│   ├── background.js   WebSocket 桥接层
│   └── popup.html      连接状态界面
├── server/
│   └── src/index.js    MCP Server + Safe Mode 引擎
├── skill/
│   └── SKILL.md        AI agent 使用指南
└── scripts/
    └── test-e2e.js     15/15 测试通过
```

## 路线图

- [x] 导航、点击、输入、截图、提取、滚动
- [x] Hint Map v2：区域识别、优先级排序、语义提取、去重
- [x] Safe Mode：审批流程、按类别策略管理
- [x] Skill 格式，兼容 OpenClaw / Claude Code
- [ ] Self-Healing：页面布局变化时自动适应
- [ ] Multi-Profile：按任务切换浏览器配置文件
- [ ] 可视化配置界面（非开发者可用）
- [ ] WebMCP 兼容层
- [ ] 插件市场：社区贡献特定网站的 Hint Map 优化

## 理念

> 不要造一个新浏览器。让 AI 附身到用户已有的浏览器上。

浏览器 Agent 领域正在进行一场军备竞赛：bot 越来越聪明，检测越来越严格。Aether 直接退出了这场竞赛。当你用的就是用户自己的浏览器时，根本没有 bot 可以检测。

## 许可证

MIT

---

<p align="center">
  <strong>Aether</strong> — αἰθήρ — 古希腊第五元素，看不见，但无处不在。
</p>
