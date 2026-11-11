/**
 * KPAO 手机端 IM 原型 · 交互逻辑
 * 纯静态、无依赖。数据来自 data.js（演示假数据）。
 */
(function () {
  "use strict";

  const D = window.KPAO;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const DEPT_ORDER = ["lead", "content", "research", "project"];

  const el = {
    app: $("#app"),
    pages: $$(".page"),
    tabs: $$(".tab"),
    tabBadge: $("#tabBadge"),
    chatList: $("#chatList"),
    contactList: $("#contactList"),
    chatSearch: $("#chatSearch"),
    contactSearch: $("#contactSearch"),
    chatSearchClear: $("#chatSearchClear"),
    contactSearchClear: $("#contactSearchClear"),
    chatView: $("#chatView"),
    chatAvatar: $("#chatAvatar"),
    chatName: $("#chatName"),
    chatStatus: $("#chatStatus"),
    chatScroll: $("#chatScroll"),
    imageInput: $("#imageInput"),
    pendingImage: $("#pendingImage"),
    pendingImageThumb: $("#pendingImageThumb"),
    quickRow: $("#quickRow"),
    composerInput: $("#composerInput"),
    sendBtn: $("#sendBtn"),
    stopBtn: $("#stopBtn"),
    sheetLayer: $("#sheetLayer"),
    sheet: $("#sheet"),
    toast: $("#toast"),
    themeValue: $("#themeValue"),
    zoomSwitch: $("#zoomSwitch"),
    metaTheme: $("#metaTheme")
  };

  const state = {
    tab: "chats",
    chatId: null,
    searchChat: "",
    searchContact: "",
    bots: D.BOTS.map((b) => ({ ...b })),
    botMap: {},
    convs: D.CONVERSATIONS.map((c) => ({ ...c })),
    messages: JSON.parse(JSON.stringify(D.MESSAGES)),
    theme: "auto",
    replyTimer: null,
    addBotDept: "content",
    groupSelection: new Set(),
    memberSelection: new Set(),
    pins: [],
    pendingImage: null,
    lastAt: {},
    live: false,
    liveState: null,
    liveLastChat: "",
    liveBusy: false,
    tasks: {},
    chatMeta: {},
    approvals: [],
    liveRunning: false,
    liveWork: {},
    liveActivity: {},
    sessionWork: {},
    pending: { approvals: [], questions: [] },
    deliverables: [],
    ownerMap: {},
    qSelected: {},
    mySessions: [],
    hidden: [],
    agentSessionId: null,
    quickTarget: null
  };

  function rebuildBotMap() {
    state.botMap = Object.fromEntries(state.bots.map((b) => [b.id, b]));
  }
  function bot(id) {
    return state.botMap[id] || state.botMap.A00;
  }
  function convById(id) {
    return state.convs.find((c) => c.id === id);
  }
  rebuildBotMap();

  // 初始群：11 个 Bot + 用户
  state.convs.forEach((conv) => {
    if (conv.kind === "group" && !conv.memberIds) {
      conv.memberIds = state.bots.map((b) => b.id);
      conv.members = conv.memberIds.length + 1;
    }
  });

  /* ---------------------------- 实时数据（网关 IM 适配层） ---------------------------- */

  const COLOR_DEPT = {
    deepseek: "lead", blue: "project", purple: "project", indigo: "project",
    red: "content", orange: "content", yellow: "content", pink: "content",
    green: "research", teal: "research", cyan: "research",
    gray: "lead", grey: "lead", black: "lead", white: "lead"
  };
  const DEPT_COLOR = { lead: "deepseek", content: "red", research: "green", project: "blue" };
  const GLYPH_HINTS = [
    ["内容研究", "研"], ["内容编辑", "编"], ["内容审稿", "审"], ["选题", "题"],
    ["行业", "情"], ["商业", "商"], ["机会", "机"], ["项目经理", "项"],
    ["执行", "执"], ["质量", "验"]
  ];

  function botGlyph(name) {
    const text = String(name || "");
    for (const [hint, glyph] of GLYPH_HINTS) {
      if (text.includes(hint)) return glyph;
    }
    return text.trim().slice(0, 1) || "B";
  }

  function hm(timestamp) {
    if (!timestamp) return "";
    const date = new Date(Number(timestamp));
    if (Number.isNaN(date.getTime())) return "";
    return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
  }

  function isLivePage() {
    return location.protocol === "http:" || location.protocol === "https:";
  }

  async function liveFetch(path, options) {
    const response = await fetch(path, { cache: "no-store", ...options });
    const json = await response.json().catch(() => null);
    if (!response.ok) throw new Error(json?.error?.message ?? `请求失败（${response.status}）`);
    if (json && json.ok === false) throw new Error(json?.error?.message ?? "请求失败");
    return json;
  }

  const BOT_PROFILES = [
    ["内容研究", "content", "内容部 · 受众与洞察"],
    ["选题", "content", "内容部 · 选题与大纲"],
    ["内容编辑", "content", "内容部 · 初稿与润色"],
    ["内容审稿", "content", "内容部 · 事实核查"],
    ["行业", "research", "研究部 · 行业情报"],
    ["商业", "research", "研究部 · 商业分析"],
    ["机会", "research", "研究部 · 机会评估"],
    ["项目经理", "project", "项目部 · 项目推进"],
    ["执行", "project", "项目部 · 执行交付"],
    ["质量", "project", "项目部 · 验收审查"],
    ["Chief", "lead", "总协调 · 统筹"],
    ["DSH", "lead", "主助手 · 桌面端"]
  ];

  function liveProfile(name, color) {
    const text = String(name || "");
    const hit = BOT_PROFILES.find(([keyword]) => text.includes(keyword));
    if (hit) return { dept: hit[1], role: hit[2] };
    return { dept: COLOR_DEPT[String(color || "").toLowerCase()] ?? "content", role: "" };
  }

  function mapLiveBot(bot, workBots, activity) {
    const act = activity?.[bot.id];
    const running =
      !!(workBots && workBots[bot.id]) ||
      act === "thinking" || act === "working" || act === "waiting" || act === "alert";
    const profile = liveProfile(bot.name, bot.color);
    const role = bot.role || profile.role || "Bot";
    return {
      id: bot.id,
      name: bot.name || "Bot",
      glyph: botGlyph(bot.name),
      dept: profile.dept,
      role: role || "Bot",
      short: role || "Bot",
      status: running ? "busy" : "online",
      statusText: running ? (act === "alert" ? "等待审批" : act === "waiting" ? "等待结果" : "运行中") : "在线"
    };
  }

  function mapLiveRoom(room) {
    return {
      id: room.id,
      kind: "group",
      name: room.name || "群聊",
      memberIds: Array.isArray(room.members) ? room.members : [],
      members: (room.members?.length ?? 0) + 1,
      last: String(room.preview || "暂无消息").replace(/\s+/g, " ").slice(0, 80),
      time: "",
      unread: 0,
      lastAt: 0
    };
  }

  /** 把 ds-bot 的 work 描述翻成一句中文状态。 */
  function liveWorkText(work) {
    const status = statusFromWork(work, "");
    return status ? status.text : "思考中…";
  }

  function statusFromWork(work, prefix) {
    if (!work) return null;
    if (work.switching) return { text: prefix + "切换工作区…", meta: "", since: work.since };
    if (work.tool) {
      const meta = [work.target, work.note, work.said]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 80);
      return { text: prefix + `正在调用 ${work.tool}`, meta, since: work.since };
    }
    return {
      text: prefix + "思考中…",
      meta: work.said ? String(work.said).slice(0, 60) : "",
      since: work.since
    };
  }

  function activityText(status) {
    return (
      {
        thinking: "思考中…",
        working: "处理中…",
        waiting: "等待结果…",
        alert: "等待审批"
      }[status] ?? "处理中…"
    );
  }

  /** 当前会话是否在跑，以及跑什么。 */
  function liveStatusFor(conv) {
    if (!conv || !state.live) return null;
    const work = state.liveWork ?? {};
    const activity = state.liveActivity ?? {};
    if (conv.kind === "group") {
      const list = Array.isArray(work.rooms?.[conv.id]) ? work.rooms[conv.id] : [];
      if (list.length > 0) {
        const first = list[0];
        const name = state.botMap[first.botId]?.name ?? "Bot";
        const status = statusFromWork(first, "");
        if (status) {
          status.meta = status.meta ? `${name} · ${status.meta}` : name;
          return status;
        }
      }
      if (work.turns?.[conv.id]) return { text: "群里正在处理…", meta: "", since: work.turns[conv.id] };
      return null;
    }
    const botWork = work.bots?.[conv.id];
    if (botWork) return statusFromWork(botWork, "");
    const sessionStatus = state.sessionWork?.[conv.id];
    if (sessionStatus) return statusFromWork(sessionStatus, "");
    if (work.turns?.[conv.id]) return { text: "处理中…", meta: "", since: work.turns[conv.id] };
    if (activity[conv.id]) return { text: activityText(activity[conv.id]), meta: "", since: undefined };
    return null;
  }

  /** 同步聊天头部状态 + 底部「思考中 / 正在调用工具」提示条。 */
  function updateLiveStatus() {
    const conv = currentConv();
    const live = state.live && conv ? liveStatusFor(conv) : null;
    const typing = $("#liveTyping");
    const typingText = $("#liveTypingText");
    const typingMeta = $("#liveTypingMeta");
    if (typing) {
      typing.hidden = !live;
      if (live) {
        const seconds = live.since ? Math.max(0, Math.floor((Date.now() - live.since) / 1000)) : 0;
        if (typingText) typingText.textContent = seconds > 0 ? `${live.text} · ${seconds}s` : live.text;
        if (typingMeta) {
          typingMeta.textContent = live.meta || "";
          typingMeta.hidden = !live.meta;
        }
      }
    }
    updateComposerSend();
    if (!conv || !state.chatId) return;
    const header = $("#chatStatus");
    if (!header) return;
    if (live) {
      header.innerHTML = `<i class="st-dot busy"></i>${esc(live.text)}`;
      return;
    }
    if (conv.kind === "group") {
      header.innerHTML = `<i class="st-dot online"></i>${conv.memberIds.length + 1} 位成员 · ${deptCount(conv)} 个部门`;
    } else {
      const target = state.botMap[conv.id];
      header.innerHTML = !target
        ? `<i class="st-dot online"></i>普通会话 · 可直接对话`
        : target.agent
          ? `<i class="st-dot online"></i>桌面端会话 · 可直接对话`
          : `<i class="st-dot ${statusDotClass(target)}"></i>${esc(target.statusText)} · ${esc(
              D.DEPTS[target.dept].name
            )}`;
    }
  }

  function setDataSource(text) {
    const node = $("#dataSource");
    if (node) node.textContent = text;
  }

  async function liveLoadState() {
    const snapshot = await liveFetch("/__im/state");
    window.__kpaoHeartbeat?.();
    setDataSource("真实数据 · " + hm(Date.now()));
    state.liveState = snapshot;
    state.liveWork = snapshot.work ?? {};
    state.liveActivity = snapshot.activity ?? {};
    state.sessionWork = { ...(state.sessionWork ?? {}), ...(snapshot.sessionWork ?? {}) };
    buildOwnerMap(snapshot);
    const workBots = snapshot.work?.bots ?? {};
    const activity = snapshot.activity ?? {};
    const agentBots = (snapshot.agents ?? []).map((agent) => {
      const sessions = Array.isArray(agent.sessions) ? agent.sessions : [];
      return {
        id: sessions.length > 0 ? sessions[sessions.length - 1] : agent.id,
        name: agent.name || "DSH Agent",
        glyph: "D",
        dept: "lead",
        role: "DSH Agent · 桌面端会话",
        short: "桌面端主助手",
        status: "online",
        statusText: "在线",
        agent: true
      };
    });
    state.bots = [
      ...(snapshot.bots ?? []).map((bot) => mapLiveBot(bot, workBots, activity)),
      ...agentBots
    ];
    rebuildBotMap();
    let extraConvs = [];
    state.convs = [      ...(snapshot.rooms ?? []).map((room) => ({
        ...mapLiveRoom(room),
        lastAt: Number(state.lastAt[room.id]) || 0
      })),
      ...agentBots.map((agent) => ({
        id: state.agentSessionId || agent.sessions?.[0] || agent.id,
        kind: "bot",
        name: agent.name || "DSH Agent",
        last: "当前 DSH 会话 · 可直接对话",
        time: "",
        unread: 0,
        lastAt: Number(state.lastAt[state.agentSessionId || agent.sessions?.[0] || agent.id]) || 0,
        agentSession: true
      })),
      ...(snapshot.bots ?? []).map((bot) => {
        const mapped = state.botMap[bot.id];
        return {
          id: bot.id,
          kind: "bot",
          last: mapped?.role || "点开开始对话",
          time: "",
          unread: 0,
          lastAt: Number(state.lastAt[bot.id]) || 0
        };
      })
    ].filter((conv) => !state.hidden.includes(conv.id));
    state.live = true;
    let savedTarget = null;
    try {
      savedTarget = localStorage.getItem("kpao-quick-target");
    } catch {}
    if (!state.quickTarget || !convById(state.quickTarget)) {
      state.quickTarget =
        savedTarget && convById(savedTarget)
          ? savedTarget
          : snapshot.bots?.[0]?.id ?? state.bots[0]?.id ?? null;
    }
    renderQuickCompose();
    try {
      const tasks = await liveFetch("/__im/tasks");
      state.tasks = Object.fromEntries((tasks.tasks ?? []).map((task) => [task.id, task]));
    } catch {
      state.tasks = {};
    }
    renderApprovals(snapshot.work?.approvals ?? []);
    renderChats();
    renderContacts();
    return snapshot;
  }

  const TASK_STATUS = {
    completed: "已完成", in_progress: "进行中", blocked: "阻塞",
    review: "待验收", assigned: "已分配", pending: "待分配",
    rejected: "返工", cancelled: "已取消"
  };

  function buildOwnerMap(snapshot) {
    const map = {};
    (snapshot.bots ?? []).forEach((item) => {
      if (item.sessionId) map[item.sessionId] = item.id;
    });
    (snapshot.agents ?? []).forEach((agent) => {
      (agent.sessions ?? []).forEach((id) => {
        map[id] = id;
      });
    });
    state.ownerMap = map;
  }

  function pendingFor(id) {
    const owner = (item) => state.ownerMap[item.sessionId] || item.sessionId;
    return {
      approvals: (state.pending.approvals ?? []).filter((item) => owner(item) === id),
      questions: (state.pending.questions ?? []).filter((item) => owner(item) === id)
    };
  }

  async function loadPending() {
    if (!state.live) return;
    const token = state.pendingToken ?? 0;
    try {
      const data = await liveFetch("/__im/pending");
      if (token !== (state.pendingToken ?? 0)) return;
      const closed = state.closedCards ?? {};
      state.pending = {
        approvals: (data.approvals ?? []).filter((item) => !closed[item.eventId]),
        questions: (data.questions ?? []).filter((item) => !closed[item.eventId])
      };
      renderCardDock();
    } catch {}
  }

  async function loadDeliverables(id) {
    if (!state.live || !id) {
      state.deliverables = [];
      renderDeliverableBar();
      return;
    }
    try {
      const data = await liveFetch("/__im/deliverables?id=" + encodeURIComponent(id));
      if (state.chatId !== id) return;
      state.deliverables = data.items ?? [];
      renderDeliverableBar();
    } catch {}
  }

  function renderDeliverableBar() {
    const bar = $("#deliverableBar");
    if (!bar) return;
    const count = (state.deliverables ?? []).length;
    const show = !!(state.chatId && count > 0);
    bar.hidden = !show;
    if (!show) return;
    const node = $("#deliverableCount");
    if (node) node.textContent = String(count);
  }

  function openDeliverablesSheet() {
    const items = state.deliverables ?? [];
    if (items.length === 0) {
      showToast("这个会话还没有产物");
      return;
    }
    const rows = items
      .slice()
      .reverse()
      .map(
        (item) => `<div class="session-row">
          <button class="menu-row" data-file="${esc(item.path)}" data-file-title="${esc(item.title ?? "")}">
            <span class="menu-ic ic-muted"><svg class="ic"><use href="#i-doc"/></svg></span>
            <span class="menu-label">${esc(item.title || "产物")}<span class="menu-sub">${esc(
              item.description || ""
            )}</span></span>
            <svg class="ic chev"><use href="#i-chev"/></svg>
          </button>
        </div>`
      )
      .join("");
    openSheet(`<h3>产物</h3>
      <p class="sheet-sub">点击直接在手机里打开，共 ${items.length} 个。</p>
      <div class="group-card">${rows}</div>`);
  }

  function markCardClosed(eventId) {
    state.pendingToken = (state.pendingToken ?? 0) + 1;
    state.closedCards = state.closedCards ?? {};
    state.closedCards[eventId] = true;
    state.pending.approvals = (state.pending.approvals ?? []).filter((item) => item.eventId !== eventId);
    state.pending.questions = (state.pending.questions ?? []).filter((item) => item.eventId !== eventId);
    delete state.qSelected[eventId];
    state.cardKey = "";
    renderCardDock(true);
  }

  let cardTouchUntil = 0;

  function cardRenderKey(conv, approvals, questions) {
    const selected = {};
    for (const bundle of questions) {
      selected[bundle.eventId] = [...(state.qSelected[bundle.eventId] ?? new Set())].sort();
    }
    return JSON.stringify({
      id: conv.id,
      approvals: approvals.map((item) => item.eventId).sort(),
      questions: questions.map((item) => item.eventId).sort(),
      selected
    });
  }

  function renderCardDock(force) {
    const dock = $("#cardDock");
    if (!dock) return;
    if (!force && Date.now() < cardTouchUntil) {
      state.cardDirty = true;
      return;
    }
    const conv = currentConv();
    if (!conv || !state.chatId) {
      dock.hidden = true;
      dock.innerHTML = "";
      state.cardKey = "";
      return;
    }
    const { approvals, questions } = pendingFor(conv.id);
    if (approvals.length === 0 && questions.length === 0) {
      dock.hidden = true;
      dock.innerHTML = "";
      state.cardKey = "";
      return;
    }
    const key = cardRenderKey(conv, approvals, questions);
    if (!force && key === state.cardKey && !dock.hidden) return;
    state.cardKey = key;
    dock.hidden = false;
    const parts = [];
    for (const item of approvals) {
      parts.push(`<div class="interaction-card">
        <div class="interaction-head"><svg class="ic"><use href="#i-shield"/></svg><b>需要你批准工具</b></div>
        <div class="interaction-line">${esc(item.toolName || "工具")}</div>
        ${item.reason ? `<div class="interaction-reason">${esc(item.reason)}</div>` : ""}
        <div class="interaction-actions">
          <button class="btn" data-approve-answer="rejected" data-event="${esc(item.eventId)}">拒绝</button>
          <button class="btn primary" data-approve-answer="allowed-once" data-event="${esc(item.eventId)}">允许一次</button>
        </div>
      </div>`);
    }
    for (const bundle of questions) {
      const selected = state.qSelected[bundle.eventId] ?? new Set();
      bundle.questions.forEach((item, index) => {
        const questionId = item.id ?? String(index);
        const options = (item.options ?? [])
          .map((option) => {
            const label = typeof option === "string" ? option : option.label;
            const description = typeof option === "string" ? "" : option.description ?? "";
            const active = selected.has(label) ? " is-selected" : "";
            return `<button class="option-row${active}" data-question-opt="${esc(bundle.eventId)}" data-question-id="${esc(questionId)}" data-label="${esc(label)}" data-multi="${item.multiSelect ? 1 : 0}" data-session="${esc(bundle.sessionId ?? "")}">
              <span class="option-label">${esc(label)}</span>${description ? `<span class="option-desc">${esc(description)}</span>` : ""}
            </button>`;
          })
          .join("");
        parts.push(`<div class="interaction-card">
          <div class="interaction-head"><svg class="ic"><use href="#i-spark"/></svg><b>需要你选择</b></div>
          <div class="interaction-line">${esc(item.question ?? "")}</div>
          <div class="option-list">${options}</div>
          ${item.allowCustom ? `<input class="interaction-input" id="qcustom_${esc(bundle.eventId)}_${index}" placeholder="或自己写一个答案">` : ""}
          ${`<div class="interaction-actions"><button class="btn primary" data-question-submit="${esc(bundle.eventId)}" data-question-id="${esc(questionId)}" data-index="${index}" data-session="${esc(bundle.sessionId ?? "")}" ${item.multiSelect || item.allowCustom ? "" : ""}>确认</button></div>`}
        </div>`);
      });
    }
    dock.innerHTML = parts.join("");
  }

  async function answerApprovalDock(eventId, outcome) {
    try {
      await liveFetch("/__im/answer-approval", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId, outcome })
      });
      markCardClosed(eventId);
      showToast(outcome === "allowed-once" ? "已允许这次调用" : "已拒绝这次调用");
    } catch (error) {
      const message = String(error.message ?? "");
      if (message.includes("关闭") || message.includes("no longer") || message.includes("stale")) {
        markCardClosed(eventId);
        showToast("这条审批已经处理过了");
        return;
      }
      showToast("操作失败：" + message);
    }
  }

  async function submitQuestionAnswer(eventId, questionId, selected, custom, sessionId) {
    const answer = { id: questionId, selected };
    if (custom) answer.custom = custom;
    // 先乐观关掉卡片，避免提交后又被轮询的旧数据带回来
    markCardClosed(eventId);
    try {
      await liveFetch("/__im/answer-question", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId, sessionId: sessionId ?? "", answers: [answer] })
      });
      showToast("已提交选择");
    } catch (error) {
      const message = String(error.message ?? "");
      if (message.includes("关闭") || message.includes("no longer") || message.includes("stale")) {
        showToast("这个问题已经处理过了");
        return;
      }
      state.closedCards = state.closedCards ?? {};
      delete state.closedCards[eventId];
      state.pendingToken = (state.pendingToken ?? 0) + 1;
      await loadPending();
      showToast("提交失败：" + message);
    }
  }

  function handleQuestionOption(button) {
    const eventId = button.dataset.questionOpt;
    const label = button.dataset.label;
    const signature = `${eventId}|${label}`;
    const now = Date.now();
    if (
      state.lastOptionTap &&
      state.lastOptionTap.signature === signature &&
      now - state.lastOptionTap.at < 400
    ) {
      return;
    }
    state.lastOptionTap = { signature, at: now };
    const multi = button.dataset.multi === "1";
    if (multi) {
      const selected = state.qSelected[eventId] ?? new Set();
      if (selected.has(label)) selected.delete(label);
      else selected.add(label);
      state.qSelected[eventId] = selected;
    } else {
      state.qSelected[eventId] = new Set([label]);
    }
    state.cardKey = "";
    renderCardDock(true);
  }

  function submitQuestionFromButton(button) {
    const eventId = button.dataset.questionSubmit;
    const index = button.dataset.index;
    const customInput = document.getElementById(`qcustom_${eventId}_${index}`);
    const selected = [...(state.qSelected[eventId] ?? new Set())];
    const custom = customInput ? customInput.value.trim() : "";
    if (selected.length === 0 && custom === "") {
      showToast("先选一个选项或写一个答案");
      return;
    }
    void submitQuestionAnswer(
      eventId,
      button.dataset.questionId,
      selected,
      custom,
      button.dataset.session
    );
  }

  function renderApprovals(list) {
    const bar = $("#approvalBar");
    if (!bar) return;
    const items = (list ?? []).filter((entry) => entry && entry.answerable !== false);
    state.approvals = items;
    if (items.length === 0) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    bar.textContent = `有 ${items.length} 个审批待处理 · 点此查看`;
  }

  function openApprovalsSheet() {
    const items = state.approvals ?? [];
    if (items.length === 0) {
      showToast("当前没有待处理审批");
      return;
    }
    openSheet(`<h3>待处理审批</h3>
      <p class="sheet-sub">来自 Bot 的工具调用，需要你允许或拒绝；拒绝后这一轮会停下。</p>
      ${items
        .map(
          (entry) => `<div class="rc approval" style="margin-bottom:10px">
            <div class="rc-head"><span class="lvl">审批</span></div>
            <div class="rc-title">${esc(entry.tool || "工具调用")}</div>
            <div class="rc-desc">${esc(entry.reason || entry.detail?.text || "需要你的确认")}</div>
            <div class="rc-actions">
              <button class="btn danger" data-approve-tool="${esc(entry.id)}" data-choice="reject">拒绝</button>
              <button class="btn primary" data-approve-tool="${esc(entry.id)}" data-choice="allow">允许</button>
            </div>
          </div>`
        )
        .join("")}
      <div class="sheet-footer"><button class="btn" data-act="sheet-close">关闭</button></div>`);
  }

  async function answerApproval(id, choice) {
    try {
      await liveFetch("/__im/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, choice })
      });
      showToast(choice === "allow" ? "已允许" : "已拒绝");
      closeSheet();
      const snapshot = await liveFetch("/__im/state");
      renderApprovals(snapshot.work?.approvals ?? []);
    } catch (error) {
      showToast("操作失败：" + error.message);
    }
  }

  function liveMessages(items) {
    const byName = new Map(state.bots.map((bot) => [bot.name, bot.id]));
    return items.map((item) => ({
      id: item.id ?? String(item.seq),
      from: item.kind === "me" ? "me" : "them",
      sender:
        item.kind === "bot"
          ? byName.get(item.sender) ?? item.sender ?? undefined
          : undefined,
      time: hm(item.time),
      rawTime: item.time ?? 0,
      image: item.image ?? null,
      file:
        item.kind === "file"
          ? {
              name: item.title ?? "产物",
              meta: item.description ?? "",
              path: item.path ?? ""
            }
          : undefined,
      type: item.kind === "event" ? "system" : item.kind === "file" ? "file" : "text",
      text: item.text ?? ""
    }));
  }

  async function liveLoadChat(id, force) {
    try {
      const data = await liveFetch("/__im/chat?id=" + encodeURIComponent(id));
      const messages = liveMessages(data.items ?? []);
      if (data.kind === "bot" && messages.length > 0) {
        // 私聊里 Bot 消息没有 sender 字段：就是当前会话的 Bot
        messages.forEach((message) => {
          if (message.from === "them" && !message.sender) message.sender = id;
        });
      }
      const signature = id + "|" + messages.length + "|" + (messages.at(-1)?.id ?? "");
      if (!force && state.liveLastChat === signature) return;
      state.liveLastChat = signature;
      const seqOf = (item) => Number(String(item.id ?? "").replace(/^[a-z]+/i, "")) || 0;
      const minNew = messages.length > 0 ? Math.min(...messages.map(seqOf)) : Infinity;
      const preserved = (state.messages[id] ?? []).filter(
        (item) => seqOf(item) < minNew && !messages.some((next) => next.id === item.id)
      );
      if (data.sessionStatus !== undefined) {
        if (data.sessionStatus) {
          state.sessionWork[id] = data.sessionStatus;
          if (state.chatId === id) state.liveRunning = true;
        } else {
          delete state.sessionWork[id];
        }
        updateLiveStatus();
      }
      state.messages[id] = [...preserved, ...messages].filter(
        (message) => message.id !== "loading"
      );
      if (messages.length === 0 && state.messages[id].length === 0) {
        state.messages[id] = [];
      }
      const rawTimes = messages.map((message) => message.rawTime).filter((value) => value > 0);
      if (rawTimes.length > 0) {
        const conv = convById(id);
        if (conv && Math.max(...rawTimes) > (conv.lastAt ?? 0)) {
          conv.lastAt = Math.max(...rawTimes);
          state.lastAt[id] = conv.lastAt;
          saveLastAt();
          renderChats();
        }
      }
      const previous = state.chatMeta[id] ?? {};
      state.chatMeta[id] = {
        hasMore: data.hasMore ?? false,
        cursor: data.cursor ?? null,
        kind: data.kind,
        loadedEarlier: preserved.length > 0 || previous.loadedEarlier === true
      };
      if (state.chatId === id) {
        renderMessages();
        scrollChatToBottom("auto");
      }
    } catch (error) {
      // 网关或 DSH 暂时不可用：留着已有内容，下次轮询再试
    }
  }

  async function liveLoadEarlier(id) {
    const meta = state.chatMeta[id];
    if (!meta || !meta.hasMore || !meta.cursor) return;
    try {
      const data = await liveFetch(
        "/__im/chat?id=" + encodeURIComponent(id) + "&cursor=" + encodeURIComponent(meta.cursor)
      );
      const older = liveMessages(data.items ?? []);
      const existing = state.messages[id] ?? [];
      const merged = [...older.filter((item) => !existing.some((other) => other.id === item.id)), ...existing];
      state.messages[id] = merged;
      state.chatMeta[id] = {
        hasMore: data.hasMore ?? false,
        cursor: data.cursor ?? null,
        kind: data.kind,
        loadedEarlier: true
      };
      const scroller = el.chatScroll;
      const fromBottom = scroller.scrollHeight - scroller.scrollTop;
      renderMessages();
      requestAnimationFrame(() => {
        scroller.scrollTop = scroller.scrollHeight - fromBottom;
      });
    } catch (error) {
      showToast("加载失败：" + error.message);
    }
  }

  function livePoll(delay) {
    if (!state.live) return;
    window.__kpaoHeartbeat?.();
    setTimeout(async () => {
      if (state.liveBusy) {
        livePoll(1200);
        return;
      }
      state.liveBusy = true;
      try {
        const snapshot = await liveFetch("/__im/state");
        setDataSource("真实数据 · " + hm(Date.now()));
        state.liveState = snapshot;
        state.liveWork = snapshot.work ?? {};
        state.liveActivity = snapshot.activity ?? {};
        state.sessionWork = { ...(state.sessionWork ?? {}), ...(snapshot.sessionWork ?? {}) };
        buildOwnerMap(snapshot);
        state.pollTick = (state.pollTick ?? 0) + 1;
        if (state.chatId) {
          if (state.pollTick % 2 === 0) void loadPending();
          else renderCardDock();
          void loadDeliverables(state.chatId);
        } else renderCardDock();
        const workBots = state.liveWork.bots ?? {};
        const activity = state.liveActivity;
        state.bots.forEach((bot) => {
          const act = activity[bot.id];
          const running =
            !!workBots[bot.id] ||
            act === "thinking" || act === "working" || act === "waiting" || act === "alert";
          bot.status = running ? "busy" : "online";
          bot.statusText = running ? (act === "alert" ? "等待审批" : act === "waiting" ? "等待结果" : "运行中") : "在线";
        });
        state.liveRunning =
          Object.keys(workBots).length > 0 ||
          Object.keys(state.liveWork.rooms ?? {}).length > 0 ||
          Object.values(activity).some((value) => value && value !== "idle");
        (snapshot.rooms ?? []).forEach((room) => {
          const conv = convById(room.id);
          if (conv) conv.last = String(room.preview || "暂无消息").replace(/\s+/g, " ").slice(0, 80);
        });
        renderApprovals(snapshot.work?.approvals ?? []);
        renderChats();
        if (state.chatId) await liveLoadChat(state.chatId);
        state.liveRunning =
          Object.keys(workBots).length > 0 ||
          Object.keys(state.liveWork.rooms ?? {}).length > 0 ||
          Object.values(activity).some((value) => value && value !== "idle") ||
          !!(state.live && state.chatId && liveStatusFor(currentConv()));
        updateLiveStatus();
      } catch {
        // 下一轮再试
      }
      state.liveBusy = false;
      // 有 Bot 在跑时加快刷新，能及时看到「思考中」→ 结果
      livePoll(state.liveRunning ? 1500 : 4000);
    }, delay ?? 4000);
  }

  async function liveSend(id, text) {
    await liveFetch("/__im/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, text })
    });
    setTimeout(() => liveLoadChat(id, true), 900);
  }

  async function liveCreateRoom(name, members) {
    const result = await liveFetch("/__im/create-room", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, members })
    });
    await liveLoadState();
    showToast(`群聊「${name}」已创建`);
    if (result?.value?.id) location.hash = "#/chat/" + encodeURIComponent(result.value.id);
  }

  async function liveCreateBot(name, role, dept) {
    await liveFetch("/__im/create-bot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, role, color: DEPT_COLOR[dept] ?? "deepseek" })
    });
    await liveLoadState();
    showToast(`已添加 agent：${name}`);
  }

  async function liveAddMembers(convId, ids) {
    await liveFetch("/__im/add-members", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: convId, add: ids })
    });
    await liveLoadState();
    await liveLoadChat(convId, true);
    showToast("成员已添加");
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("读取图片失败"));
      reader.readAsDataURL(file);
    });
  }

  function loadImageNode(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("图片无法解码"));
      image.src = src;
    });
  }

  /** 手机照片可能是 HEIC / 超大图：先压成 JPEG（最长边 1600），保证网页能显示、上传也快。 */
  async function prepareImage(file) {
    const raw = await fileToDataUrl(file);
    try {
      const image = await loadImageNode(raw);
      const max = 1600;
      const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, width, height);
      return {
        dataUrl: canvas.toDataURL("image/jpeg", 0.85),
        mime: "image/jpeg",
        name: (file.name || "image").replace(/\.[^.]+$/u, "") + ".jpg"
      };
    } catch {
      return { dataUrl: raw, mime: file.type, name: file.name || "image" };
    }
  }

  async function sendImage(file) {
    const chatId = state.chatId;
    if (!chatId) return;
    if (!/^image\//.test(file.type)) {
      showToast("只支持图片");
      return;
    }
    if (!state.live) {
      showToast("本地演示模式，未上传");
      return;
    }
    showToast("正在上传图片…");
    try {
      const prepared = await prepareImage(file);
      const base64 = prepared.dataUrl.split(",")[1] ?? "";
      if (base64.length * 0.75 > 10 * 1024 * 1024) {
        showToast("图片太大，压缩后仍超过 10MB");
        return;
      }
      const uploaded = await liveFetch("/__im/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: prepared.name, mime: prepared.mime, data: base64 })
      });
      state.pendingImage = uploaded.path;
      renderPendingImage();
      showToast("图片已就绪，输入文字后一起发送");
    } catch (error) {
      showToast("图片发送失败：" + error.message);
    }
  }

  function updateComposerSend() {
    const running = isCurrentRunning();
    if (el.stopBtn) el.stopBtn.hidden = !running;
    el.sendBtn.classList.remove("is-stop");
    el.sendBtn.innerHTML = '<svg class="ic"><use href="#i-send"/></svg>';
    const hasText = el.composerInput.value.trim().length > 0;
    // 任务在跑时也允许发消息：这就是「插话」，会走和电脑端一样的 send / queue 逻辑。
    el.sendBtn.disabled = !(hasText || state.pendingImage);
  }

  function isCurrentRunning() {
    const conv = currentConv();
    return !!(state.live && conv && liveStatusFor(conv));
  }

  async function stopCurrentTask() {
    if (!state.chatId) return;
    try {
      await liveFetch("/__im/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: state.chatId })
      });
      showToast("已请求中断当前任务");
      setTimeout(() => {
        if (state.chatId) liveLoadChat(state.chatId, true);
      }, 800);
    } catch (error) {
      showToast("中断失败：" + error.message);
    }
  }

  function renderPendingImage() {
    const box = el.pendingImage;
    const thumb = el.pendingImageThumb;
    if (!box || !thumb) return;
    if (state.pendingImage) {
      box.hidden = false;
      thumb.src = "/__im/files?path=" + encodeURIComponent(state.pendingImage);
    } else {
      box.hidden = true;
      thumb.removeAttribute("src");
    }
    updateComposerSend();
  }

  function clearPendingImage() {
    state.pendingImage = null;
    renderPendingImage();
  }


  /* ---------------------------- 工具 ---------------------------- */

  function esc(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[ch]);
  }

  function nowHM() {
    const d = new Date();
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function botStyle(target) {
    const dept = D.DEPTS[target.dept];
    return `--a1:${dept.a1};--a2:${dept.a2}`;
  }

  function botAvatar(target, extraClass = "") {
    if (!target) return "";
    const dot = target.status === "idle" ? "" : `<i class="dot ${target.status}"></i>`;
    return `<div class="avatar ${extraClass}" style="${botStyle(target)}"><span>${esc(target.glyph)}</span>${dot}</div>`;
  }

  function groupAvatar(conv, extraClass = "") {
    const name = String((conv && conv.name) || "群");
    const glyph = /^[A-Za-z]/.test(name) ? name.slice(0, 1).toUpperCase() : name.slice(0, 1);
    return `<div class="avatar ${extraClass}"><span>${esc(glyph)}</span></div>`;
  }

  function statusDotClass(target) {
    return target.status === "online" ? "online" : target.status === "busy" ? "busy" : "";
  }

  function totalUnread() {
    return state.convs.reduce((sum, c) => sum + (c.unread || 0), 0);
  }

  function convName(conv) {
    if (conv.kind === "group") return conv.name;
    const target = state.botMap[conv.id];
    return target ? target.name : conv.name || "会话";
  }

  function pinKey(conv) {
    return conv && conv.agentSession ? "__agent__" : conv ? conv.id : "";
  }

  function isPinned(conv) {
    return !!conv && (conv.pin === true || state.pins.includes(pinKey(conv)));
  }

  function touchConv(id) {
    const conv = convById(id);
    if (!conv) return;
    conv.lastAt = Date.now();
    state.lastAt[id] = conv.lastAt;
    saveLastAt();
    renderChats();
  }

  function saveLastAt() {
    try {
      localStorage.setItem("kpao-last-at", JSON.stringify(state.lastAt));
    } catch {}
  }

  function togglePin(id) {
    const conv = convById(id);
    const key = conv ? pinKey(conv) : id;
    state.pins = state.pins.includes(key)
      ? state.pins.filter((item) => item !== key)
      : [...state.pins, key];
    try {
      localStorage.setItem("kpao-pins", JSON.stringify(state.pins));
    } catch {}
    renderChats();
    closeSheet();
    showToast(state.pins.includes(key) ? "已置顶" : "已取消置顶");
  }

  function openPinSheet(id) {
    const conv = convById(id);
    if (!conv) return;
    const pinned = isPinned(conv);
    openSheet(`<h3>${esc(convName(conv))}</h3>
      <p class="sheet-sub">${pinned ? "已置顶，会排在消息列表最前面。" : "置顶后会排在消息列表最前面。"}</p>
      <div class="group-card">
        <button class="menu-row" data-pin-conv="${conv.id}">
          <span class="menu-ic"><svg class="ic"><use href="#i-pin"/></svg></span>
          <span class="menu-label">${pinned ? "取消置顶" : "置顶会话"}</span>
        </button>
        <button class="menu-row" data-clear-conv="${conv.id}">
          <span class="menu-ic"><svg class="ic"><use href="#i-close"/></svg></span>
          <span class="menu-label" style="color:var(--danger)">清除对话</span>
        </button>
      </div>`);
  }

  function deptCount(conv) {
    const depts = new Set((conv.memberIds || []).map((id) => state.botMap[id]?.dept).filter(Boolean));
    return depts.size;
  }

  function memberNames(conv, max = 4) {
    const names = (conv.memberIds || []).map((id) => state.botMap[id]?.name).filter(Boolean);
    if (names.length <= max) return names.join("、");
    return names.slice(0, max).join("、") + ` 等 ${names.length} 个`;
  }

  /* ---------------------------- 会话列表 ---------------------------- */

  function renderChats() {
    const q = state.searchChat.trim().toLowerCase();
    const list = state.convs
      .filter((conv) => !state.hidden.includes(conv.id))
      .filter((conv) => {
        if (!q) return true;
        const target = conv.kind === "bot" ? state.botMap[conv.id] : null;
        const name = convName(conv).toLowerCase();
        const last = (conv.typing ? "正在输入" : conv.last).toLowerCase();
        const role = target ? target.role.toLowerCase() : conv.kind === "group" ? "指挥部 群聊" : "会话";
        return name.includes(q) || last.includes(q) || role.includes(q);
      })
      .sort((a, b) => {
        const pinDiff = Number(isPinned(b)) - Number(isPinned(a));
        if (pinDiff !== 0) return pinDiff;
        return (b.lastAt ?? 0) - (a.lastAt ?? 0);
      });

    if (list.length === 0) {
      el.chatList.innerHTML = `<div class="empty">没有匹配的会话<br>换个关键词试试</div>`;
      return;
    }

    el.chatList.innerHTML = list
      .map((conv) => {
        const isGroup = conv.kind === "group";
        const target = isGroup ? null : state.botMap[conv.id] || null;
        const avatar = isGroup
          ? groupAvatar(conv)
          : target
            ? botAvatar(target)
            : `<div class="avatar"><span>会</span></div>`;
        const preview = (() => {
          const live = state.live ? liveStatusFor(conv) : null;
          if (live) {
            return `<span class="row-preview is-typing">${esc(
              live.text
            )}<span class="typing-dots"><i></i><i></i><i></i></span></span>`;
          }
          return conv.typing
            ? `<span class="row-preview is-typing">正在输入<span class="typing-dots"><i></i><i></i><i></i></span></span>`
            : `<span class="row-preview">${esc(conv.last)}</span>`;
        })();
        const badge = conv.unread
          ? `<span class="badge">${conv.unread > 99 ? "99+" : conv.unread}</span>`
          : "";
        return `<button class="chat-row${isPinned(conv) ? " is-pinned" : ""}" data-open="${conv.id}" aria-label="打开与${esc(
          convName(conv)
        )}的对话">
          ${avatar}
          <span class="row-main">
            <span class="row-top">
              <span class="row-name">${esc(convName(conv))}</span>
              ${isGroup ? `<span class="member-chip">${conv.memberIds.length + 1} 人</span>` : ""}
              ${isPinned(conv) ? `<svg class="ic pin-ic"><use href="#i-pin"/></svg>` : ""}
              <span class="row-time">${esc(conv.time)}</span>
            </span>
            <span class="row-bottom">${preview}${badge}</span>
          </span>
        </button>`;
      })
      .join("");

    updateTabBadge();
  }

  function updateTabBadge() {
    const count = totalUnread();
    el.tabBadge.textContent = count > 99 ? "99+" : String(count);
    el.tabBadge.hidden = count === 0;
  }

  /* ---------------------------- 通讯录 ---------------------------- */

  function renderContacts() {
    const q = state.searchContact.trim().toLowerCase();
    const matches = state.bots.filter((target) => {
      if (!q) return true;
      const dept = D.DEPTS[target.dept];
      return (
        target.name.toLowerCase().includes(q) ||
        target.role.toLowerCase().includes(q) ||
        target.short.toLowerCase().includes(q) ||
        dept.name.includes(q) ||
        target.id.toLowerCase().includes(q)
      );
    });

    if (matches.length === 0) {
      el.contactList.innerHTML = `<div class="empty">没有匹配的 Bot<br>试试「内容」「情报」或「Chief」</div>`;
      return;
    }

    const html = [];
    if (q) {
      html.push(
        `<div class="section-head"><span>搜索结果</span><span class="count">${matches.length}</span></div>`
      );
      html.push(
        matches
          .map((target) => {
            const dept = D.DEPTS[target.dept];
            return `<button class="contact-row" data-open="${target.id}">
              ${botAvatar(target)}
              <span class="contact-main">
                <span class="contact-name">${esc(target.name)}</span>
                <span class="contact-role">${esc(target.role)}</span>
              </span>
              <span class="dept-tag">${esc(dept.name)}</span>
              <svg class="ic chev"><use href="#i-chev"/></svg>
            </button>`;
          })
          .join("")
      );
    } else {
      DEPT_ORDER.forEach((deptKey) => {
        const dept = D.DEPTS[deptKey];
        const bots = state.bots.filter((b) => b.dept === deptKey);
        html.push(
          `<div class="section-head"><span>${esc(dept.name)}</span><span class="count">${bots.length} 个 Bot</span></div>`
        );
        html.push(
          bots
            .map(
              (target) => `<button class="contact-row" data-open="${target.id}">
                ${botAvatar(target)}
                <span class="contact-main">
                  <span class="contact-name">${esc(target.name)}</span>
                  <span class="contact-role">${esc(target.short)}</span>
                </span>
                <span class="row-status"><i class="st-dot ${statusDotClass(target)}"></i>${esc(target.statusText)}</span>
                <svg class="ic chev"><use href="#i-chev"/></svg>
              </button>`
            )
            .join("")
        );
      });
    }
    el.contactList.innerHTML = html.join("");
  }

  /* ---------------------------- 聊天框 ---------------------------- */

  function currentConv() {
    return state.chatId ? convById(state.chatId) : null;
  }

  function openChat(id) {
    let conv = convById(id);
    if (!conv) {
      // 新添加的 agent 还没有会话：第一次点开时按需创建
      const target = state.botMap[id];
      if (!target) {
        // 普通 DSH 会话（手机端新建 / 历史会话）
        conv = {
          id,
          kind: "bot",
          name: "新会话",
          last: "新会话",
          time: nowHM(),
          unread: 0,
          lastAt: Date.now(),
          plainSession: true
        };
        state.convs.unshift(conv);
        if (!state.messages[id]) {
          state.messages[id] = [{
            id: "sys" + Date.now(), from: "system", time: nowHM(), type: "system",
            text: "新会话已开始，发条消息试试"
          }];
        }
        renderChats();
      } else {
        conv = { id, kind: "bot", last: `开始和 ${target.name} 对话`, time: nowHM(), unread: 0 };
        state.convs.unshift(conv);
        state.messages[id] = [{
          id: "sys" + Date.now(), from: "system", time: nowHM(), type: "system",
          text: `你和 ${target.name} 的对话已开始`
        }];
        renderChats();
      }
    }
    state.chatId = id;
    conv.unread = 0;
    if (state.live) {
      if (!state.messages[id]) {
        state.messages[id] = [{ id: "loading", from: "system", time: "", type: "system", text: "正在加载消息…" }];
      }
      liveLoadChat(id);
    }
    if (conv.kind === "group") {
      if (!conv.memberIds) conv.memberIds = state.bots.map((b) => b.id);
      if (!state.messages[id]) state.messages[id] = [];
      el.chatAvatar.outerHTML = groupAvatar(conv, "avatar-sm").replace(
        'class="avatar avatar-sm"',
        'class="avatar avatar-sm" id="chatAvatar"'
      );
      el.chatAvatar = $("#chatAvatar");
      el.chatName.textContent = conv.name;
      el.chatStatus.innerHTML = `<i class="st-dot online"></i>${conv.memberIds.length + 1} 位成员 · ${deptCount(
        conv
      )} 个部门`;
    } else {
      const target = state.botMap[id];
      if (target) {
        el.chatAvatar.outerHTML = botAvatar(target, "avatar-sm").replace(
          'class="avatar avatar-sm"',
          'class="avatar avatar-sm" id="chatAvatar"'
        );
        el.chatName.textContent = target.name;
        el.chatStatus.innerHTML = target.agent
          ? `<i class="st-dot online"></i>桌面端会话 · 可直接对话`
          : `<i class="st-dot ${statusDotClass(target)}"></i>${esc(target.statusText)} · ${esc(
              D.DEPTS[target.dept].name
            )}`;
      } else {
        el.chatAvatar.outerHTML =
          '<div class="avatar avatar-sm" id="chatAvatar"><span>会</span></div>';
        el.chatName.textContent = conv.name || "会话";
        el.chatStatus.innerHTML = conv.agentSession
          ? `<i class="st-dot online"></i>当前 DSH 会话 · 可直接对话`
          : `<i class="st-dot online"></i>普通会话 · 可直接对话`;
      }
      el.chatAvatar = $("#chatAvatar");
    }

    el.chatView.classList.add("is-open");
    el.chatView.setAttribute("aria-hidden", "false");
    renderMessages();
    renderQuick(conv.kind === "group" ? "group" : id);
    renderChats();
    updateTabBadge();
    updateLiveStatus();
    void loadPending();
    void loadDeliverables(id);
    resetComposer();
    let atTop = false;
    try {
      atTop = new URLSearchParams(location.search).get("scroll") === "top";
    } catch {}
    if (atTop) {
      requestAnimationFrame(() => {
        el.chatScroll.scrollTop = 0;
      });
    } else {
      requestAnimationFrame(() => scrollChatToBottom("auto"));
      setTimeout(() => scrollChatToBottom("auto"), 260);
    }
  }

  function closeChat() {
    state.chatId = null;
    el.chatView.classList.remove("is-open");
    el.chatView.setAttribute("aria-hidden", "true");
  }

  function renderQuick(key) {
    const chips = D.QUICK_REPLIES[key] || D.QUICK_REPLIES.default;
    el.quickRow.innerHTML = chips
      .map((text) => `<button class="quick-chip" data-quick="${esc(text)}">${esc(text)}</button>`)
      .join("");
  }

  function renderMessages() {
    const msgs = state.messages[state.chatId] || [];
    const conv = currentConv();
    const isGroup = conv && conv.kind === "group";
    const html = [];
    const meta = state.chatMeta[state.chatId];
    if (state.live && meta && meta.hasMore) {
      html.push(`<button class="load-more" data-act="load-more">加载更早的消息</button>`);
    }
    html.push(`<div class="day-sep"><span>今天</span></div>`);
    msgs.forEach((msg) => html.push(messageHTML(msg, isGroup)));
    el.chatScroll.innerHTML = html.join("");
    bindApprovalButtons();
  }

  function markdownImages(html) {
    return html.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_match, alt, src) => {
      return `<span class="msg-img-wrap" data-image="${src}" role="button" tabindex="0" aria-label="查看大图"><img class="msg-img" src="${imageSource(src)}" alt="${alt}" loading="lazy"></span>`;
    });
  }

  function inlineMarkdown(html) {
    html = markdownImages(html);
    return html
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(
        /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
        '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>'
      );
  }

  /** 轻量 Markdown：代码块、表格、行内代码、粗体、标题、链接、列表。 */
  function renderMarkdown(text) {
    let html = esc(String(text ?? ""));
    html = html.replace(
      /```([\s\S]*?)```/g,
      (_match, code) => `<pre class="md-pre">${code.replace(/^\n+|\n+$/g, "")}</pre>`
    );
    const lines = html.split("\n");
    const output = [];
    const isRow = (line) => /^\s*\|.*\|\s*$/.test(line);
    const isSeparator = (line) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const next = lines[index + 1] ?? "";
      if (isRow(line) && isSeparator(next)) {
        const cellsOf = (row) =>
          row
            .trim()
            .replace(/^\|/u, "")
            .replace(/\|$/u, "")
            .split("|")
            .map((cell) => inlineMarkdown(cell.trim()));
        const head = cellsOf(line);
        index += 1;
        const body = [];
        while (index + 1 < lines.length && isRow(lines[index + 1])) {
          index += 1;
          body.push(cellsOf(lines[index]));
        }
        output.push(
          `<div class="md-table-wrap"><table class="md-table"><thead><tr>${head
            .map((cell) => `<th>${cell}</th>`)
            .join("")}</tr></thead><tbody>${body
            .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
            .join("")}</tbody></table></div>`
        );
        continue;
      }
      output.push(line);
    }
    html = output.join("\n");
    html = inlineMarkdown(html);
    html = html.replace(/^#{1,6}\s+(.+)$/gm, '<span class="md-h">$1</span>');
    html = html.replace(/^(\s*)[-*]\s+/gm, "$1• ");
    return html;
  }

  /** 消息里出现任务编号时，补一张真实任务卡。 */
  function taskCardsFor(text) {
    if (!state.tasks) return "";
    const ids = [...new Set(String(text ?? "").match(/T-\d{8}-\d{2}/g) ?? [])].slice(0, 2);
    return ids
      .map((id) => {
        const task = state.tasks[id];
        if (!task) return "";
        const cls =
          task.status === "completed" ? "done" : task.status === "in_progress" ? "running" : task.status === "blocked" ? "blocked" : "wait";
        return `<div class="rc task-rc">
          <div class="task-head"><span class="chip">${esc(task.id)}</span><span class="state ${cls}">${esc(
            TASK_STATUS[task.status] ?? task.status
          )}</span></div>
          <div class="task-title">${esc(task.title)}</div>
          <div class="task-meta"><span>负责 ${esc(task.owner)}</span><span>${esc(
            task.priority
          )}</span></div>
        </div>`;
      })
      .join("");
  }

  function senderAvatar(msg) {
    return botAvatar(bot(msg.sender));
  }

  function imagePathFromText(text) {
    const match = String(text ?? "").match(/【图片】\s*(uploads\/[^\s`]+)/u);
    return match ? match[1] : null;
  }

  function imageBubbleHTML(path) {
    const src = "/__im/files?path=" + encodeURIComponent(path);
    return `<div class="msg-img-wrap" data-image="${esc(path)}" role="button" tabindex="0" aria-label="查看大图"><img class="msg-img" src="${src}" alt="图片" loading="lazy"></div>`;
  }

  function imageSource(path) {
    if (/^https?:\/\//i.test(path) || path.startsWith("/__im/files")) return path;
    return "/__im/files?path=" + encodeURIComponent(path);
  }

  function openImageViewer(path) {
    const viewer = $("#imageViewer");
    const image = $("#imageViewerImg");
    if (!viewer || !image) return;
    image.src = imageSource(path);
    viewer.hidden = false;
    requestAnimationFrame(() => viewer.classList.add("is-open"));
  }

  function closeImageViewer() {
    const viewer = $("#imageViewer");
    const image = $("#imageViewerImg");
    if (!viewer || viewer.hidden) return;
    viewer.classList.remove("is-open");
    setTimeout(() => {
      viewer.hidden = true;
      if (image) image.removeAttribute("src");
    }, 160);
  }

  async function openFileViewer(path, title) {
    const viewer = $("#fileViewer");
    const body = $("#fileViewerBody");
    const titleEl = $("#fileViewerTitle");
    const raw = $("#fileViewerRaw");
    if (!viewer || !body || !path) return;
    const name = title || String(path).split(/[\\/]/).pop() || "文件";
    if (titleEl) titleEl.textContent = name;
    if (raw) raw.href = "/__im/file?raw=1&path=" + encodeURIComponent(path);
    viewer.hidden = false;
    body.innerHTML = `<div class="empty">正在打开…</div>`;
    try {
      const data = await liveFetch("/__im/file?path=" + encodeURIComponent(path));
      const ext = String(data.ext ?? "").toLowerCase();
      if (ext === ".md" || ext === ".markdown") {
        body.innerHTML = `<div class="md-doc">${renderMarkdown(data.text ?? "")}</div>`;
      } else {
        body.innerHTML = `<pre>${esc(data.text ?? "")}</pre>`;
      }
      if (titleEl && data.title) titleEl.textContent = data.title;
    } catch (error) {
      body.innerHTML = `<div class="empty">打开失败：${esc(
        error.message
      )}<br><br>可以点下面的按钮下载原文件。</div>`;
    }
  }

  function closeFileViewer() {
    const viewer = $("#fileViewer");
    if (!viewer || viewer.hidden) return;
    viewer.hidden = true;
    const body = $("#fileViewerBody");
    if (body) body.innerHTML = "";
  }

  function messageHTML(msg, isGroup) {
    if (msg.type === "system") {
      return `<div class="msg system"><div class="system-pill">${esc(msg.text)}</div></div>`;
    }

    const mine = msg.from === "me";
    const body = [];

    if (!mine && isGroup && msg.sender && state.botMap[msg.sender]) {
      body.push(`<div class="sender">${esc(bot(msg.sender).name)}</div>`);
    }

    const imagePath =
      msg.type === "image" ? msg.path : msg.type === "text" ? msg.image ?? null : null;
    if (imagePath) {
      const caption =
        msg.type === "text"
          ? String(msg.text).replace(/【图片】\s*uploads\/[^\s`]+/u, "").trim()
          : "";
      if (caption !== "") body.push(`<div class="bubble">${renderMarkdown(caption)}</div>`);
      body.push(imageBubbleHTML(imagePath));
    } else if (msg.type === "text" || msg.type === "typing") {
      const typing =
        msg.type === "typing"
          ? `<span class="typing-dots"><i></i><i></i><i></i></span>`
          : "";
      body.push(`<div class="bubble">${renderMarkdown(msg.text)}${typing}</div>`);
      if (!mine) body.push(taskCardsFor(msg.text));
    } else if (msg.type === "task") {
      body.push(taskCardHTML(msg.task));
    } else if (msg.type === "approval") {
      body.push(approvalCardHTML(msg));
    } else if (msg.type === "file") {
      const file = msg.file ?? { name: "文件", meta: "", path: "" };
      const previewable = !!file.path;
      body.push(
        `<div class="file-rc">
          <div class="file-ic"><svg class="ic"><use href="#i-doc"/></svg></div>
          <div class="file-info">
            <div class="file-name">${esc(file.name)}</div>
            <div class="file-meta">${esc(file.meta)}</div>
          </div>
          ${
            previewable
              ? `<button class="file-go" data-file="${esc(file.path)}">查看</button>`
              : `<button class="file-go" data-act="toast" data-toast="文件预览入口（原型占位）">预览</button>`
          }
        </div>`
      );
    }

    body.push(`<div class="msg-time">${esc(msg.time)}</div>`);

    const avatar = mine ? "" : senderAvatar(msg);
    return `<div class="msg ${mine ? "me" : "them"}" data-msg="${esc(msg.id)}">${avatar}<div class="msg-body">${body.join("")}</div></div>`;
  }

  function taskCardHTML(task) {
    const stateClass =
      task.state === "done" ? "done" : task.state === "wait" ? "wait" : "running";
    return `<div class="rc">
      <div class="rc-head">
        <span class="chip">${esc(task.code)}</span>
        <span class="state ${stateClass}">${esc(task.stateText)}</span>
      </div>
      <div class="rc-title">${esc(task.title)}</div>
      <div class="rc-meta">
        <span>负责 <b>${esc(task.owner)}</b></span>
        <span>优先级 <b>${esc(task.priority)}</b></span>
        <span>截止 <b>${esc(task.due)}</b></span>
      </div>
      ${typeof task.progress === "number" ? `<div class="progress"><i style="width:${task.progress}%"></i></div>` : ""}
      <div class="rc-actions">
        <button class="btn ghost" data-act="toast" data-toast="任务板入口（原型占位）">查看任务板</button>
        <button class="btn" data-act="toast" data-toast="已提醒 Chief 更新进度（演示）">催一下</button>
      </div>
    </div>`;
  }

  function approvalCardHTML(msg) {
    const a = msg.approval;
    const head = `<div class="rc-head">
        <span class="lvl">${esc(a.level)} 审批</span>
        <span class="state ${a.state === "pending" ? "wait" : "done"}">${
          a.state === "pending" ? "待你批准" : a.state === "approved" ? "已批准" : "已驳回"
        }</span>
      </div>
      <div class="rc-title">${esc(a.title)}</div>
      <div class="rc-desc">${esc(a.desc)}</div>`;

    let actions = "";
    if (a.state === "pending") {
      actions = `<div class="rc-actions">
          <button class="btn danger" data-approve="${msg.id}" data-answer="reject">驳回</button>
          <button class="btn primary" data-approve="${msg.id}" data-answer="approve">批准</button>
        </div>`;
    } else if (a.state === "approved") {
      actions = `<div class="approved-note"><svg class="ic"><use href="#i-check"/></svg>已批准 · 发布前仍需过事实核查</div>`;
    } else {
      actions = `<div class="approved-note" style="color:var(--danger)"><svg class="ic"><use href="#i-close"/></svg>已驳回 · 请 Chief 重新提交</div>`;
    }

    return `<div class="rc approval">${head}${actions}</div>`;
  }

  async function copyText(text) {
    const value = String(text ?? "");
    if (value === "") return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement("textarea");
      area.value = value;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand("copy");
      } catch {}
      area.remove();
    }
    showToast("已复制");
  }

  function openMessageActions(messageEl) {
    const id = messageEl.dataset.msg;
    const msg = (state.messages[state.chatId] || []).find((item) => item.id === id);
    if (!msg) return;
    const text = String(msg.text ?? "").trim();
    const image = msg.image || (msg.type === "image" ? msg.path : null);
    if (text === "" && !image) return;
    openSheet(`<h3>消息</h3>
      <p class="sheet-sub">${esc(text ? text.slice(0, 90) : "图片消息")}</p>
      <div class="group-card">
        ${
          text
            ? `<button class="menu-row" data-copy-msg="${esc(id)}">
          <span class="menu-ic"><svg class="ic"><use href="#i-doc"/></svg></span>
          <span class="menu-label">复制文字</span>
        </button>`
            : ""
        }
        ${
          image
            ? `<button class="menu-row" data-copy-image="${esc(image)}">
          <span class="menu-ic"><svg class="ic"><use href="#i-doc"/></svg></span>
          <span class="menu-label">复制图片路径</span>
        </button>`
            : ""
        }
      </div>`);
  }

  function bindApprovalButtons() {
    $$("[data-approve]", el.chatScroll).forEach((btn) => {
      btn.addEventListener("click", () => {
        const msg = (state.messages[state.chatId] || []).find((m) => m.id === btn.dataset.approve);
        if (!msg || !msg.approval) return;
        msg.approval.state = btn.dataset.answer === "approve" ? "approved" : "rejected";
        renderMessages();
        scrollChatToBottom("smooth");
        showToast(msg.approval.state === "approved" ? "已批准，Chief 会继续推进" : "已驳回，等 Chief 重新提交");
      });
    });
  }

  function scrollChatToBottom(behavior) {
    el.chatScroll.scrollTo({ top: el.chatScroll.scrollHeight, behavior: behavior || "auto" });
  }

  /* ---------------------------- 发送 ---------------------------- */

  function resetComposer() {
    el.composerInput.value = "";
    el.composerInput.style.height = "auto";
    updateComposerSend();
  }

  function pushMessage(msg) {
    if (!state.messages[state.chatId]) state.messages[state.chatId] = [];
    state.messages[state.chatId].push(msg);
  }

  function sendText(raw) {
    const typed = String(raw || "").trim();
    if (!state.chatId) return;
    if (typed === "" && !state.pendingImage) return;
    const marker = state.pendingImage ? `【图片】${state.pendingImage}` : "";
    const text = [typed, marker].filter(Boolean).join("\n");
    if (text.length > 1000000) {
      showToast("消息太长：单条上限约 100 万字");
      return;
    }
    state.pendingImage = null;
    renderPendingImage();
    const chatId = state.chatId;
    const conv = convById(chatId);

    pushMessage({ id: "m" + Date.now(), from: "me", time: nowHM(), type: "text", text });
    renderMessages();
    scrollChatToBottom("smooth");
    resetComposer();

    if (conv) {
      conv.last = text;
      conv.time = nowHM();
      conv.unread = 0;
      touchConv(chatId);
    }

    // 真实模式：发给本机 DSH / ds-bot，不再用本地模拟回复
    if (state.live) {
      liveSend(chatId, text).catch((error) => showToast("发送失败：" + error.message));
      return;
    }

    clearTimeout(state.replyTimer);
    state.replyTimer = setTimeout(() => {
      if (state.chatId !== chatId) return;
      const typingId = "t" + Date.now();
      const sender =
        conv && conv.kind === "group" && conv.memberIds.length > 0
          ? conv.memberIds[Math.floor(Math.random() * conv.memberIds.length)]
          : chatId;
      pushMessage({ id: typingId, from: "them", sender, time: nowHM(), type: "typing", text: "收到，正在处理" });
      renderMessages();
      scrollChatToBottom("smooth");

      state.replyTimer = setTimeout(() => {
        if (state.chatId !== chatId) return;
        const list = state.messages[chatId];
        const idx = list.findIndex((m) => m.id === typingId);
        const reply = D.AUTO_REPLY[sender] || D.AUTO_REPLY.default;
        const replyMsg = { id: "r" + Date.now(), from: "them", sender, time: nowHM(), type: "text", text: reply };
        if (idx >= 0) list.splice(idx, 1, replyMsg);
        else list.push(replyMsg);
        renderMessages();
        scrollChatToBottom("smooth");
        if (conv) {
          conv.last = reply;
          conv.time = "刚刚";
          conv.unread = 0;
          renderChats();
        }
      }, 1500);
    }, 500);
  }

  /* ---------------------------- 发起群聊 / 添加 agent ---------------------------- */

  function pickRowHTML(target, picked) {
    const dept = D.DEPTS[target.dept];
    return `<button class="pick-row${picked ? " is-picked" : ""}" data-pick="${target.id}">
      <span class="pick-check"><svg class="ic"><use href="#i-check"/></svg></span>
      ${botAvatar(target, "avatar-sm")}
      <span class="pick-main">
        <span class="pick-name">${esc(target.name)}</span>
        <span class="pick-role">${esc(dept.name)} · ${esc(target.short)}</span>
      </span>
    </button>`;
  }

  function openCreateGroup() {
    state.groupSelection = new Set(
      state.bots.filter((b) => !b.agent).slice(0, 3).map((b) => b.id)
    );
    const list = state.bots
      .filter((target) => !target.agent)
      .map((target) => pickRowHTML(target, state.groupSelection.has(target.id)))
      .join("");
    openSheet(`<h3>发起群聊</h3>
      <p class="sheet-sub">选择要拉进来的 Bot（可多选），下一步给群聊起名。</p>
      <div class="pick-list">${list}</div>
      <div class="sheet-footer">
        <button class="btn primary" data-group-next>下一步（已选 ${state.groupSelection.size}）</button>
      </div>
      <p class="hint">原型演示：新群只存在于当前页面，刷新后重置。</p>`);
  }

  function openGroupName() {
    const names = [...state.groupSelection].map((id) => bot(id).name).slice(0, 3).join("、");
    openSheet(`<h3>给群聊起个名字</h3>
      <p class="sheet-sub">已选 ${state.groupSelection.size} 个 Bot，加上你共 ${state.groupSelection.size + 1} 位成员。</p>
      <label class="field">
        <span>群聊名称</span>
        <input id="groupNameInput" maxlength="20" placeholder="例如：内容部小组" value="${esc(names)}">
      </label>
      <div class="quick-tags">
        <button class="quick-chip" data-group-name="内容部小组">内容部小组</button>
        <button class="quick-chip" data-group-name="信息差项目">信息差项目</button>
        <button class="quick-chip" data-group-name="周会">周会</button>
      </div>
      <div class="sheet-footer">
        <button class="btn primary" data-create-group>创建并进入</button>
      </div>`);
  }

  function createGroup(name) {
    if (state.live) {
      liveCreateRoom(name || "新群聊", [...state.groupSelection]).catch((error) =>
        showToast("建群失败：" + error.message)
      );
      return;
    }
    const memberIds = [...state.groupSelection];
    const id = "g" + Date.now();
    const conv = {
      id, kind: "group", name: name || "新群聊",
      memberIds, members: memberIds.length + 1,
      last: "群聊已创建", time: nowHM(), unread: 0
    };
    state.convs.unshift(conv);
    state.messages[id] = [{
      id: "sys" + Date.now(), from: "system", time: nowHM(), type: "system",
      text: `用户 创建了群聊「${conv.name}」 · ${memberNames(conv)}`
    }];
    state.groupSelection = new Set();
    closeSheet();
    renderChats();
    showToast(`群聊「${conv.name}」已创建`);
    location.hash = "#/chat/" + encodeURIComponent(id);
  }

  function openAddBot() {
    openSheet(`<h3>添加 agent</h3>
      <p class="sheet-sub">原型演示：只加到通讯录，不会真的创建 Bot。</p>
      <label class="field">
        <span>名称</span>
        <input id="newBotName" maxlength="12" placeholder="例如：数据分析师">
      </label>
      <label class="field">
        <span>岗位 / 一句话职责</span>
        <input id="newBotRole" maxlength="20" placeholder="例如：数据看板 · 指标口径">
      </label>
      <div class="field">
        <span>部门</span>
        <div class="seg" data-dept-group>
          ${DEPT_ORDER.map(
            (key) =>
              `<button class="seg-item${key === state.addBotDept ? " is-on" : ""}" data-dept="${key}">${esc(
                D.DEPTS[key].name
              )}</button>`
          ).join("")}
        </div>
      </div>
      <p class="hint">头像自动取名称首字，颜色跟随部门；添加后可在通讯录里直接聊天。</p>
      <div class="sheet-footer">
        <button class="btn primary" data-create-bot>添加到组织</button>
      </div>`);
  }

  function addBot(name, role, dept) {
    if (state.live) {
      closeSheet();
      liveCreateBot(name, role, dept).catch((error) => showToast("添加失败：" + error.message));
      return;
    }
    const id = "N" + String(state.bots.length + 1).padStart(3, "0");
    const target = {
      id,
      name,
      glyph: name.slice(0, 1),
      dept,
      role: role || "自定义岗位",
      short: role || "自定义岗位",
      status: "idle",
      statusText: "空闲"
    };
    state.bots.push(target);
    rebuildBotMap();
    renderContacts();
    renderChats();
    closeSheet();
    showToast(`已添加 agent：${name}`);
  }

  function openMembers(conv) {
    if (!conv) return;
    if (conv.kind !== "group") {
      if (!state.botMap[conv.id]) {
        showToast("普通会话没有成员信息");
        return;
      }
      openBotProfile(conv.id);
      return;
    }
    const members = conv.memberIds.map((id) => state.botMap[id]).filter(Boolean);
    const rows = members
      .map(
        (target) => `<div class="member-row">
          ${botAvatar(target, "avatar-sm")}
          <span class="member-name">${esc(target.name)}</span>
          <span class="member-role">${esc(target.short)}</span>
        </div>`
      )
      .join("");
    openSheet(`<h3>${esc(conv.name)} · 成员</h3>
      <p class="sheet-sub">${conv.memberIds.length} 个 Bot + 你，共 ${conv.memberIds.length + 1} 人</p>
      <div class="member-list">${rows}</div>
      <div class="sheet-footer">
        <button class="btn" data-open-add-members="${conv.id}">添加成员</button>
      </div>`);
  }

  function openBotProfile(id) {
    const target = bot(id);
    openSheet(`<h3>${esc(target.name)}</h3>
      <p class="sheet-sub">${esc(target.role)} · ${esc(D.DEPTS[target.dept].name)}</p>
      <div class="member-list">
        <div class="member-row">
          ${botAvatar(target, "avatar-sm")}
          <span class="member-name">${esc(target.name)}</span>
          <span class="member-role">${esc(target.statusText)}</span>
        </div>
      </div>
      <div class="sheet-footer">
        <button class="btn primary" data-open="${target.id}">发消息</button>
      </div>`);
  }

  function openAddMembers(conv) {
    if (!conv) return;
    state.memberSelection = new Set();
    const candidates = state.bots.filter((b) => !b.agent && !conv.memberIds.includes(b.id));
    if (candidates.length === 0) {
      openSheet(`<h3>添加成员</h3><p class="sheet-sub">所有 Bot 都已经在这个群里了。</p>
        <div class="sheet-footer"><button class="btn" data-act="sheet-close">知道了</button></div>`);
      return;
    }
    openSheet(`<h3>添加成员到「${esc(conv.name)}」</h3>
      <p class="sheet-sub">可多选，添加后会在群里留一条系统消息。</p>
      <div class="pick-list">
        ${candidates.map((target) => pickRowHTML(target, false).replace('data-pick="', 'data-member-pick="')).join("")}
      </div>
      <div class="sheet-footer">
        <button class="btn primary" data-add-members="${conv.id}">添加（已选 0）</button>
      </div>`);
  }

  /* ---------------------------- 顶部快捷发消息 ---------------------------- */

  function quickTargetConv() {
    return state.quickTarget ? convById(state.quickTarget) : null;
  }

  function renderQuickCompose() {
    const chip = $("#composeTarget");
    if (!chip) return;
    const conv = quickTargetConv();
    const nameEl = chip.querySelector(".compose-target-name");
    if (nameEl) nameEl.textContent = conv ? convName(conv) : state.live ? "选择" : "演示";
  }

  function updateQuickSend() {
    const input = $("#quickInput");
    const send = $("#quickSend");
    if (input && send) send.disabled = input.value.trim().length === 0;
  }

  function openComposeTargets() {
    const rows = state.convs
      .map((conv) => {
        const isGroup = conv.kind === "group";
        const target = isGroup ? null : state.botMap[conv.id] || null;
        const avatar = isGroup
          ? groupAvatar(conv, "avatar-sm")
          : target
            ? botAvatar(target, "avatar-sm")
            : `<div class="avatar avatar-sm"><span>会</span></div>`;
        const sub = isGroup ? `${(conv.memberIds?.length ?? 0) + 1} 位成员` : target?.short || "会话";
        return `<button class="pick-row" data-compose-target="${conv.id}">
          ${avatar}
          <span class="pick-main">
            <span class="pick-name">${esc(convName(conv))}</span>
            <span class="pick-role">${esc(sub)}</span>
          </span>
        </button>`;
      })
      .join("");
    openSheet(`<h3>发给谁</h3>
      <p class="sheet-sub">选好之后，顶部输入框会一直发给它。</p>
      <div class="pick-list">${rows}</div>
      <div class="sheet-footer"><button class="btn" data-act="sheet-close">关闭</button></div>`);
  }

  async function sendQuick() {
    const input = $("#quickInput");
    const text = (input?.value ?? "").trim();
    if (text === "") return;
    const target = quickTargetConv();
    if (!target) {
      showToast("先选择发给谁");
      return;
    }
    if (!state.live) {
      showToast("本地演示模式，未发送");
      input.value = "";
      updateQuickSend();
      return;
    }
    input.value = "";
    updateQuickSend();
    try {
      await liveFetch("/__im/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: target.id, text })
      });
      showToast(`已发给 ${convName(target)}`);
      touchConv(target.id);
      if (location.hash === "#/chat/" + encodeURIComponent(target.id)) {
        await liveLoadChat(target.id, true);
      } else {
        location.hash = "#/chat/" + encodeURIComponent(target.id);
      }
      setTimeout(() => updateLiveStatus(), 400);
    } catch (error) {
      showToast("发送失败：" + error.message);
      if (input) {
        input.value = text;
        updateQuickSend();
      }
    }
  }

  /* ---------------------------- 导航 / 路由 ---------------------------- */

  function setTab(tab) {
    state.tab = tab;
    el.pages.forEach((page) => page.classList.toggle("is-active", page.dataset.page === tab));
    el.tabs.forEach((btn) => btn.classList.toggle("is-active", btn.dataset.tab === tab));
  }

  function route() {
    const hash = location.hash || "#/chats";
    if (hash.startsWith("#/chat/")) {
      const id = decodeURIComponent(hash.slice("#/chat/".length));
      openChat(id);
      return;
    }
    closeChat();
    const tab = hash.replace(/^#\//, "");
    setTab(tab === "contacts" || tab === "me" ? tab : "chats");
  }

  /* ---------------------------- 弹层 / Toast ---------------------------- */

  function showToast(text) {
    el.toast.textContent = text;
    el.toast.classList.add("show");
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => el.toast.classList.remove("show"), 1900);
  }

  function openSheet(html) {
    el.sheet.innerHTML = `<div class="sheet-grip"></div>` + html;
    el.sheetLayer.hidden = false;
    requestAnimationFrame(() => el.sheetLayer.classList.add("is-open"));
  }

  function closeSheet() {
    el.sheetLayer.classList.remove("is-open");
    setTimeout(() => {
      el.sheetLayer.hidden = true;
    }, 280);
  }

  function designNoteHTML() {
    return `<h3>设计说明 · 手机端 v0.3</h3>
    <p class="sheet-sub">两个问题：<b>页面被自由缩放</b>、<b>桌面布局塞进手机后挤在一起</b>。原则是<b>只重做界面，桌面端功能全保留</b>。</p>

    <div class="note">
      <h4><span class="n">1</span>锁定比例（不再自由缩放）</h4>
      <ul>
        <li><code>viewport</code> 设 <code>maximum-scale=1, user-scalable=no, viewport-fit=cover</code></li>
        <li>iOS Safari 会忽略上面这行，所以 JS 再拦：<code>gesturestart</code>、双指 <code>touchmove</code>、双击</li>
        <li><code>touch-action: manipulation</code> + 输入框字号 ≥16px，避免聚焦自动放大</li>
        <li>整页做成固定壳（<code>100dvh</code>），只有列表内部滚动；键盘用 <code>visualViewport</code> 顶起输入栏</li>
      </ul>
    </div>

    <div class="note">
      <h4><span class="n">2</span>三页 IM 结构</h4>
      <ul>
        <li><b>消息</b>：会话列表（置顶群 + Bot 会话），未读、输入中、运行中都用一眼能看懂的状态</li>
        <li><b>通讯录</b>：按部门分组，可搜索岗位与部门</li>
        <li><b>聊天框</b>：从右侧覆盖进入，返回按钮 + 系统返回键都能退出，不影响列表滚动位置</li>
        <li>底部 Tab 只留三个入口；设置、组织资料收进「我的」，不在主界面抢空间</li>
      </ul>
    </div>

    <div class="note">
      <h4><span class="n">3</span>发起群聊 / 添加 agent</h4>
      <ul>
        <li><b>发起群聊</b>：消息页「+」→ 多选 Bot → 起名 → 创建并进入；群聊里可继续「添加成员」</li>
        <li><b>添加 agent</b>：通讯录页「+」→ 填名称/岗位/部门 → 加到组织；之后可直接开聊</li>
        <li>群头像自动由前 3 位成员的部门色拼成；群标题栏可查看成员列表</li>
        <li>对应真实能力：ds-bot 的建群 / 建 Bot 接口，落地时走网关适配层</li>
      </ul>
    </div>

    <div class="note">
      <h4><span class="n">4</span>聊天里放结构化卡片</h4>
      <p>Bot 的产出不是普通聊天记录。所以把三类高频内容做成卡片，而不是把文件路径塞进气泡：</p>
      <ul>
        <li>任务卡：编号、负责、优先级、进度，可直接跳到任务板</li>
        <li>文件卡：交付物名称 + 目录 + 预览</li>
        <li>审批卡：L3 动作就地「批准 / 驳回」</li>
      </ul>
    </div>

    <div class="note">
      <h4><span class="n">5</span>和现有 DSH 的对应关系</h4>
      <ul>
        <li>Bot ↔ ds-bot 的 Bot（独立 session）</li>
        <li>群聊 ↔ ds-bot 的 room（部门群）</li>
        <li>聊天记录 ↔ session 消息；卡片数据来自任务板 / 交付物 / L3 审批</li>
        <li>下一步：网关适配层接 session 列表 / 消息 / 发送，不改 DSH 本体</li>
      </ul>
    </div>

    <div class="note">
      <h4><span class="n">6</span>功能全保留（只换界面）</h4>
      <p>桌面端现有的会话、消息、模型/权限、工作区四件套（文件 / 文档 / 终端 / 浏览器）、Jobs / 定时 / 目标 / 工作流 / 计划 / 轨迹 / 子代理、审批、设置与插件，全部有落点：</p>
      <ul>
        <li>会话工具：「…」→ 16 个入口</li>
        <li>全部设置：我的 → 账号 / 界面 / 能力 / 会话 / 关于</li>
        <li>功能清单：我的 → 功能清单（逐项对照）</li>
      </ul>
    </div>

    <div class="note">
      <h4><span class="n">7</span>待你确认</h4>
      <div class="open-q">
        <p>① 底部第三个 Tab 用「我的」还是「任务」？</p>
        <p>② 视觉走现在这套（浅色 + 蓝色强调 + 部门色头像）还是更深色 / 更极简？</p>
        <p>③ 群聊里 Bot 的回复要不要合并显示，避免刷屏？</p>
        <p>④ 要不要做「添加到主屏幕」的 PWA（可进一步去掉地址栏）？</p>
      </div>
    </div>`;
  }

  /* ---------------------------- 事件 ---------------------------- */

  function wire() {
    let pressTimer = null;
    let pressStart = null;
    let suppressClick = false;

    document.addEventListener("click", (event) => {
      if (suppressClick) {
        suppressClick = false;
        if (event.target.closest(".chat-row")) return;
      }

      const fileHit = event.target.closest("[data-file]");
      if (fileHit) {
        event.preventDefault();
        void openFileViewer(fileHit.dataset.file, fileHit.dataset.fileTitle || "");
        return;
      }

      const imageHit = event.target.closest("[data-image]");
      if (imageHit) {
        event.preventDefault();
        openImageViewer(imageHit.dataset.image);
        return;
      }

      const tabBtn = event.target.closest("[data-tab]");
      if (tabBtn) {
        location.hash = "#/" + tabBtn.dataset.tab;
        return;
      }

      const sessionOpen = event.target.closest("[data-session-open]");
      if (sessionOpen) {
        void switchAgentSession(
          sessionOpen.dataset.sessionOpen,
          sessionOpen.dataset.title || ""
        );
        return;
      }

      const hideSession = event.target.closest("[data-hide-session]");
      if (hideSession) {
        hideConversation(hideSession.dataset.hideSession);
        return;
      }

      const renameHit = event.target.closest("[data-rename-session]");
      if (renameHit) {
        openRenameSessionSheet(renameHit.dataset.renameSession, renameHit.dataset.title || "");
        return;
      }

      const clearHit = event.target.closest("[data-clear-conv]");
      if (clearHit) {
        const targetConv = convById(clearHit.dataset.clearConv);
        openClearConvSheet(clearHit.dataset.clearConv, targetConv ? convName(targetConv) : "");
        return;
      }

      const clearConfirm = event.target.closest("[data-clear-confirm]");
      if (clearConfirm) {
        hideConversation(clearConfirm.dataset.clearConfirm);
        return;
      }

      const approveAnswer = event.target.closest("[data-approve-answer]");
      if (approveAnswer) {
        void answerApprovalDock(approveAnswer.dataset.event, approveAnswer.dataset.approveAnswer);
        return;
      }

      const questionOption = event.target.closest("[data-question-opt]");
      if (questionOption) {
        handleQuestionOption(questionOption);
        return;
      }

      const questionSubmit = event.target.closest("[data-question-submit]");
      if (questionSubmit) {
        submitQuestionFromButton(questionSubmit);
        return;
      }

      const copyMsg = event.target.closest("[data-copy-msg]");
      if (copyMsg) {
        const msg = (state.messages[state.chatId] || []).find(
          (item) => item.id === copyMsg.dataset.copyMsg
        );
        void copyText(msg?.text ?? "");
        closeSheet();
        return;
      }

      const copyImage = event.target.closest("[data-copy-image]");
      if (copyImage) {
        void copyText(copyImage.dataset.copyImage);
        closeSheet();
        return;
      }

      const openBtn = event.target.closest("[data-open]");
      if (openBtn) {
        if (!el.sheetLayer.hidden) closeSheet();
        location.hash = "#/chat/" + encodeURIComponent(openBtn.dataset.open);
        return;
      }

      const quick = event.target.closest("[data-quick]");
      if (quick) {
        sendText(quick.dataset.quick);
        return;
      }

      const pick = event.target.closest("[data-pick]");
      if (pick) {
        togglePick(pick.dataset.pick, pick);
        return;
      }

      const memberPick = event.target.closest("[data-member-pick]");
      if (memberPick) {
        toggleMemberPick(memberPick.dataset.memberPick, memberPick);
        return;
      }

      const composePick = event.target.closest("[data-compose-target]");
      if (composePick) {
        state.quickTarget = composePick.dataset.composeTarget;
        try {
          localStorage.setItem("kpao-quick-target", state.quickTarget);
        } catch {}
        closeSheet();
        renderQuickCompose();
        const picked = convById(state.quickTarget);
        showToast("发送对象：" + (picked ? convName(picked) : "已选择"));
        const quick = $("#quickInput");
        if (quick) quick.focus();
        return;
      }

      const pinBtn = event.target.closest("[data-pin-conv]");
      if (pinBtn) {
        togglePin(pinBtn.dataset.pinConv);
        return;
      }

      const groupNext = event.target.closest("[data-group-next]");
      if (groupNext) {
        if (state.groupSelection.size === 0) {
          showToast("先选至少一个 Bot");
          return;
        }
        openGroupName();
        return;
      }

      const createGroupBtn = event.target.closest("[data-create-group]");
      if (createGroupBtn) {
        const input = $("#groupNameInput");
        createGroup(input ? input.value.trim() : "");
        return;
      }

      const createBotBtn = event.target.closest("[data-create-bot]");
      if (createBotBtn) {
        const nameInput = $("#newBotName");
        const roleInput = $("#newBotRole");
        const name = nameInput ? nameInput.value.trim() : "";
        if (!name) {
          showToast("先给 agent 起个名字");
          nameInput && nameInput.focus();
          return;
        }
        addBot(name, roleInput ? roleInput.value.trim() : "", state.addBotDept);
        return;
      }

      const deptBtn = event.target.closest("[data-dept]");
      if (deptBtn) {
        state.addBotDept = deptBtn.dataset.dept;
        $$("[data-dept]", el.sheet).forEach((item) =>
          item.classList.toggle("is-on", item === deptBtn)
        );
        return;
      }

      const nameTag = event.target.closest("[data-group-name]");
      if (nameTag) {
        const input = $("#groupNameInput");
        if (input) input.value = nameTag.dataset.groupName;
        return;
      }

      const openMembersBtn = event.target.closest("[data-open-add-members]");
      if (openMembersBtn) {
        openAddMembers(convById(openMembersBtn.dataset.openAddMembers));
        return;
      }

      const addMembersBtn = event.target.closest("[data-add-members]");
      if (addMembersBtn) {
        if (state.memberSelection.size === 0) {
          showToast("先选至少一个 Bot");
          return;
        }
        addMembers(convById(addMembersBtn.dataset.addMembers), [...state.memberSelection]);
        return;
      }

      const approveBtn = event.target.closest("[data-approve-tool]");
      if (approveBtn) {
        answerApproval(approveBtn.dataset.approveTool, approveBtn.dataset.choice);
        return;
      }

      const act = event.target.closest("[data-act]");
      if (act) {
        handleAction(act);
      }
    });

    const approvalBar = $("#approvalBar");
    if (approvalBar) approvalBar.addEventListener("click", openApprovalsSheet);

    const viewer = $("#imageViewer");
    if (viewer) viewer.addEventListener("click", closeImageViewer);

    const cardDock = $("#cardDock");
    if (cardDock) {
      // 手指按住/点击卡片期间不要重绘，否则 iOS 上的 click 会被吞掉
      cardDock.addEventListener("pointerdown", (event) => {
        cardTouchUntil = Date.now() + 1200;
        // iOS 上连续点击时第二个 click 容易被吞，选项直接在 pointerdown 里选中
        const option = event.target.closest("[data-question-opt]");
        if (option) {
          event.preventDefault();
          handleQuestionOption(option);
        }
      });
      const releaseCard = () => {
        setTimeout(() => {
          cardTouchUntil = 0;
          if (state.cardDirty) {
            state.cardDirty = false;
            renderCardDock();
          }
        }, 120);
      };
      cardDock.addEventListener("pointerup", releaseCard);
      cardDock.addEventListener("pointercancel", releaseCard);
      cardDock.addEventListener("click", () => {
        setTimeout(() => {
          cardTouchUntil = 0;
          if (state.cardDirty) {
            state.cardDirty = false;
            renderCardDock();
          }
        }, 160);
      });
    }

    function handleAction(node) {
      const act = node.dataset.act;
      if (act === "focus-chat-search") {
        el.chatSearch.focus();
      } else if (act === "new-chat") {
        openNewChatMenu();
      } else if (act === "new-session") {
        void createSession();
      } else if (act === "sessions") {
        void openSessionsSheet();
      } else if (act === "deliverables") {
        openDeliverablesSheet();
      } else if (act === "reload") {
        const params = new URLSearchParams(location.search);
        location.replace(
          location.pathname +
            "?v=" +
            encodeURIComponent(params.get("v") || "") +
            "&r=" +
            Date.now() +
            location.hash
        );
      } else if (act === "save-rename") {
        void saveSessionRename(node.dataset.saveRename);
      } else if (act === "new-agent") {
        openAddBot();
      } else if (act === "open-create-group") {
        openCreateGroup();
      } else if (act === "go-contacts") {
        closeSheet();
        location.hash = "#/contacts";
      } else if (act === "chat-back") {
        location.hash = "#/" + (state.tab || "chats");
      } else if (act === "chat-more") {
        openChatTools();
      } else if (act === "settings") {
        openSettings();
      } else if (act === "features") {
        openFeatures();
      } else if (act === "billing") {
        openBilling();
      } else if (act === "chat-members") {
        openMembers(currentConv());
      } else if (act === "load-more") {
        if (state.chatId) liveLoadEarlier(state.chatId);
      } else if (act === "composer-plus") {
        openComposerMenu();
      } else if (act === "pick-image") {
        if (el.imageInput) el.imageInput.click();
      } else if (act === "clear-image") {
        clearPendingImage();
      } else if (act === "close-image") {
        closeImageViewer();
      } else if (act === "close-file") {
        closeFileViewer();
      } else if (act === "sheet-close") {
        closeSheet();
      } else if (act === "design-note") {
        openSheet(designNoteHTML());
      } else if (act === "theme") {
        cycleTheme();
      } else if (act === "toast") {
        showToast(node.dataset.toast || "原型占位");
      }
    }

    el.chatSearch.addEventListener("input", () => {
      state.searchChat = el.chatSearch.value;
      el.chatSearchClear.hidden = el.chatSearch.value.length === 0;
      renderChats();
    });
    el.contactSearch.addEventListener("input", () => {
      state.searchContact = el.contactSearch.value;
      el.contactSearchClear.hidden = el.contactSearch.value.length === 0;
      renderContacts();
    });
    el.chatSearchClear.addEventListener("click", () => {
      el.chatSearch.value = "";
      state.searchChat = "";
      el.chatSearchClear.hidden = true;
      renderChats();
      el.chatSearch.focus();
    });
    el.contactSearchClear.addEventListener("click", () => {
      el.contactSearch.value = "";
      state.searchContact = "";
      el.contactSearchClear.hidden = true;
      renderContacts();
      el.contactSearch.focus();
    });

    el.composerInput.addEventListener("input", () => {
      updateComposerSend();
      el.composerInput.style.height = "auto";
      el.composerInput.style.height = Math.min(el.composerInput.scrollHeight, 104) + "px";
    });
    el.composerInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendText(el.composerInput.value);
      }
    });
    el.composerInput.addEventListener("focus", () => {
      setTimeout(() => scrollChatToBottom("smooth"), 350);
    });
    el.sendBtn.addEventListener("click", () => {
      sendText(el.composerInput.value);
    });
    if (el.stopBtn) {
      el.stopBtn.addEventListener("click", () => {
        void stopCurrentTask();
      });
    }

    const quickInput = $("#quickInput");
    const quickSend = $("#quickSend");
    const composeTarget = $("#composeTarget");
    if (quickInput) {
      quickInput.addEventListener("input", updateQuickSend);
      quickInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          sendQuick();
        }
      });
    }
    if (quickSend) quickSend.addEventListener("click", sendQuick);
    if (composeTarget) composeTarget.addEventListener("click", openComposeTargets);

    // 长按会话置顶（鼠标右键也可以）
    document.addEventListener("pointerdown", (event) => {
      const row = event.target.closest(".chat-row");
      if (!row) return;
      pressStart = { x: event.clientX, y: event.clientY };
      pressTimer = setTimeout(() => {
        pressTimer = null;
        suppressClick = true;
        openPinSheet(row.dataset.open);
      }, 520);
    });
    const cancelPress = () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    };
    document.addEventListener("pointerup", cancelPress);
    document.addEventListener("pointercancel", cancelPress);
    document.addEventListener("pointermove", (event) => {
      if (!pressTimer || !pressStart) return;
      if (
        Math.abs(event.clientX - pressStart.x) > 10 ||
        Math.abs(event.clientY - pressStart.y) > 10
      ) {
        cancelPress();
      }
    });
    document.addEventListener("contextmenu", (event) => {
      const row = event.target.closest(".chat-row");
      if (!row) return;
      event.preventDefault();
      openPinSheet(row.dataset.open);
    });

    // 长按消息：复制文字 / 图片路径
    let messagePressTimer = null;
    let messagePressStart = null;
    const clearMessagePress = () => {
      if (messagePressTimer !== null) {
        clearTimeout(messagePressTimer);
        messagePressTimer = null;
      }
      messagePressStart = null;
    };
    if (el.chatScroll) {
      el.chatScroll.addEventListener("pointerdown", (event) => {
        const messageEl = event.target.closest(".msg");
        if (!messageEl) return;
        if (event.target.closest("button, a, input, textarea, [data-image]")) return;
        messagePressStart = { x: event.clientX, y: event.clientY };
        messagePressTimer = setTimeout(() => {
          messagePressTimer = null;
          openMessageActions(messageEl);
        }, 520);
      });
      el.chatScroll.addEventListener("pointermove", (event) => {
        if (messagePressStart === null) return;
        if (
          Math.abs(event.clientX - messagePressStart.x) > 10 ||
          Math.abs(event.clientY - messagePressStart.y) > 10
        ) {
          clearMessagePress();
        }
      });
      el.chatScroll.addEventListener("pointerup", clearMessagePress);
      el.chatScroll.addEventListener("pointercancel", clearMessagePress);
    }

    if (el.imageInput) {
      el.imageInput.addEventListener("change", async () => {
        const file = el.imageInput.files?.[0];
        el.imageInput.value = "";
        if (file) await sendImage(file);
      });
    }

    // 图片加载失败时退化成可点开的链接，而不是一个破图
    if (el.chatScroll) {
      el.chatScroll.addEventListener(
        "error",
        (event) => {
          const image = event.target;
          if (!image || image.tagName !== "IMG" || !image.classList.contains("msg-img")) return;
          const link = document.createElement("a");
          link.href = image.src;
          link.target = "_blank";
          link.rel = "noreferrer";
          link.className = "msg-img-fallback";
          link.textContent = "图片加载失败，点此打开";
          image.replaceWith(link);
        },
        true
      );
    }

    el.zoomSwitch.addEventListener("click", () => {
      el.zoomSwitch.classList.add("is-on");
      el.zoomSwitch.setAttribute("aria-checked", "true");
      showToast("比例锁定已开启：双指缩放与双击放大都会被拦截");
    });

    window.addEventListener("hashchange", route);

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        const fileViewer = $("#fileViewer");
        if (fileViewer && !fileViewer.hidden) {
          closeFileViewer();
          return;
        }
        const viewer = $("#imageViewer");
        if (viewer && !viewer.hidden) {
          closeImageViewer();
          return;
        }
        if (!el.sheetLayer.hidden) closeSheet();
        else if (state.chatId) location.hash = "#/" + (state.tab || "chats");
      }
    });
  }

  function togglePick(id, node) {
    if (state.groupSelection.has(id)) state.groupSelection.delete(id);
    else state.groupSelection.add(id);
    node.classList.toggle("is-picked", state.groupSelection.has(id));
    const next = $("[data-group-next]");
    if (next) next.textContent = `下一步（已选 ${state.groupSelection.size}）`;
  }

  function toggleMemberPick(id, node) {
    if (state.memberSelection.has(id)) state.memberSelection.delete(id);
    else state.memberSelection.add(id);
    node.classList.toggle("is-picked", state.memberSelection.has(id));
    const btn = $("[data-add-members]");
    if (btn) btn.textContent = `添加（已选 ${state.memberSelection.size}）`;
  }

  function addMembers(conv, ids) {
    if (!conv) return;
    if (state.live) {
      closeSheet();
      liveAddMembers(conv.id, ids).catch((error) => showToast("添加失败：" + error.message));
      return;
    }
    const names = ids.map((id) => state.botMap[id]?.name).filter(Boolean);
    ids.forEach((id) => {
      if (!conv.memberIds.includes(id)) conv.memberIds.push(id);
    });
    conv.members = conv.memberIds.length + 1;
    if (!state.messages[conv.id]) state.messages[conv.id] = [];
    state.messages[conv.id].push({
      id: "sys" + Date.now(), from: "system", time: nowHM(), type: "system",
      text: `用户 邀请 ${names.join("、")} 加入了群聊`
    });
    closeSheet();
    renderChats();
    if (state.chatId === conv.id) {
      openChat(conv.id);
      setTimeout(() => scrollChatToBottom("smooth"), 60);
    }
    showToast(`已添加 ${names.join("、")}`);
  }

  function openNewChatMenu() {
    openSheet(`<h3>新建</h3>
      <p class="sheet-sub">发起群聊或把新的 agent 拉进组织。</p>
      <div class="group-card">
        <button class="menu-row" data-act="open-create-group">
          <span class="menu-ic ic-content"><svg class="ic"><use href="#i-contacts"/></svg></span>
          <span class="menu-label">发起群聊<span class="menu-sub">多选 Bot，起个名字就能开始</span></span>
          <svg class="ic chev"><use href="#i-chev"/></svg>
        </button>
        <button class="menu-row" data-act="new-agent">
          <span class="menu-ic ic-project"><svg class="ic"><use href="#i-plus"/></svg></span>
          <span class="menu-label">添加 agent<span class="menu-sub">新 Bot 加到组织与通讯录</span></span>
          <svg class="ic chev"><use href="#i-chev"/></svg>
        </button>
        <button class="menu-row" data-act="new-session">
          <span class="menu-ic ic-project"><svg class="ic"><use href="#i-chat"/></svg></span>
          <span class="menu-label">新建会话<span class="menu-sub">开一个不带旧上下文的新对话</span></span>
          <svg class="ic chev"><use href="#i-chev"/></svg>
        </button>
        <button class="menu-row" data-act="sessions">
          <span class="menu-ic ic-research"><svg class="ic"><use href="#i-clock"/></svg></span>
          <span class="menu-label">历史会话<span class="menu-sub">打开旧会话或改名</span></span>
          <svg class="ic chev"><use href="#i-chev"/></svg>
        </button>
        <button class="menu-row" data-act="go-contacts">
          <span class="menu-ic ic-research"><svg class="ic"><use href="#i-contacts"/></svg></span>
          <span class="menu-label">从通讯录选一个 Bot<span class="menu-sub">单聊</span></span>
          <svg class="ic chev"><use href="#i-chev"/></svg>
        </button>
      </div>
      <div style="height:10px"></div>
      <button class="btn" data-act="sheet-close" style="width:100%;padding:12px">取消</button>`);
  }

  function saveMySessions() {
    try {
      localStorage.setItem("kpao-sessions", JSON.stringify(state.mySessions));
    } catch {}
  }

  function ensureSessionConv(id, title) {
    if (!state.mySessions.includes(id)) {
      state.mySessions.push(id);
      saveMySessions();
    }
    let conv = convById(id);
    if (conv) {
      if (title) {
        conv.name = title;
        renderChats();
      }
      return conv;
    }
    conv = {
      id,
      kind: "bot",
      name: title || "会话",
      last: "历史会话",
      time: "",
      unread: 0,
      lastAt: Date.now(),
      plainSession: true
    };
    state.convs.unshift(conv);
    renderChats();
    return conv;
  }

  async function createSession() {
    closeSheet();
    showToast("正在新建会话…");
    try {
      const created = await liveFetch("/__im/sessions/new", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      state.agentSessionId = created.id;
      try {
        localStorage.setItem("kpao-agent-session", created.id);
      } catch {}
      await liveLoadState();
      location.hash = "#/chat/" + encodeURIComponent(created.id);
      showToast("已新建会话");
    } catch (error) {
      showToast("新建失败：" + error.message);
    }
  }

  async function switchAgentSession(id, title) {
    state.agentSessionId = id;
    try {
      localStorage.setItem("kpao-agent-session", id);
    } catch {}
    showToast("正在切换会话…");
    await liveLoadState();
    location.hash = "#/chat/" + encodeURIComponent(id);
    showToast(title || "已切换会话");
  }

  function saveHidden() {
    try {
      localStorage.setItem("kpao-hidden", JSON.stringify(state.hidden));
    } catch {}
  }

  function hideConversation(id) {
    if (!state.hidden.includes(id)) state.hidden.push(id);
    saveHidden();
    if (state.agentSessionId === id) {
      state.agentSessionId = null;
      try {
        localStorage.removeItem("kpao-agent-session");
      } catch {}
    }
    state.convs = state.convs.filter((conv) => conv.id !== id);
    if (state.chatId === id) location.hash = "#/chats";
    renderChats();
    closeSheet();
    showToast("已清除对话");
  }

  function openClearConvSheet(id, name) {
    openSheet(`<h3>清除对话</h3>
      <p class="sheet-sub">「${esc(name || "这个会话")}」会从手机列表移除，旧消息记录仍保留在电脑端，随时可从历史会话找回。</p>
      <div class="sheet-footer">
        <button class="btn" data-act="sheet-close">取消</button>
        <button class="btn danger" data-clear-confirm="${esc(id)}">清除</button>
      </div>`);
  }

  async function openSessionsSheet() {
    openSheet(`<h3>历史会话</h3><p class="sheet-sub">正在读取…</p>`);
    try {
      const listed = await liveFetch("/__im/sessions");
      const items = (listed.items ?? []).filter(
        (item) => !state.hidden.includes(item.id)
      );
      if (items.length === 0) {
        openSheet(`<h3>历史会话</h3><p class="sheet-sub">还没有会话，先新建一个。</p>
          <div class="group-card"><button class="menu-row" data-act="new-session">
            <span class="menu-ic ic-project"><svg class="ic"><use href="#i-plus"/></svg></span>
            <span class="menu-label">新建会话<span class="menu-sub">不带旧上下文的新对话</span></span>
          </button></div>`);
        return;
      }
      const rows = items
        .map((item) => {
          const meta = [
            item.updatedAt ? hm(item.updatedAt) : "",
            item.running ? "运行中" : "",
            item.blank ? "空白" : ""
          ]
            .filter(Boolean)
            .join(" · ");
          return `<div class="session-row">
            <button class="menu-row" data-session-open="${esc(item.id)}" data-title="${esc(item.title || "")}">
              <span class="menu-ic ic-muted"><svg class="ic"><use href="#i-chat"/></svg></span>
              <span class="menu-label">${esc(item.title || "未命名会话")}<span class="menu-sub">${esc(meta)}</span></span>
              <svg class="ic chev"><use href="#i-chev"/></svg>
            </button>
            <button class="session-rename-btn" data-rename-session="${esc(item.id)}" data-title="${esc(item.title || "")}">改名</button>
            <button class="session-rename-btn" data-hide-session="${esc(item.id)}">清除</button>
          </div>`;
        })
        .join("");
      openSheet(`<h3>历史会话</h3><p class="sheet-sub">点击打开；改名不会丢消息。</p>
        <div class="group-card">
          <button class="menu-row" data-act="new-session">
            <span class="menu-ic ic-project"><svg class="ic"><use href="#i-plus"/></svg></span>
            <span class="menu-label">新建会话<span class="menu-sub">不带旧上下文的新对话</span></span>
          </button>
          ${rows}
        </div>`);
    } catch (error) {
      openSheet(`<h3>历史会话</h3><p class="sheet-sub">读取失败：${esc(error.message)}</p>
        <div class="sheet-footer"><button class="btn" data-act="sheet-close">关闭</button></div>`);
    }
  }

  function openRenameSessionSheet(id, title) {
    openSheet(`<h3>重命名会话</h3>
      <p class="sheet-sub">起一个以后找得到的名字。</p>
      <div class="input-wrap"><textarea id="renameSessionInput" rows="2">${esc(title || "")}</textarea></div>
      <div class="sheet-footer">
        <button class="btn" data-act="sheet-close">取消</button>
        <button class="btn primary" data-act="save-rename" data-save-rename="${esc(id)}">保存</button>
      </div>`);
  }

  async function saveSessionRename(id) {
    const input = $("#renameSessionInput");
    const title = String(input?.value ?? "").trim();
    if (!id || title === "") {
      showToast("标题不能为空");
      return;
    }
    try {
      await liveFetch("/__im/sessions/rename", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, title })
      });
      const conv = convById(id);
      if (conv) {
        conv.name = title;
        renderChats();
      }
      closeSheet();
      showToast("已改名");
    } catch (error) {
      showToast("改名失败：" + error.message);
    }
  }

  function toolTile(icon, label, toastText) {
    return `<button class="tool-tile" data-act="toast" data-toast="${esc(toastText)}">
      <span class="tool-ic"><svg class="ic"><use href="#${icon}"/></svg></span>
      <span class="tool-label">${esc(label)}</span>
    </button>`;
  }

  function openChatTools() {
    const conv = currentConv();
    if (!conv) return;
    const isGroup = conv.kind === "group";
    const tools = [
      ["i-spark", "模型", "模型选择（原型占位）"],
      ["i-shield", "权限", "权限预设与审批（原型占位）"],
      ["i-usage", "用量", "上下文与 token 用量（原型占位）"],
      ["i-plus", "附件", "附件 / 文件上传（原型占位）"],
      ["i-folder", "文件", "工作区文件（原型占位）"],
      ["i-browser", "浏览器", "浏览器（原型占位）"],
      ["i-task", "Jobs", "后台任务（原型占位）"],
      ["i-clock", "定时", "定时任务（原型占位）"]
    ];
    const title = isGroup ? conv.name : state.botMap[conv.id]?.name || conv.name || "会话";
    openSheet(`<h3>会话工具</h3>
      <p class="sheet-sub">${esc(title)} · 常用能力收在这里。</p>
      <div class="tool-grid">${tools.map(([icon, label, toastText]) => toolTile(icon, label, toastText)).join("")}</div>
      <div class="group-card" style="margin-top:14px">
        <button class="menu-row" data-act="chat-members">
          <span class="menu-ic"><svg class="ic"><use href="#i-contacts"/></svg></span>
          <span class="menu-label">${isGroup ? "成员列表" : state.botMap[conv.id] ? "Bot 资料" : "会话信息"}<span class="menu-sub">${
            isGroup ? conv.memberIds.length + " 个 Bot + 你" : esc(state.botMap[conv.id]?.role || "普通会话")
          }</span></span>
          <svg class="ic chev"><use href="#i-chev"/></svg>
        </button>
        ${
          isGroup
            ? `<button class="menu-row" data-open-add-members="${conv.id}">
          <span class="menu-ic"><svg class="ic"><use href="#i-plus"/></svg></span>
          <span class="menu-label">添加成员</span>
          <svg class="ic chev"><use href="#i-chev"/></svg>
        </button>`
            : ""
        }
        ${
          conv.agentSession
            ? `<button class="menu-row" data-act="new-session">
          <span class="menu-ic"><svg class="ic"><use href="#i-plus"/></svg></span>
          <span class="menu-label">新建会话<span class="menu-sub">在当前聊天里开新会话</span></span>
          <svg class="ic chev"><use href="#i-chev"/></svg>
        </button>`
            : ""
        }
        <button class="menu-row" data-act="sessions">
          <span class="menu-ic"><svg class="ic"><use href="#i-clock"/></svg></span>
          <span class="menu-label">历史会话</span>
          <svg class="ic chev"><use href="#i-chev"/></svg>
        </button>
        <button class="menu-row" data-clear-conv="${conv.id}">
          <span class="menu-ic"><svg class="ic"><use href="#i-close"/></svg></span>
          <span class="menu-label" style="color:var(--danger)">清除对话</span>
        </button>
      </div>
      <div style="height:6px"></div>
      <button class="btn" data-act="sheet-close" style="width:100%;padding:12px">关闭</button>`);
  }

  function openSettings() {
    const groups = [
      {
        title: "账号与模型",
        rows: [
          ["i-me", "账号资料", "账号资料（原型占位）"],
          ["i-spark", "模型选择", "模型选择（原型占位）"],
          ["i-usage", "用量与余额", "用量与余额（原型占位）"]
        ]
      },
      {
        title: "界面",
        rows: [
          ["i-moon", "外观", "外观（在「我的」里可直接切换）"],
          ["i-globe", "语言", "语言（原型占位）"],
          ["i-key", "快捷键", "快捷键（原型占位）"],
          ["i-spark", "入口定制", "入口定制（原型占位）"]
        ]
      },
      {
        title: "能力",
        rows: [
          ["i-search", "Web 搜索", "Web 搜索（原型占位）"],
          ["i-bot", "子代理", "子代理（原型占位）"],
          ["i-flow", "Agent Loop", "Agent Loop（原型占位）"],
          ["i-terminal", "Shell 权限", "Shell 权限（原型占位）"],
          ["i-shield", "技能", "技能（原型占位）"],
          ["i-folder", "插件市场", "插件市场（原型占位）"]
        ]
      },
      {
        title: "会话与数据",
        rows: [
          ["i-doc", "会话日志", "会话日志（原型占位）"],
          ["i-export", "导出会话", "导出会话（原型占位）"],
          ["i-globe", "远程访问", "远程访问（原型占位）"],
          ["i-check", "审批记录", "审批记录（原型占位）"]
        ]
      },
      {
        title: "关于",
        rows: [["i-info", "版本与更新", "版本与更新（原型占位）"]]
      }
    ];
    const html = groups
      .map(
        (group) => `<div class="group"><div class="group-title">${esc(group.title)}</div>
          <div class="group-card">${group.rows
            .map(
              ([icon, label, toastText]) => `<button class="menu-row" data-act="toast" data-toast="${esc(
                toastText
              )}">
              <span class="menu-ic"><svg class="ic"><use href="#${icon}"/></svg></span>
              <span class="menu-label">${esc(label)}</span>
              <svg class="ic chev"><use href="#i-chev"/></svg>
            </button>`
            )
            .join("")}</div></div>`
      )
      .join("");
    openSheet(`<h3>全部设置</h3>
      <p class="sheet-sub">桌面端能设置的项，手机端都保留入口；这里只演示位置。</p>
      ${html}
      <p class="hint">正式版接 DSH 设置接口，不改变桌面端任何行为。</p>`);
  }

  function updateBalanceShort(account) {
    const node = $("#balanceShort");
    if (!node) return;
    const balance =
      (account?.balance ?? []).find((item) => item.currency === "CNY") ?? (account?.balance ?? [])[0];
    if (balance) node.textContent = "¥" + Number(balance.balance).toFixed(2);
  }

  async function openBilling() {
    openSheet(`<h3>用量与充值</h3><p class="sheet-sub">正在读取账号…</p>`);
    try {
      const [account, usage] = await Promise.all([
        liveFetch("/__im/account"),
        liveFetch("/__im/usage")
      ]);
      updateBalanceShort(account);
      const balance =
        (account.balance ?? []).find((item) => item.currency === "CNY") ?? (account.balance ?? [])[0];
      const money = balance ? Number(balance.balance).toFixed(2) : "—";
      const rows = usage.usage?.rows ?? [];
      const nowHour = String(usage.usage?.now ?? "");
      const today = nowHour.slice(0, 10);
      let todayTokens = 0;
      let todayCalls = 0;
      for (const row of rows) {
        if (String(row[0]).slice(0, 10) !== today) continue;
        todayTokens += Number(row[4] ?? 0) + Number(row[7] ?? 0);
        todayCalls += Number(row[8] ?? 0);
      }
      const profile = account.profile ?? {};
      openSheet(`<h3>用量与充值</h3>
        <p class="sheet-sub">余额来自本机 DSH 账号，用量按小时账本汇总。</p>
        <div class="billing-card">
          <div class="billing-label">当前余额</div>
          <div class="billing-balance">¥${esc(money)}</div>
          ${
            profile.name
              ? `<div class="billing-sub">${esc(profile.name)}${
                  profile.contact ? " · " + esc(profile.contact) : ""
                }</div>`
              : ""
          }
        </div>
        <div class="billing-grid">
          <div class="billing-stat"><b>${todayTokens.toLocaleString("zh-CN")}</b><span>今日 tokens</span></div>
          <div class="billing-stat"><b>${todayCalls.toLocaleString("zh-CN")}</b><span>今日调用</span></div>
        </div>
        <p class="hint">统计包含全部 Bot 与 DSH Agent；充值在 DeepSeek 平台完成，回来刷新即可看到余额。</p>
        <div class="sheet-footer">
          <a class="btn primary" href="https://platform.deepseek.com/top_up" target="_blank" rel="noreferrer noopener">去 DeepSeek 平台充值</a>
        </div>`);
    } catch (error) {
      openSheet(`<h3>用量与充值</h3><p class="sheet-sub">读取失败：${esc(error.message)}</p>
        <div class="sheet-footer"><button class="btn" data-act="sheet-close">关闭</button></div>`);
    }
  }

  function openFeatures() {
    const items = [
      ["会话与导航", "会话列表 / 新建对话 / 历史会话 / 置顶 / 部门群 / 搜索", "消息页、通讯录"],
      ["消息与内容", "文本 / 附件 / 图片 / 文件 / 交付物 / 编辑差异 / 记忆更新 / 消息反馈", "聊天框"],
      ["模型与运行", "模型选择 / 权限预设 / Agent 预设 / 上下文与用量 / 中断 / 重试", "聊天框「…」→ 会话工具"],
      ["工作区", "文件浏览 / 文档预览 / 终端 / 浏览器 / 目录选择 / 上传", "聊天框「…」→ 会话工具"],
      ["自动化", "Jobs / 定时 / 目标 / 工作流 / 计划 / 轨迹 / 子代理", "聊天框「…」→ 会话工具"],
      ["审批与安全", "L3 审批 / 权限 / 密钥卡 / 远程访问", "聊天卡、我的 → 全部设置"],
      ["组织与 Bot", "12 个 Bot / 部门群 / 建群 / 添加 agent / 拉人 / 记忆与状态", "消息、通讯录"],
      [
        "设置",
        "账号 / 模型 / 插件市场 / 主题 / 语言 / 快捷键 / 入口定制 / 会话日志 / 导出 / 关于",
        "我的 → 全部设置"
      ]
    ];
    openSheet(`<h3>功能清单</h3>
      <p class="sheet-sub">这一版只重做界面：桌面端现有功能逐项找到手机端的新位置，不删功能。</p>
      <div class="feature-list">${items
        .map(
          ([title, desc, where]) => `<div class="feature-row">
            <span class="feature-check"><svg class="ic"><use href="#i-check"/></svg></span>
            <span class="feature-main">
              <span class="feature-title">${esc(title)}</span>
              <span class="feature-desc">${esc(desc)}</span>
              <span class="feature-where">${esc(where)}</span>
            </span>
          </div>`
        )
        .join("")}</div>
      <p class="hint">完整对照表见 dsh-mobile/FEATURE-MAP.md。</p>`);
  }

  function openComposerMenu() {
    openSheet(`<h3>添加内容</h3>
      <p class="sheet-sub">原型只演示入口，正式版再接文件 / 图片 / 语音。</p>
      <div class="group-card">
        <button class="menu-row" data-act="pick-image">
          <span class="menu-ic ic-content"><svg class="ic"><use href="#i-doc"/></svg></span>
          <span class="menu-label">图片 / 截图<span class="menu-sub">从相册选，上传后作为消息发出</span></span>
        </button>
        <button class="menu-row" data-act="toast" data-toast="文件（原型占位）">
          <span class="menu-ic ic-project"><svg class="ic"><use href="#i-folder"/></svg></span>
          <span class="menu-label">文件<span class="menu-sub">交付物、数据、素材</span></span>
        </button>
        <button class="menu-row" data-act="toast" data-toast="语音（原型占位）">
          <span class="menu-ic ic-research"><svg class="ic"><use href="#i-bell"/></svg></span>
          <span class="menu-label">语音输入<span class="menu-sub">口述素材会转文字</span></span>
        </button>
      </div>
      <div style="height:10px"></div>
      <button class="btn" data-act="sheet-close" style="width:100%;padding:12px">取消</button>`);
  }

  /* ---------------------------- 主题 ---------------------------- */

  function applyTheme(mode, persist) {
    state.theme = mode;
    if (mode === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", mode);
    const dark =
      mode === "dark" ||
      (mode === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (el.metaTheme) el.metaTheme.setAttribute("content", dark ? "#0c0e12" : "#f1f3f7");
    if (el.themeValue) {
      el.themeValue.textContent = mode === "auto" ? "跟随系统" : mode === "dark" ? "深色" : "浅色";
    }
    if (persist === false) return;
    try {
      localStorage.setItem("kpao-theme", mode);
    } catch {}
  }

  function cycleTheme() {
    const order = ["auto", "light", "dark"];
    const next = order[(order.indexOf(state.theme) + 1) % order.length];
    applyTheme(next, true);
    showToast("外观：" + (next === "auto" ? "跟随系统" : next === "dark" ? "深色" : "浅色"));
  }

  /* ---------------------------- 视口 / 缩放锁 ---------------------------- */

  function lockZoom() {
    ["gesturestart", "gesturechange", "gestureend"].forEach((name) => {
      document.addEventListener(name, (event) => event.preventDefault(), { passive: false });
    });

    document.addEventListener(
      "touchmove",
      (event) => {
        if (event.touches && event.touches.length > 1) event.preventDefault();
      },
      { passive: false }
    );

    let lastTouchEnd = 0;
    document.addEventListener(
      "touchend",
      (event) => {
        const now = Date.now();
        const interactive = event.target.closest("button, a, input, textarea, [contenteditable]");
        if (!interactive && now - lastTouchEnd <= 300) event.preventDefault();
        lastTouchEnd = now;
      },
      { passive: false }
    );

    document.addEventListener(
      "wheel",
      (event) => {
        if (event.ctrlKey) event.preventDefault();
      },
      { passive: false }
    );
  }

  function syncViewport() {
    const vv = window.visualViewport;
    if (!vv) return;
    const height = Math.round(vv.height);
    // 键盘弹起/地址栏伸缩的瞬间，部分浏览器会短暂报 0 或极小值，
    // 直接写进去会让整个 App 高度塌成 0（表现为「点输入框黑屏」），这里挡掉。
    if (!height || height < 240) return;
    document.documentElement.style.setProperty("--app-h", height + "px");
    document.documentElement.style.setProperty("--app-top", Math.max(0, Math.round(vv.offsetTop)) + "px");
  }

  /* ---------------------------- 启动 ---------------------------- */

  function init() {
    try {
      const saved = localStorage.getItem("kpao-theme");
      if (saved === "auto" || saved === "light" || saved === "dark") state.theme = saved;
    } catch {}
    let fromQuery = false;
    try {
      const query = new URLSearchParams(location.search).get("theme");
      if (query === "dark" || query === "light" || query === "auto") {
        state.theme = query;
        fromQuery = true;
      }
    } catch {}
    applyTheme(state.theme, !fromQuery);

    try {
      const pins = JSON.parse(localStorage.getItem("kpao-pins") || "[]");
      if (Array.isArray(pins)) state.pins = pins;
    } catch {}
    try {
      const lastAt = JSON.parse(localStorage.getItem("kpao-last-at") || "{}");
      if (lastAt && typeof lastAt === "object") state.lastAt = lastAt;
    } catch {}
    try {
      const mine = JSON.parse(localStorage.getItem("kpao-sessions") || "[]");
      if (Array.isArray(mine)) state.mySessions = mine;
    } catch {}
    try {
      const hidden = JSON.parse(localStorage.getItem("kpao-hidden") || "[]");
      if (Array.isArray(hidden)) state.hidden = hidden;
    } catch {}
    try {
      state.agentSessionId = localStorage.getItem("kpao-agent-session") || null;
    } catch {}

    renderChats();
    renderContacts();
    wire();
    lockZoom();
    syncViewport();
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", syncViewport);
      window.visualViewport.addEventListener("scroll", syncViewport);
    }
    window.addEventListener("resize", syncViewport);
    window.addEventListener("orientationchange", () => setTimeout(syncViewport, 120));

    // 截图 / 演示用：?demo=create-group / ?demo=add-bot / ?demo=members
    let demo = "";
    try {
      demo = new URLSearchParams(location.search).get("demo") || "";
    } catch {}
    if (demo === "create-group") setTimeout(openCreateGroup, 150);
    if (demo === "add-bot") setTimeout(openAddBot, 150);
    if (demo === "members" && state.convs[0]) setTimeout(() => openMembers(state.convs[0]), 150);
    if (demo === "tools")
      setTimeout(() => {
        location.hash = "#/chat/A00";
        setTimeout(openChatTools, 500);
      }, 150);
    if (demo === "settings") setTimeout(openSettings, 150);
    if (demo === "features") setTimeout(openFeatures, 150);
    if (demo === "billing") setTimeout(openBilling, 300);
    if (demo === "image")
      setTimeout(() => openImageViewer("dsh-mobile/prototype/shots/30-flat-chats.png"), 1200);
    if (demo === "sessions") setTimeout(() => void openSessionsSheet(), 400);
    if (demo === "newchat") setTimeout(openNewChatMenu, 400);
    if (demo === "pin")
      setTimeout(() => {
        const first = state.convs[0];
        if (first) openPinSheet(first.id);
      }, 400);
    if (demo === "new-group")
      setTimeout(() => {
        state.groupSelection = new Set(["A00", "C02", "R01"]);
        createGroup("信息差项目");
        setTimeout(() => sendText("这个群先同步信息差项目的进度，@Chief 汇总一下还缺什么。"), 400);
      }, 200);

    const initialHash = location.hash;
    if (!location.hash) location.replace("#/chats");
    route();

    // 每秒刷新「思考中 / 正在调用工具」的秒数（500ms 走一次，读数更连续）
    setInterval(() => {
      updateLiveStatus();
    }, 500);

    // 通过网关访问时接真实数据；本地文件打开则保留演示数据
    if (isLivePage()) {
      setDataSource("连接中…");
      liveLoadState()
        .then(() => {
          // 深链（#/chat/xxx）在真实数据加载完成后再打开一次
          if (initialHash.startsWith("#/chat/") && location.hash !== initialHash) {
            location.hash = initialHash;
          } else {
            route();
          }
          livePoll();
          liveFetch("/__im/account").then(updateBalanceShort).catch(() => {});
        })
        .catch(() => {
          setDataSource("演示模式 · 真实数据连接失败");
        });
    }

    window.__kpaoHeartbeat?.();
    setTimeout(() => window.__kpaoBootReady?.(), 150);
  }

  init();
})();
