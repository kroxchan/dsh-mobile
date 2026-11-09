/**
 * 网关的连接守护脚本（由 server.mjs 注入到 DSH GUI 的 HTML 里）。
 *
 * 手机锁屏 / 切后台 / 切网络，或电脑浏览器标签页被挂起时，页面和桌面之间的
 * WS、SSE 会断。断线期间完成的推送不会补发，页面就会停在旧状态，看起来像
 * 「任务完成了但没有结果 / 只能不停刷新」。
 *
 * 这里做三件事：
 *   1. 监控 WebSocket / EventSource 的状态；
 *   2. 断线时在页面底部显示一条可点击的提示（不改变任何布局）；
 *   3. 从后台回来且连接已断 / 离线恢复时，自动刷新一次，把结果拉回来。
 */
(function () {
  if (window.__dshMobileGuard) return;
  window.__dshMobileGuard = true;

  var sockets = [];
  var everOpened = false;
  var everLoaded = false;
  var wasDown = false;
  var hiddenAt = 0;
  var pill = null;
  var hideTimer = null;
  var checkTimer = null;

  function now() {
    return Date.now();
  }

  function wsOpen() {
    var list = sockets.filter(function (s) {
      return s.type === "ws";
    });
    if (list.length === 0) return null; // 还没有 WebSocket，说明应用没加载完
    return list.some(function (s) {
      return s.open;
    });
  }

  function connected() {
    var state = wsOpen();
    if (state === null) return true; // 还没建立连接，不提示
    return state;
  }

  function makePill() {
    if (pill) return pill;
    pill = document.createElement("div");
    pill.setAttribute("role", "status");
    pill.style.cssText = [
      "position:fixed",
      "left:50%",
      "bottom:calc(18px + env(safe-area-inset-bottom, 0px))",
      "transform:translateX(-50%)",
      "z-index:2147483647",
      "display:flex",
      "align-items:center",
      "gap:10px",
      "max-width:86vw",
      "padding:9px 14px",
      "border-radius:12px",
      "background:rgba(17,19,26,.94)",
      "color:#fff",
      "font:13px/1.4 -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif",
      "box-shadow:0 10px 30px rgba(0,0,0,.35)",
      "opacity:0",
      "pointer-events:none",
      "transition:opacity .18s ease, transform .18s ease"
    ].join(";");
    document.body.appendChild(pill);
    return pill;
  }

  function showPill(text, action, autoHideMs) {
    if (!document.body) return;
    var node = makePill();
    node.textContent = "";
    var label = document.createElement("span");
    label.textContent = text;
    node.appendChild(label);
    if (action) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = action.label;
      btn.style.cssText =
        "flex:none;border:0;border-radius:8px;padding:4px 9px;background:#4c6bff;color:#fff;font:12px/1.3 inherit;font-weight:600;cursor:pointer";
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        action.onClick();
      });
      node.appendChild(btn);
    }
    node.style.pointerEvents = "auto";
    node.style.opacity = "1";
    node.style.transform = "translateX(-50%) translateY(0)";
    clearTimeout(hideTimer);
    if (autoHideMs) {
      hideTimer = setTimeout(function () {
        node.style.opacity = "0";
        node.style.pointerEvents = "none";
      }, autoHideMs);
    }
  }

  function hidePill() {
    if (!pill) return;
    pill.style.opacity = "0";
    pill.style.pointerEvents = "none";
  }

  function reloadSoon(delay, label) {
    showPill(label || "连接已断开，正在重新加载…", null, 0);
    setTimeout(function () {
      location.reload();
    }, delay || 600);
  }

  function onDown() {
    wasDown = true;
    if (!everLoaded) return;
    setTimeout(function () {
      if (!connected()) {
        showPill("连接已断开", { label: "重新连接", onClick: function () { location.reload(); } }, 0);
      }
    }, 700);
  }

  function onUp() {
    everOpened = true;
    if (wasDown) {
      wasDown = false;
      showPill("已重新连接", { label: "刷新同步", onClick: function () { location.reload(); } }, 9000);
    } else {
      hidePill();
    }
  }

  function trackWS(socket, url) {
    var rec = { type: "ws", url: url, open: false };
    sockets.push(rec);
    if (sockets.length > 8) sockets.shift();
    socket.addEventListener("open", function () {
      rec.open = true;
      onUp();
    });
    socket.addEventListener("close", function () {
      rec.open = false;
      onDown();
    });
    socket.addEventListener("error", function () {
      rec.open = false;
      onDown();
    });
  }

  function trackSSE(source, url) {
    var rec = { type: "sse", url: url, open: false };
    sockets.push(rec);
    if (sockets.length > 8) sockets.shift();
    source.addEventListener("open", function () {
      rec.open = true;
      everLoaded = true;
    });
    source.addEventListener("error", function () {
      rec.open = false;
    });
  }

  function patchWebSocket() {
    var Native = window.WebSocket;
    if (!Native) return;
    window.WebSocket = new Proxy(Native, {
      construct: function (Target, args) {
        var socket = new Target(args[0], args[1]);
        try {
          trackWS(socket, String(args[0]));
        } catch (e) {}
        return socket;
      }
    });
  }

  function patchEventSource() {
    var Native = window.EventSource;
    if (!Native) return;
    window.EventSource = class extends Native {
      constructor(url, options) {
        super(url, options);
        try {
          trackSSE(this, String(url));
        } catch (e) {}
      }
    };
  }

  // 从后台回来：连接已断就自动刷新，连接还在就提示可以刷新
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      hiddenAt = now();
      return;
    }
    var away = hiddenAt ? now() - hiddenAt : 0;
    hiddenAt = 0;
    if (away < 8000) return;
    if (!connected()) {
      reloadSoon(600, "连接已断开，正在重新加载…");
      return;
    }
    showPill("已回到前台", { label: "刷新同步", onClick: function () { location.reload(); } }, 7000);
  });

  window.addEventListener("online", function () {
    if (!connected()) {
      reloadSoon(1200, "网络已恢复，正在重新连接…");
    }
  });
  window.addEventListener("offline", function () {
    showPill("网络已断开 · 等待恢复", null, 0);
  });

  // 页面在前台时每 12 秒查一次
  function startWatch() {
    clearInterval(checkTimer);
    checkTimer = setInterval(function () {
      if (document.hidden) return;
      if (everOpened && !connected()) {
        showPill("连接已断开", { label: "重新连接", onClick: function () { location.reload(); } }, 0);
      }
    }, 12000);
  }

  try {
    patchWebSocket();
    patchEventSource();
  } catch (e) {}
  window.addEventListener("load", function () {
    everLoaded = true;
    startWatch();
  });
  setTimeout(function () {
    everLoaded = true;
    startWatch();
  }, 12000);
})();
