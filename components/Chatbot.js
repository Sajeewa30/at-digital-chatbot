"use client";
import React, { useCallback, useMemo, useState, useEffect, useRef } from "react";

// Render message text with clickable links.
// Supports Markdown links [text](https://...) and bare URLs.
function renderMessageWithLinks(text, opts = {}) {
  const isTyping = !!opts.isTyping;
  const safeText = String(text ?? "");
  const lines = safeText.split(/\n/);
  const mdLink = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  const bareUrl = /(https?:\/\/[^\s]+)/g;

  return lines.map((line, li) => {
    // While typing, hide partially-typed markdown link URLs like: [label](https://...<incomplete>)
    // Replace them with just the label so users never see the long URL during typing.
    let displayLine = line;
    if (isTyping) {
      const partialMd = /\[([^\]]+)\]\([^)]*$/; // incomplete markdown link until end of line
      // Replace repeatedly in case of multiple occurrences on the same line
      while (partialMd.test(displayLine)) {
        displayLine = displayLine.replace(partialMd, "$1");
      }
    }

    const pattern = new RegExp(`${mdLink.source}|${bareUrl.source}`, "g");
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(displayLine)) !== null) {
      if (match.index > lastIndex) {
        parts.push(displayLine.slice(lastIndex, match.index));
      }
      let href, label;
      if (match[1] && match[2]) {
        // Markdown link
        label = match[1];
        href = match[2];
      } else {
        // Bare URL
        label = match[0];
        href = match[0];
      }
      // Do not render inline links; show only plain label for markdown, and hide bare URLs
      if (match[1] && match[2]) {
        // Markdown link: render label only (no anchor)
        parts.push(
          <React.Fragment key={`msg-link-${li}-${parts.length}`}>
            {label}
          </React.Fragment>
        );
      } else {
        // Bare URL: hide from inline text
        // no-op: do not push anything so raw URL is not visible
      }
      lastIndex = pattern.lastIndex;
    }

    if (lastIndex < displayLine.length) {
      parts.push(displayLine.slice(lastIndex));
    }

    return (
      <React.Fragment key={`msg-line-${li}`}>
        {parts}
        {li < lines.length - 1 ? <br /> : null}
      </React.Fragment>
    );
  });
}

// While typing, show a stable, plain-text view:
// - Convert complete Markdown links [label](url) to just `label`
// - Hide bare URLs entirely so they don't pop in/out
// - Also collapse partially-typed Markdown links to the label
function sanitizeTypingDisplay(text) {
  const safe = String(text ?? "");
  const mdComplete = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  const bareUrl = /(https?:\/\/[^\s]+)/g;
  const mdPartial = /\[([^\]]+)\]\([^)]*$/; // until end of line

  const lines = safe.split(/\n/);
  const out = lines.map((line) => {
    let s = line;
    // Replace complete markdown links with their label
    s = s.replace(mdComplete, "$1");
    // Hide bare URLs from the typing display
    s = s.replace(bareUrl, "");
    // Repeatedly collapse partially-typed markdown to the label
    let guard = 0;
    while (mdPartial.test(s) && guard++ < 10) {
      s = s.replace(mdPartial, "$1");
    }
    return s;
  });
  return out.join("\n");
}

// Note: Messages are rendered via ReactMarkdown with remark-gfm
// to support links, lists, tables, code blocks, etc.

const defaultConfig = {
  webhook: { url: "", route: "" },
  typingSpeedMs: 20,
  branding: {
    logo: "",
    name: "",
    welcomeText: "",
    responseTimeText: "",
    poweredBy: {
      text: "Powered by AT Digital",
      link: "https://atdigital.io/",
    },
  },
  style: {
    primaryColor: "#4C46F7",
    secondaryColor: "#7A5CFF",
    position: "right",
    backgroundColor: "#0B1025",
    fontColor: "#E4E7FF",
  },
};

export default function Chatbot({ config: userConfig }) {
  // Light input normalization: collapse spaces, trim, drop trailing punctuation
  const normalizeInput = useCallback((text) => {
    const raw = String(text ?? "");
    const collapsed = raw.replace(/\s+/g, " ").trim();
    // Remove simple trailing punctuation like ., !, ?, …
    return collapsed.replace(/[.!?…]+$/g, "");
  }, []);
  const config = useMemo(() => {
    const merged = {
      webhook: { ...defaultConfig.webhook, ...(userConfig?.webhook || {}) },
      branding: { ...defaultConfig.branding, ...(userConfig?.branding || {}) },
      style: { ...defaultConfig.style, ...(userConfig?.style || {}) },
      typingSpeedMs: Number(
        userConfig?.typingSpeedMs ?? defaultConfig.typingSpeedMs
      ),
    };
    return merged;
  }, [userConfig]);

  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]); // { role: 'user'|'bot', text: string }
  const [sending, setSending] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [debug, setDebug] = useState({
    w: 0,
    mq: false,
    dpr: 1,
    rect: null,
    top: "",
    left: "",
    width: "",
    height: "",
  });
  // CTAs persist per message; no global active gating
  // Typing speed for bot replies (milliseconds per character)
  // Adjust via `config.typingSpeedMs` when using the component.
  const typingSpeedMs = Math.max(1, Number(config?.typingSpeedMs ?? 20));

  const positionLeft = config.style.position === "left";

  // Helper to keep scroll pinned near the bottom unless the user scrolls up
  const scrollToBottom = useCallback(
    (force = false) => {
      const container = messagesRef.current;
      if (!container) return;
      const distance =
        container.scrollHeight - (container.scrollTop + container.clientHeight);
      if (force || distance <= 80) {
        container.scrollTop = container.scrollHeight;
      }
    },
    []
  );

  // Refs for outside-click handling
  const containerRef = useRef(null);
  const toggleRef = useRef(null);
  // Refs for scrolling behavior
  const messagesRef = useRef(null);
  const lastBotRef = useRef(null);
  // Interval reference for the typewriter effect
  const typingTimerRef = useRef(null);
  // Track which bot message is currently being typed (by id)
  const typingMessageIdRef = useRef(null);
  // Full text of the message currently being typed (for graceful finalization)
  const typingFullTextRef = useRef("");

  // Close when clicking outside the chat container and toggle button
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e) => {
      const withinContainer = containerRef.current?.contains(e.target);
      const withinToggle = toggleRef.current?.contains(e.target);
      if (!withinContainer && !withinToggle) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  // Mount gate to avoid FOUC during SSR/hydration
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const mql = window.matchMedia("(max-width: 640px)");
    const update = () => {
      setIsMobile(mql.matches);
      let rect = null;
      let top = "";
      let left = "";
      let width = "";
      let height = "";
      if (open && containerRef.current) {
        rect = containerRef.current.getBoundingClientRect();
        const cs = window.getComputedStyle(containerRef.current);
        top = cs.top;
        left = cs.left;
        width = cs.width;
        height = cs.height;
      }
      setDebug({
        w: window.innerWidth,
        mq: mql.matches,
        dpr: window.devicePixelRatio || 1,
        rect,
        top,
        left,
        width,
        height,
      });
    };
    update();
    mql.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      mql.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, [mounted, open]);

  // Clear any running typing interval on unmount
  useEffect(() => {
    return () => {
      if (typingTimerRef.current) {
        clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;
      }
    };
  }, []);

  // Auto-scroll behavior: user → bottom, bot → start of reply
  useEffect(() => {
    if (!messages.length) return;
    const container = messagesRef.current;
    if (!container) return;
    const last = messages[messages.length - 1];
    if (last.role === "user") {
      // Scroll to bottom so the sent message is visible
      scrollToBottom(true);
    } else {
      // Align to the top of the new bot reply when it finishes typing
      const isTypingCurrent =
        Boolean(typingTimerRef.current) && last.id === typingMessageIdRef.current;
      if (isTypingCurrent) {
        scrollToBottom(false);
      } else if (lastBotRef.current) {
        lastBotRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } else {
        scrollToBottom(true);
      }
    }
  }, [messages, scrollToBottom]);

  // Ensure typing indicator stays visible by keeping view scrolled
  useEffect(() => {
    if (!sending) return;
    scrollToBottom(true);
  }, [sending, scrollToBottom]);

  // When the user is typing, keep the indicator in view
  useEffect(() => {
    if (hasFocus && input && !sending) {
      scrollToBottom(true);
    }
  }, [hasFocus, input, sending, scrollToBottom]);

  const addMessage = useCallback((role, text) => {
    const id = crypto.randomUUID();
    setMessages((prev) => [...prev, { id, role, text }]);
  }, []);

  // Typewriter effect for bot messages: streams characters over time
  // Extract links from full text (markdown and bare URLs)
  const extractLinks = useCallback((fullText) => {
    const s = String(fullText || "");

    const stripTrailingPunct = (u) => (u || "").trim().replace(/[\)\]\}\>\.,!?:;]+$/g, "");

    const normalizeKey = (rawUrl) => {
      try {
        const cleaned = stripTrailingPunct(rawUrl);
        const u = new URL(cleaned);
        const host = (u.hostname || "").toLowerCase().replace(/^www\./, "");
        // Remove tracking params and order query params for stable keys
        const sp = new URLSearchParams(u.search);
        const kept = new URLSearchParams();
        for (const [k, v] of sp.entries()) {
          if (!/^utm_/i.test(k) && k.toLowerCase() !== "fbclid") kept.append(k, v);
        }
        const query = kept.toString();
        // Normalize path: remove trailing slash (except root)
        let path = u.pathname || "/";
        if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
        return { key: `${host}${path}${query ? `?${query}` : ""}`, host };
      } catch {
        return { key: null, host: null };
      }
    };

    const mdLinksRaw = [];
    const bareLinksRaw = [];

    // Markdown links (preferred)
    const md = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    let m;
    while ((m = md.exec(s)) !== null) {
      mdLinksRaw.push({ url: m[2], label: (m[1] || "").trim() });
    }

    // Bare URLs (used only if no markdown links exist)
    const bare = /(https?:\/\/[^\s]+)/g;
    while ((m = bare.exec(s)) !== null) {
      bareLinksRaw.push({ url: m[0], label: m[0] });
    }

    // Choose source: prefer markdown links, but also include important bare URLs
    const raw = [];
    if (mdLinksRaw.length) {
      // Start with explicit markdown links
      raw.push(...mdLinksRaw);
      // Also include bare URLs from allowed domains that are likely task links
      // Heuristics: has query string OR path depth > 1
      for (const it of bareLinksRaw) {
        try {
          const u = new URL(stripTrailingPunct(it.url));
          const host = (u.hostname || "").toLowerCase();
          const allowedHost =
            host === "atdigital.io" ||
            host.endsWith(".atdigital.io");
          const pathDepth = (u.pathname || "/").split("/").filter(Boolean).length;
          if (allowedHost && (u.search || pathDepth > 1)) {
            raw.push(it);
          }
        } catch { /* ignore */ }
      }
    } else {
      raw.push(...bareLinksRaw);
    }

    // Whitelist domain (spanmor.com.au and subdomains) and de-duplicate canonically
    const results = [];
    const seen = new Set();
    for (const it of raw) {
      const cleanedUrl = stripTrailingPunct(it.url);
      const { key, host } = normalizeKey(cleanedUrl);
      if (!key || !host) continue;
      const allowedHost =
        host === "atdigital.io" ||
        host.endsWith(".atdigital.io");
      if (!allowedHost) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ url: cleanedUrl, label: it.label });
    }

    return results;
  }, []);

  const typeOutBotMessage = useCallback(
    (fullText) => {
      const text = String(fullText ?? "").trim();

      // If a previous typing timer is active, clear it before starting a new one
      if (typingTimerRef.current) {
        // Finalize the currently typing message before starting a new one
        const prevId = typingMessageIdRef.current;
        const prevFull = typingFullTextRef.current || "";
        if (prevId) {
          setMessages((prev) => {
            const updated = [...prev];
            const idx = updated.findIndex((m) => m.id === prevId);
            if (idx !== -1) {
              updated[idx] = { ...updated[idx], text: prevFull };
            }
            return updated;
          });
        }
        clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;
      }
      // Reset any previous typing target
      typingMessageIdRef.current = null;
      typingFullTextRef.current = "";

      // Skip creating an empty bot bubble if there's no content
      const len = text.length;
      if (len === 0) {
        return;
      }

      // Create a dedicated bot message with a stable id to update
      const id = crypto.randomUUID();
      typingMessageIdRef.current = id;
      typingFullTextRef.current = text;
      // Create the target bot message we will progressively update
      // Extract links once so we can show CTAs and clickable anchors immediately
      const links = extractLinks(text);
      setMessages((prev) => [...prev, { id, role: "bot", text: "", links }]);

      let i = 0;

      typingTimerRef.current = setInterval(() => {
        i += 1;
        // Use the stable id captured in closure to avoid racing with ref clearing
        const targetId = id;
        setMessages((prev) => {
          if (!prev.length) return prev;
          const updated = [...prev];
          const idx = updated.findIndex((m) => m.id === targetId);
          if (idx === -1) return prev;
          updated[idx] = { ...updated[idx], text: text.slice(0, i) };
          return updated;
        });

        // Keep the latest content visible as it grows
        scrollToBottom(false);

        if (i >= len) {
          clearInterval(typingTimerRef.current);
          typingTimerRef.current = null;
          typingMessageIdRef.current = null;
          // Bot message finished typing; CTAs render based on message state
        }
      }, typingSpeedMs);
    },
    [typingSpeedMs, extractLinks, scrollToBottom]
  );

  const startNewConversation = useCallback(() => {
    // Open UI and immediately show the fixed local welcome message
    const id = crypto.randomUUID();
    setSessionId(id);
    setStarted(true);
    setSending(false);
    typeOutBotMessage(`Hi there! Welcome to AT Digital.`);
  }, [typeOutBotMessage]);

  useEffect(() => {
    if (open && !started) {
      startNewConversation();
    }
  }, [open, started, startNewConversation]);

  const sendMessage = useCallback(async () => {
    const display = String(input ?? "").trim();
    const message = normalizeInput(input);
    if (!message || !sessionId || sending) return;
    // Show what the user typed (with punctuation) in UI
    addMessage("user", display);
    setInput("");
    setSending(true);

    const payload = {
      action: "sendMessage",
      sessionId,
      route: config.webhook.route,
      chatInput: message,
      metadata: { userId: "" },
    };

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let data = null;
      try {
        data = await res.json();
      } catch (_) {
        data = null;
      }
      const botReply = Array.isArray(data) ? data?.[0]?.output : data?.output;
      // Hide the loading indicator and start typing the reply
      setSending(false);
      typeOutBotMessage(botReply || "Hi! I'm here to help you.");
    } catch (e) {
      setSending(false);
      addMessage("bot", "Sorry, there was a problem sending your message.");
    } finally {
      // no-op: sending already handled above
    }
  }, [addMessage, config.webhook.route, input, sending, sessionId, typeOutBotMessage]);

  // Send a pre-defined quick message using the same webhook flow
  const sendQuickMessage = useCallback(
    async (quickText, sendText) => {
      const display = String(quickText || "").trim();
      const message = normalizeInput(sendText ?? quickText);
      if (!message || !sessionId || sending) return;
      // Show the display text in UI
      addMessage("user", display);
      setSending(true);

      const payload = {
        action: "sendMessage",
        sessionId,
        route: config.webhook.route,
        chatInput: message,
        metadata: { userId: "" },
      };

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        let data = null;
        try {
          data = await res.json();
        } catch (_) {
          data = null;
        }
        const botReply = Array.isArray(data) ? data?.[0]?.output : data?.output;
        setSending(false);
        typeOutBotMessage(botReply || "Hi! I'm here to help you.");
      } catch (e) {
        setSending(false);
        addMessage("bot", "Sorry, there was a problem sending your message.");
      } finally {
        // no-op: sending already handled above
      }
    },
    [addMessage, config.webhook.route, normalizeInput, sending, sessionId, typeOutBotMessage]
  );

  if (!mounted) return null;

  const showDebug = true;
  const containerStyle = {
    display: open ? "flex" : "none",
    ...(isMobile
      ? {
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          width: "100%",
          height: "100%",
          maxWidth: "100vw",
          maxHeight: "100dvh",
          borderRadius: 0,
          boxShadow: "none",
          overflowY: "auto",
        }
      : null),
  };

  const brandName = (config.branding.name || "AT Digital").trim() || "AT Digital";
  const heroSubtext = `Ask anything about ${brandName}'s services, strategy, or support.`;
  const quickReplyOptions = [
    {
      label: `Tell me about ${brandName}'s services`,
      send: `Tell me about ${brandName}'s services`,
    },
    {
      label: "I need help crafting my digital strategy",
      send: "I need help crafting my digital strategy",
    },
    {
      label: `Connect me with an expert at ${brandName}`,
      send: `Connect me with an expert at ${brandName}`,
    },
  ];
  const showQuickReplies = messages.filter((m) => m.role === "user").length === 0;

  return (
    <div
      className="n8n-chat-widget"
      style={{
        ["--n8n-chat-primary-color"]: config.style.primaryColor,
        ["--n8n-chat-secondary-color"]: config.style.secondaryColor,
        ["--n8n-chat-background-color"]: config.style.backgroundColor,
        ["--n8n-chat-font-color"]: config.style.fontColor,
      }}
    >
      <div
        className={`chat-container${open ? " open" : ""}${positionLeft ? " position-left" : ""}`}
        ref={containerRef}
        style={containerStyle}
      >
        <div className="chat-shell">
          <div className="chat-hero">
            <div className="brand-cluster">
              {config.branding.logo ? (
                <span className="brand-logo">
                  <img src={config.branding.logo} alt={brandName} />
                </span>
              ) : (
                <span className="brand-logo placeholder">{brandName.charAt(0)}</span>
              )}
              <div className="brand-text">
                <p className="brand-name">{brandName}</p>
                <p className="brand-meta">
                  {config.branding.responseTimeText || "Typically replies instantly"}
                </p>
              </div>
            </div>
            <button
              className="close-button"
              aria-label="Close chat"
              onClick={() => setOpen(false)}
              type="button"
            >
              <svg viewBox="0 0 24 24" role="presentation">
                <path
                  d="M12 10.586 5.757 4.343 4.343 5.757 10.586 12l-6.243 6.243 1.414 1.414L12 13.414l6.243 6.243 1.414-1.414L13.414 12l6.243-6.243-1.414-1.414Z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>
          <div className="hero-copy">
            <p className="hero-title">{config.branding.welcomeText}</p>
            <p className="hero-subtitle">{heroSubtext}</p>
          </div>
          <div className="chat-messages" ref={messagesRef}>
            {messages.map((m, i) => {
              const isTypingMsg = Boolean(typingTimerRef.current) && m.id === typingMessageIdRef.current;
              const isLastBot = i === messages.length - 1 && m.role === "bot";

              let cta = null;
              if (
                m.role === "bot" &&
                Array.isArray(m.links) &&
                m.links.length > 0 &&
                !isTypingMsg
              ) {
                const createLabel = (lnk) => {
                  const cleanText = (t) =>
                    t
                      .replace(/[\)\]\}\>\.,!?:;]+$/g, "")
                      .replace(/^\s*(the|a|an)\s+/i, "")
                      .replace(/\b(page|webpage|site)\b/gi, "")
                      .replace(/\s{2,}/g, " ")
                      .trim();

                  const raw = cleanText(String(lnk.label || ""));
                  const looksLikeUrlish =
                    /https?:|:\/\//i.test(raw) || /\//.test(raw) || /\.[a-z]{2,}$/i.test(raw);
                  if (raw && raw !== lnk.url && !looksLikeUrlish) {
                    const title = raw.replace(/\b\w/g, (c) => c.toUpperCase());
                    return `Open ${title}`;
                  }
                  try {
                    const u = new URL(lnk.url);
                    const host = (u.hostname || "").replace(/^www\./, "");
                    const path = u.pathname || "/";
                    const segs = path.split("/").filter(Boolean);
                    if (segs.length === 0) {
                      const site = host.split(".")[0] || host;
                      const title = site.charAt(0).toUpperCase() + site.slice(1);
                      return `Open ${title}`;
                    }
                    const last = cleanText(
                      decodeURIComponent(segs[segs.length - 1]).replace(/[\-_]+/g, " ").replace(/\s+/g, " ")
                    );
                    const title = last.replace(/\b\w/g, (c) => c.toUpperCase());
                    return `Open ${title}`;
                  } catch (_) {
                    return "Open Link";
                  }
                };

                cta = (
                  <div className="message-actions">
                    {m.links.map((lnk, idx) => (
                      <button
                        key={`cta-${m.id || i}-${idx}`}
                        type="button"
                        className="link-action"
                        onClick={() => window.open(lnk.url, "_blank", "noopener,noreferrer")}
                        aria-label={createLabel(lnk)}
                        title={lnk.url}
                      >
                        {createLabel(lnk)}
                      </button>
                    ))}
                  </div>
                );
              }

              return (
                <React.Fragment key={m.id || i}>
                  <div
                    className={`chat-message ${m.role}`}
                    ref={isLastBot ? lastBotRef : null}
                    style={{ whiteSpace: "pre-wrap" }}
                  >
                    {isTypingMsg
                      ? sanitizeTypingDisplay(m.text)
                      : renderMessageWithLinks(m.text, { isTyping: false })}
                  </div>
                  {cta}
                </React.Fragment>
              );
            })}
            {hasFocus && !sending && input && (
              <div className="chat-message user typing-indicator">
                <span className="typing-dots">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </span>
              </div>
            )}
            {sending && (
              <div className="chat-message bot typing-indicator" ref={lastBotRef}>
                <span className="typing-dots">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </span>
              </div>
            )}
          </div>
          {showQuickReplies && (
            <div className="quick-replies">
              {quickReplyOptions.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className="quick-reply"
                  disabled={sending}
                  onClick={() => sendQuickMessage(option.label, option.send)}
                  aria-label={option.label}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          <div className="chat-input">
            <textarea
              placeholder={`Ask ${brandName} anything...`}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setHasFocus(true)}
              onBlur={() => setHasFocus(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
            />
            <button type="button" onClick={sendMessage} disabled={sending}>
              {sending ? "Sending..." : "Send"}
              <svg viewBox="0 0 24 24" role="presentation">
                <path d="M3.4 20.4 22 12 3.4 3.6 3 10l11 2-11 2z" fill="currentColor" />
              </svg>
            </button>
          </div>
          <div className="chat-footer">
            <a href={config.branding.poweredBy.link} target="_blank">
              {config.branding.poweredBy.text}
            </a>
          </div>
        </div>
      </div>

      <button
        className={`chat-toggle${positionLeft ? " position-left" : ""}`}
        ref={toggleRef}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Open chat"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
          <path d="M4 3h16a2 2 0 0 1 2 2v13.764a1 1 0 0 1-1.553.833l-4.894-3.263H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
        </svg>
      </button>

      {showDebug && (
        <div className="debug-badge" aria-hidden="true">
          <div>w:{debug.w}px mq:{debug.mq ? "1" : "0"} dpr:{debug.dpr}</div>
          {debug.rect && (
            <div>
              rect:{Math.round(debug.rect.left)},{Math.round(debug.rect.top)} {Math.round(debug.rect.width)}x{Math.round(debug.rect.height)}
            </div>
          )}
          {debug.rect && (
            <div>
              css:{debug.left},{debug.top} {debug.width}x{debug.height}
            </div>
          )}
        </div>
      )}

      {/* Styles ported from the original widget */}
      <style jsx>{`
        .n8n-chat-widget {
          --chat-primary: var(--n8n-chat-primary-color, #4c46f7);
          --chat-secondary: var(--n8n-chat-secondary-color, #7a5cff);
          --chat-surface: var(--n8n-chat-background-color, #0b1025);
          --chat-font: var(--n8n-chat-font-color, #e4e7ff);
          --chat-panel: rgba(11, 16, 37, 0.95);
          --chat-border: rgba(124, 110, 255, 0.35);
          --chat-user-bg: #ffffff;
          --chat-user-text: #0b1025;
          font-family: var(--font-geist-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif);
          color: var(--chat-font);
        }

        .chat-container {
          position: fixed;
          bottom: 24px;
          right: 24px;
          width: 420px;
          height: 640px;
          border-radius: 28px;
          background: radial-gradient(circle at top right, rgba(124, 110, 255, 0.35), transparent 40%), var(--chat-surface);
          border: 1px solid var(--chat-border);
          box-shadow: 0 25px 70px rgba(6, 7, 29, 0.8);
          overflow: hidden;
          display: none;
          z-index: 1000;
        }

        .chat-container.position-left {
          right: auto;
          left: 24px;
        }

        .chat-container.open {
          display: flex;
        }

        .chat-shell {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: 24px;
          gap: 16px;
          background: rgba(8, 12, 30, 0.65);
          backdrop-filter: blur(18px);
        }

        .chat-hero {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .brand-cluster {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .brand-logo {
          width: 44px;
          height: 44px;
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.1);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        .brand-logo img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .brand-logo.placeholder {
          font-weight: 600;
          font-size: 18px;
          color: var(--chat-font);
        }

        .brand-text {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .brand-name {
          margin: 0;
          font-weight: 600;
          font-size: 16px;
          color: var(--chat-font);
        }

        .brand-meta {
          margin: 0;
          font-size: 13px;
          color: rgba(228, 231, 255, 0.7);
        }

        .close-button {
          border: none;
          background: rgba(255, 255, 255, 0.08);
          color: var(--chat-font);
          width: 36px;
          height: 36px;
          border-radius: 50%;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: background 0.2s ease, transform 0.2s ease;
        }

        .close-button svg {
          width: 18px;
          height: 18px;
        }

        .close-button:hover {
          background: rgba(255, 255, 255, 0.18);
          transform: scale(1.05);
        }

        .hero-copy {
          background: linear-gradient(135deg, rgba(76, 70, 247, 0.14), rgba(122, 92, 255, 0.05));
          border: 1px solid rgba(124, 110, 255, 0.3);
          border-radius: 18px;
          padding: 18px 20px;
        }

        .hero-title {
          margin: 0 0 6px 0;
          font-size: 20px;
          font-weight: 600;
          color: #ffffff;
        }

        .hero-subtitle {
          margin: 0;
          font-size: 14px;
          color: rgba(228, 231, 255, 0.75);
        }

        .chat-messages {
          flex: 1;
          border-radius: 18px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(7, 10, 26, 0.55);
          padding: 18px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
        }

        .chat-message {
          padding: 12px 16px;
          border-radius: 18px;
          margin-bottom: 12px;
          font-size: 14px;
          line-height: 1.5;
          width: fit-content;
          max-width: 85%;
          word-break: break-word;
        }

        .chat-message.user {
          background: var(--chat-user-bg);
          color: var(--chat-user-text);
          align-self: flex-end;
          border-bottom-right-radius: 6px;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
        }

        .chat-message.bot {
          background: rgba(255, 255, 255, 0.05);
          color: var(--chat-font);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-bottom-left-radius: 6px;
        }

        .chat-message.typing-indicator {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 30px;
          padding: 8px 12px;
        }

        .typing-dots {
          display: inline-flex;
          gap: 6px;
          color: inherit;
        }

        .typing-dots .dot {
          width: 8px;
          height: 8px;
          background: currentColor;
          border-radius: 50%;
          opacity: 0.2;
          animation: blink 1.4s infinite both;
        }

        .typing-dots .dot:nth-child(2) { animation-delay: 0.2s; }
        .typing-dots .dot:nth-child(3) { animation-delay: 0.4s; }

        @keyframes blink {
          0%, 80%, 100% { opacity: 0.2; }
          40% { opacity: 1; }
        }

        .message-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin: -4px 0 12px 0;
        }

        .link-action {
          border: none;
          border-radius: 999px;
          padding: 8px 14px;
          font-size: 13px;
          font-weight: 500;
          background: linear-gradient(135deg, var(--chat-primary), var(--chat-secondary));
          color: #fff;
          cursor: pointer;
          transition: transform 0.2s ease;
        }

        .link-action:hover {
          transform: translateY(-1px);
        }

        .quick-replies {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 10px;
        }

        .quick-reply {
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.02);
          border-radius: 14px;
          padding: 10px 12px;
          color: rgba(228, 231, 255, 0.86);
          font-size: 13px;
          text-align: left;
          cursor: pointer;
          transition: background 0.2s ease, transform 0.2s ease, border 0.2s ease;
        }

        .quick-reply:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.2);
          transform: translateY(-1px);
        }

        .quick-reply:disabled {
          opacity: 0.4;
          pointer-events: none;
        }

        .chat-input {
          display: flex;
          gap: 12px;
          align-items: flex-end;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 18px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          padding: 12px;
        }

        .chat-input textarea {
          flex: 1;
          border: none;
          resize: none;
          background: transparent;
          color: var(--chat-font);
          font-family: inherit;
          font-size: 14px;
          min-height: 44px;
          outline: none;
        }

        .chat-input textarea::placeholder {
          color: rgba(228, 231, 255, 0.6);
        }

        .chat-input button {
          border: none;
          border-radius: 14px;
          padding: 10px 16px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: linear-gradient(135deg, var(--chat-primary), var(--chat-secondary));
          color: #fff;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.2s ease;
        }

        .chat-input button svg {
          width: 18px;
          height: 18px;
        }

        .chat-input button:hover {
          transform: translateY(-1px);
        }

        .chat-toggle {
          position: fixed;
          bottom: 24px;
          right: 24px;
          width: 64px;
          height: 64px;
          border-radius: 24px;
          border: none;
          background: linear-gradient(135deg, var(--chat-primary), var(--chat-secondary));
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          box-shadow: 0 20px 45px rgba(76, 70, 247, 0.45);
          z-index: 999;
          transition: transform 0.25s ease, box-shadow 0.25s ease;
        }

        .chat-toggle.position-left { right: auto; left: 24px; }
        .chat-toggle:hover {
          transform: translateY(-4px);
          box-shadow: 0 25px 60px rgba(76, 70, 247, 0.55);
        }
        .chat-toggle svg { width: 28px; height: 28px; fill: currentColor; }

        .chat-footer {
          text-align: center;
          font-size: 12px;
          color: rgba(228, 231, 255, 0.65);
        }

        .chat-footer a {
          color: rgba(170, 173, 255, 0.95);
          text-decoration: none;
          font-weight: 500;
        }

        .debug-badge {
          position: fixed;
          top: 8px;
          left: 8px;
          background: rgba(0, 0, 0, 0.7);
          color: #fff;
          font-size: 11px;
          padding: 4px 6px;
          border-radius: 6px;
          z-index: 2000;
          pointer-events: none;
          line-height: 1.3;
        }

        @media (max-width: 640px) {
          .chat-container {
            inset: 0;
            margin: 0;
            width: 100%;
            max-width: 100vw;
            height: 100%;
            max-height: 100dvh;
            border-radius: 0;
            box-shadow: none;
            overflow-y: auto;
            transform: none;
          }

          .chat-container.position-left {
            left: 0;
            right: 0;
          }

          .chat-shell {
            min-height: 100%;
            padding: calc(16px + env(safe-area-inset-top))
              calc(16px + env(safe-area-inset-right))
              calc(16px + env(safe-area-inset-bottom))
              calc(16px + env(safe-area-inset-left));
            gap: 12px;
          }

          .hero-copy {
            padding: 8px 10px;
            border-radius: 12px;
          }

          .hero-title {
            font-size: 14px;
            margin-bottom: 4px;
          }

          .hero-subtitle {
            font-size: 12px;
          }

          .chat-toggle {
            bottom: 16px;
            right: 16px;
            width: 56px;
            height: 56px;
            border-radius: 20px;
          }

          .chat-toggle.position-left {
            left: 16px;
            right: auto;
          }
        }
      `}</style>
    </div>
  );
}
