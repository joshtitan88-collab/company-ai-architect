/**
 * SamAvatar — optional Tavus CVI Echo renderer.
 * Keeps Company AI Architect's existing brain and booking tools, while Tavus
 * supplies the photoreal, lip-synced face. Falls back invisibly when disabled.
 */
(function (root) {
  "use strict";

  var DAILY_SRC = "https://unpkg.com/@daily-co/daily-js@0.92.2/dist/daily.js";
  var call = null;
  var conversationId = "";
  var active = false;
  var loading = null;

  function loadDaily() {
    if (root.DailyIframe) return Promise.resolve(root.DailyIframe);
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-sam-daily="1"]');
      if (existing) {
        existing.addEventListener("load", function () { resolve(root.DailyIframe); }, { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }
      var s = document.createElement("script");
      s.src = DAILY_SRC;
      s.crossOrigin = "anonymous";
      s.dataset.samDaily = "1";
      s.onload = function () { root.DailyIframe ? resolve(root.DailyIframe) : reject(new Error("daily_missing")); };
      s.onerror = function () { reject(new Error("daily_load_failed")); };
      document.head.appendChild(s);
    });
  }

  function appMessage(event) {
    var data = event && (event.data || event);
    if (!data || data.message_type !== "conversation") return;
    if (data.event_type === "conversation.replica.started_speaking") {
      root.dispatchEvent(new CustomEvent("samvoice:start", { detail: { source: "avatar" } }));
    }
    if (data.event_type === "conversation.replica.stopped_speaking") {
      root.dispatchEvent(new CustomEvent("samvoice:end", { detail: { source: "avatar" } }));
    }
  }

  function start() {
    if (active) return Promise.resolve(true);
    if (loading) return loading;
    loading = fetch("/api/tavus-session", { method: "GET" })
      .then(function (r) { return r.json(); })
      .then(function (config) {
        if (!config.enabled) throw new Error("avatar_disabled");
        return Promise.all([
          loadDaily(),
          fetch("/api/tavus-session", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
            .then(function (r) { if (!r.ok) throw new Error("avatar_" + r.status); return r.json(); }),
        ]);
      }).then(function (parts) {
      var DailyIframe = parts[0];
      var data = parts[1];
      var host = document.getElementById("liveAvatar");
      if (!host || !data.ok) throw new Error("avatar_unavailable");
      conversationId = data.conversationId;
      call = DailyIframe.createFrame(host, {
        showLeaveButton: false,
        showFullscreenButton: false,
        iframeStyle: { width: "100%", height: "100%", border: "0" },
        dailyConfig: { avoidEval: true },
      });
      call.on("app-message", appMessage);
      call.on("left-meeting", function () { active = false; host.classList.remove("active"); });
      var join = { url: data.conversationUrl };
      if (data.meetingToken) join.token = data.meetingToken;
      return call.join(join).then(function () {
        active = true;
        host.classList.add("active");
        document.getElementById("desk").classList.add("avatar-live");
        return true;
      });
    }).catch(function () {
      active = false;
      return false;
    }).finally(function () { loading = null; });
    return loading;
  }

  function send(eventType, properties) {
    if (!active || !call || !conversationId) return false;
    call.sendAppMessage({
      message_type: "conversation",
      event_type: eventType,
      conversation_id: conversationId,
      properties: properties || {},
    }, "*");
    return true;
  }

  function speak(text) {
    return send("conversation.echo", {
      modality: "text",
      text: String(text || ""),
      inference_id: "sam-" + Date.now(),
      done: true,
    });
  }

  function stop() {
    return send("conversation.interrupt", {});
  }

  function end() {
    if (!conversationId) return;
    var payload = JSON.stringify({ action: "end", conversationId: conversationId });
    try { navigator.sendBeacon("/api/tavus-session", new Blob([payload], { type: "application/json" })); } catch (_e) {}
    if (call) {
      try { call.leave(); call.destroy(); } catch (_e) {}
    }
    call = null;
    active = false;
  }

  root.addEventListener("pagehide", end, { once: true });
  root.SamAvatar = { start: start, speak: speak, stop: stop, end: end, active: function () { return active; } };
})(window);
