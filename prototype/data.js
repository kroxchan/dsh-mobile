/**
 * 原型演示数据。全部为假数据/示例文案，不连真实 Bot、不读真实文件。
 * 结构与后续真实接口的映射见「我的 → 设计说明」。
 */
(function () {
  const DEPTS = {
    lead: { key: "lead", name: "总协调", a1: "#4a4744", a2: "#4a4744" },
    content: { key: "content", name: "内容部", a1: "#b06a4f", a2: "#b06a4f" },
    research: { key: "research", name: "研究部", a1: "#5f7d6b", a2: "#5f7d6b" },
    project: { key: "project", name: "项目部", a1: "#7d7396", a2: "#7d7396" }
  };

  const BOTS = [
    {
      id: "DSH", name: "DSH Agent", glyph: "D", dept: "lead",
      role: "主助手 · 桌面端会话", short: "桌面端主助手，处理日常任务",
      status: "online", statusText: "在线"
    },
    {
      id: "A00", name: "Chief", glyph: "总", dept: "lead",
      role: "Chief of Staff · 统筹 / 知识库", short: "统筹、派任务、汇总汇报",
      status: "online", statusText: "在线"
    },
    {
      id: "C01", name: "内容研究员", glyph: "研", dept: "content",
      role: "受众画像 · 评论洞察", short: "受众与对标账号观察",
      status: "idle", statusText: "空闲"
    },
    {
      id: "C02", name: "选题策划", glyph: "题", dept: "content",
      role: "选题池 · 内容日历", short: "选题、结构、平台适配",
      status: "busy", statusText: "运行中"
    },
    {
      id: "C03", name: "内容编辑", glyph: "编", dept: "content",
      role: "初稿 · 标题 · 风格", short: "写初稿，保持 Owner 风格",
      status: "idle", statusText: "空闲"
    },
    {
      id: "C04", name: "内容审稿", glyph: "审", dept: "content",
      role: "事实核查 · 独立反对", short: "给反对意见，不放水",
      status: "online", statusText: "在线"
    },
    {
      id: "R01", name: "行业情报员", glyph: "情", dept: "research",
      role: "每日情报 · 来源库", short: "每日情报，事实与推测分开",
      status: "online", statusText: "在线"
    },
    {
      id: "R02", name: "商业分析师", glyph: "商", dept: "research",
      role: "竞品 · 商业模式", short: "行业 / 竞品 / 付费意愿",
      status: "idle", statusText: "空闲"
    },
    {
      id: "R03", name: "机会评估师", glyph: "机", dept: "research",
      role: "机会筛选 · MVP", short: "筛机会，验证可行性",
      status: "idle", statusText: "空闲"
    },
    {
      id: "P01", name: "项目经理", glyph: "项", dept: "project",
      role: "项目档案 · 里程碑", short: "拆项目、管里程碑与风险",
      status: "online", statusText: "在线"
    },
    {
      id: "P02", name: "执行员", glyph: "执", dept: "project",
      role: "执行交付 · 代码 / 文档", short: "真正把东西做出来",
      status: "busy", statusText: "运行中"
    },
    {
      id: "P03", name: "质量审查员", glyph: "验", dept: "project",
      role: "验收 · 返工", short: "按需求验收，不合格就退回",
      status: "idle", statusText: "空闲"
    }
  ];

  /** 会话列表：时间倒序（演示用固定顺序） */
  const CONVERSATIONS = [
    {
      id: "group", kind: "group", name: "KPAO 指挥部", members: 13, pin: true,
      last: "C02：大纲 v1.2 已更新，图 4 换成案例化", time: "13:58", unread: 5
    },
    {
      id: "DSH", kind: "bot", last: "手机端原型 v0.2 已更新，工具入口补齐", time: "16:20", unread: 0
    },
    {
      id: "room-content", kind: "group", name: "内容部", members: 5,
      memberIds: ["C01", "C02", "C03", "C04"],
      last: "C04：审稿结论不通过，5 项必改", time: "12:35", unread: 0
    },
    {
      id: "room-research", kind: "group", name: "研究部", members: 4,
      memberIds: ["R01", "R02", "R03"],
      last: "R01：今日情报 5 条，2 条标注推测", time: "08:12", unread: 0
    },
    {
      id: "room-project", kind: "group", name: "项目部", members: 4,
      memberIds: ["P01", "P02", "P03"],
      last: "P03：验收报告 T-23 通过", time: "周一", unread: 0
    },
    {
      id: "A00", kind: "bot", last: "只缺两样：5–8 条亲历信息差、任一篇笔记正文", time: "14:02", unread: 2
    },
    {
      id: "R01", kind: "bot", last: "今日情报已落盘，12.6 KB / 5 条带来源", time: "08:12", unread: 0
    },
    {
      id: "C02", kind: "bot", last: "正在输入…", time: "13:52", unread: 0, typing: true
    },
    {
      id: "C04", kind: "bot", last: "审稿结论：不通过，5 项必改", time: "12:35", unread: 1
    },
    {
      id: "P02", kind: "bot", last: "原型页面 3 屏已就绪，等你看", time: "11:20", unread: 0
    },
    {
      id: "C01", kind: "bot", last: "招聘时间线 6 个来源已归档", time: "10:05", unread: 0
    },
    {
      id: "P01", kind: "bot", last: "项目档案 v0 已建，待补里程碑", time: "昨天", unread: 0
    },
    {
      id: "R02", kind: "bot", last: "竞品拆解初稿 pending 素材", time: "昨天", unread: 0
    },
    {
      id: "C03", kind: "bot", last: "卡面文案 3 版，已交审稿", time: "昨天", unread: 0
    },
    {
      id: "P03", kind: "bot", last: "验收报告：T-23 通过", time: "周一", unread: 0
    },
    {
      id: "R03", kind: "bot", last: "机会筛选：3 个方向待评估", time: "周一", unread: 0
    }
  ];

  /** 每个会话的消息。type: text | task | file | approval | system */
  const MESSAGES = {
    DSH: [
      {
        id: "dsh1", from: "them", sender: "DSH", time: "16:20", type: "text",
        text: "手机端原型 v0.2 已更新：补了发起群聊、添加 agent，以及会话工具和设置的全部入口。电脑端界面保持原样。"
      },
      { id: "dsh2", from: "me", time: "16:21", type: "text", text: "电脑端不动，只改手机。" },
      {
        id: "dsh3", from: "them", sender: "DSH", time: "16:22", type: "text",
        text: "收到。之后只作用于手机网关与原型，桌面端 127.0.0.1 的界面不受影响。"
      }
    ],
    "room-content": [
      { id: "rc0", from: "system", time: "08:05", type: "system", text: "内容部群聊 · 4 个 Bot + 你" },
      {
        id: "rc1", from: "them", sender: "C02", time: "09:30", type: "text",
        text: "大纲 v1.2 已更新，图 4 换成案例化，M10/M11 已标缺口。"
      },
      {
        id: "rc2", from: "them", sender: "C04", time: "12:35", type: "text",
        text: "审稿结论：不通过。5 项必改，最重的一条是「万亿规模」缺传导链。"
      }
    ],
    "room-research": [
      { id: "rr0", from: "system", time: "08:05", type: "system", text: "研究部群聊 · 3 个 Bot + 你" },
      {
        id: "rr1", from: "them", sender: "R01", time: "08:12", type: "text",
        text: "今日情报 5 条，全部带来源；其中 2 条是推测，已单独列出。"
      }
    ],
    "room-project": [
      { id: "rp0", from: "system", time: "08:05", type: "system", text: "项目部群聊 · 3 个 Bot + 你" },
      {
        id: "rp1", from: "them", sender: "P03", time: "周一", type: "text",
        text: "验收报告：T-23 通过。审稿清单 v1.1 覆盖到招聘类事实核查。"
      }
    ],
    A00: [
      {
        id: "a1", from: "them", sender: "A00", time: "08:40", type: "text",
        text: "早上好 Owner。今日任务板 25 条：21 完成、1 待验收、3 进行中。两件事需要你拍板，我先给结论。"
      },
      {
        id: "a2", from: "them", sender: "A00", time: "08:41", type: "task",
        task: {
          code: "T-20261104-19", title: "汇总内容生产素材需求（单一口径）",
          owner: "Chief", priority: "P0", due: "今天", state: "in_progress", stateText: "进行中",
          progress: 60
        }
      },
      { id: "a3", from: "me", time: "09:02", type: "text", text: "先给结论，缺什么？" },
      {
        id: "a4", from: "them", sender: "A00", time: "09:03", type: "text",
        text: "只缺两样：① 5–8 条你亲历的信息差；② 任一篇笔记的正文全文。其余内容部能自己推进，不用你管。"
      },
      {
        id: "a5", from: "them", sender: "A00", time: "09:04", type: "approval",
        approval: {
          level: "L3", title: "以 num1.ai 发布《信息差三层》",
          desc: "发布属于对外动作，需要你明确批准。批准后仍要过事实核查门禁。",
          state: "pending"
        }
      },
      {
        id: "a6", from: "them", sender: "A00", time: "11:18", type: "file",
        file: { name: "2026-11-04-选题建议-v2.md", meta: "content/topics · 34 KB · 3 选题", action: "预览" }
      },
      {
        id: "a7", from: "them", sender: "A00", time: "14:02", type: "typing",
        text: "正在整理今日简报…"
      }
    ],
    group: [
      { id: "g0", from: "system", time: "08:05", type: "system", text: "Chief 把 R01、C02、P02 拉进了群聊" },
      {
        id: "g1", from: "them", sender: "R01", time: "08:12", type: "text",
        text: "今日情报已入库：5 条带来源的产业动态，2 条标注为推测，原始链接都在 research/daily/ 里。"
      },
      {
        id: "g2", from: "them", sender: "C02", time: "09:30", type: "text",
        text: "收到。我按情报把大纲 v1.2 的图 4 换成案例化，删掉没有截图的引用，M10/M11 已标缺口。"
      },
      { id: "g3", from: "me", time: "09:35", type: "text", text: "图 4 不要做成仿网页截图，宁可排版卡。" },
      {
        id: "g4", from: "them", sender: "C04", time: "12:35", type: "text",
        text: "同意。我审稿会把「原文摘录卡」和「伪造截图」分开判，这条写进清单 1.4。"
      },
      {
        id: "g5", from: "them", sender: "C02", time: "13:58", type: "text",
        text: "大纲 v1.2 已更新，等 Owner 一句话确认能不能进正文。@Chief 麻烦汇总一下还缺什么。"
      }
    ],
    R01: [
      {
        id: "r1", from: "them", sender: "R01", time: "08:10", type: "text",
        text: "今日情报 5 条，全部带来源；其中 2 条是推测，已在文末单独列出，方便你快速判断。"
      },
      {
        id: "r2", from: "them", sender: "R01", time: "08:12", type: "file",
        file: { name: "2026-11-04-intel.md", meta: "research/daily · 12.6 KB · 5 条 + 2 推测", action: "预览" }
      },
      { id: "r3", from: "me", time: "08:30", type: "text", text: "第 3 条再补一个原始来源，别只有二手转述。" },
      {
        id: "r4", from: "them", sender: "R01", time: "08:42", type: "text",
        text: "收到，已补官方公告原文和抓取时间；如果 3 天内找不到第二个来源，我会把它降为「未证实」。"
      }
    ],
    C02: [
      {
        id: "c1", from: "them", sender: "C02", time: "13:48", type: "text",
        text: "大纲 v1.2 已保存。三选题里我建议先做「信息差三层」，因为它能复用你已有的笔记素材。"
      },
      { id: "c2", from: "me", time: "13:50", type: "text", text: "先把结构给我，正文等素材。" },
      {
        id: "c3", from: "them", sender: "C02", time: "13:51", type: "text",
        text: "结构已按 8–9 张卡片拆好，每张卡片一个论点，门槛 M1/M2/M3 单独标出。"
      }
    ],
    C04: [
      {
        id: "d1", from: "them", sender: "C04", time: "12:35", type: "text",
        text: "审稿结论：不通过。5 项必改，最重的一条是「万亿规模」的推论缺传导链，属于合成谬误。"
      },
      { id: "d2", from: "me", time: "12:40", type: "text", text: "别为了好读放水，按你的清单改。" }
    ],
    P02: [
      {
        id: "e1", from: "them", sender: "P02", time: "11:20", type: "text",
        text: "手机端原型 3 屏已就绪：消息 / 通讯录 / 聊天框，比例锁定和键盘处理都做了。等你看。"
      },
      {
        id: "e2", from: "them", sender: "P02", time: "11:22", type: "file",
        file: { name: "prototype/index.html", meta: "dsh-mobile · 交互原型 · 3 屏", action: "打开" }
      }
    ],
    C01: [
      {
        id: "f1", from: "them", sender: "C01", time: "10:05", type: "text",
        text: "招聘时间线 6 个来源已归档，4 个可用、2 个反例。发布前 3 天我建议重抓一次。"
      }
    ],
    P01: [
      {
        id: "h1", from: "them", sender: "P01", time: "昨天", type: "text",
        text: "项目档案 v0 已建，里程碑还缺你确认的三个节点，确认后我拆任务。"
      }
    ],
    R02: [
      {
        id: "i1", from: "them", sender: "R02", time: "昨天", type: "text",
        text: "竞品拆解初稿先挂起：没有付费数据，我不编。等你给两家可比产品的定价截图。"
      }
    ],
    C03: [
      {
        id: "j1", from: "them", sender: "C03", time: "昨天", type: "text",
        text: "卡面文案交了 3 版，都控制在 60–120 字，已交 C04 审稿。"
      }
    ],
    P03: [
      {
        id: "k1", from: "them", sender: "P03", time: "周一", type: "text",
        text: "验收报告：T-23 通过。审稿清单 v1.1 的 F8 项覆盖到招聘类事实核查，符合验收标准。"
      }
    ],
    R03: [
      {
        id: "l1", from: "them", sender: "R03", time: "周一", type: "text",
        text: "机会筛选：3 个方向待评估。按「个人可做 + 6 周能验证」的标准，我建议先砍到 1 个。"
      }
    ]
  };

  const QUICK_REPLIES = {
    A00: ["今日简报", "任务板", "待我决策", "让 R01 补情报"],
    group: ["@Chief 汇总", "看任务板", "今天先做哪个"],
    R01: ["补一个来源", "只保留可验证的", "继续跟进"],
    C02: ["先出结构", "按 v1.2 推进", "不要用二手转述"],
    C04: ["按清单改", "再严一点", "给我结论"],
    P02: ["原型发给 Owner", "继续做下一屏", "先锁定比例"],
    default: ["继续", "看交付物", "总结一下"]
  };

  /** 演示用的自动回复 */
  const AUTO_REPLY = {
    A00: "收到。我先把这条挂到任务板，再按 L1/L2 分派下去，有需要你决策的我单独标 L3。",
    group: "收到，我记一下，稍后在群里同步进度。",
    R01: "收到，我去补来源，补不到就标「未证实」，不硬凑。",
    C02: "好，我按这个方向改结构，改完先给 C04 审，不直接进正文。",
    C04: "可以，但我保留反对意见：结论先写清楚，证据不够的地方要标出来。",
    P02: "好，我继续做，交付物会放到对应目录并在群里给路径。",
    default: "收到。我处理完在这里回你，交付物会落到对应目录。"
  };

  const CURRENT_USER = { name: "Owner", glyph: "K" };

  window.KPAO = { DEPTS, BOTS, CONVERSATIONS, MESSAGES, QUICK_REPLIES, AUTO_REPLY, CURRENT_USER };
})();
