"use strict";

const ui = {
  form: document.querySelector("#chat-form"),
  question: document.querySelector("#question"),
  send: document.querySelector("#send-button"),
  welcome: document.querySelector("#welcome"),
  messages: document.querySelector("#messages"),
  conversation: document.querySelector("#conversation-area"),
  error: document.querySelector("#form-error"),
  configuration: document.querySelector("#configuration-banner"),
  service: document.querySelector("#service-banner"),
  serviceMessage: document.querySelector("#service-message"),
  refresh: document.querySelector("#refresh-status"),
  retry: document.querySelector("#retry-status"),
  preview: document.querySelector("#preview-source"),
  profileTitle: document.querySelector("#profile-title"),
  filename: document.querySelector("#profile-filename"),
  sourceMeta: document.querySelector("#source-meta"),
  sourceStatus: document.querySelector("#source-status"),
  statusLabel: document.querySelector("#source-status-label"),
  newConversation: document.querySelector("#new-conversation"),
  dialog: document.querySelector("#profile-dialog"),
  dialogTitle: document.querySelector("#dialog-title"),
  dialogFilename: document.querySelector("#dialog-filename"),
  dialogNote: document.querySelector("#dialog-note"),
  sourceLines: document.querySelector("#source-lines"),
  closeDialog: document.querySelector("#dialog-close"),
  suggestions: Array.from(document.querySelectorAll(".suggestion")),
};

let ready = false;
let busy = false;
let checking = false;
let profile = null;
let conversationGeneration = 0;
let activeRequest = null;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function updateControls() {
  ui.question.disabled = !ready || busy;
  ui.send.disabled = !ready || busy || !ui.question.value.trim();
  ui.send.setAttribute("aria-label", busy ? "Waiting for answer" : "Send question");
  ui.form.setAttribute("aria-busy", String(busy));
  ui.refresh.disabled = checking || busy;
  ui.retry.disabled = checking || busy;
  ui.preview.disabled = !profile;
  ui.suggestions.forEach((button) => { button.disabled = !ready || busy; });
}

function showError(message) {
  ui.error.textContent = message || "";
  ui.error.hidden = !message;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", ...options });
  let data;
  try { data = await response.json(); }
  catch { throw new Error("The server returned an unreadable response. Please try again."); }
  if (!response.ok) {
    const detail = typeof data.detail === "string" ? data.detail : null;
    throw new Error(detail || `The request could not be completed (${response.status}). Please try again.`);
  }
  return data;
}

async function refreshStatus() {
  if (checking || busy) return;
  checking = true;
  ready = false;
  ui.refresh.textContent = "Checking…";
  ui.retry.textContent = "Checking…";
  ui.statusLabel.textContent = "Connecting";
  ui.sourceStatus.classList.remove("error");
  updateControls();
  try {
    const status = await requestJson("/api/status");
    profile = status.profile || null;
    ui.configuration.hidden = Boolean(status.configured);
    ui.service.hidden = !status.error;
    ui.serviceMessage.textContent = typeof status.error === "string" ? status.error : "";
    if (profile) {
      ui.profileTitle.textContent = profile.title || "Your profile";
      ui.filename.textContent = profile.filename || "Profile source";
      const count = Number(profile.section_count);
      ui.sourceMeta.hidden = !Number.isInteger(count) || count < 0;
      ui.sourceMeta.textContent = `${count} ${count === 1 ? "section" : "sections"} · Markdown source`;
    } else {
      ui.filename.textContent = "Source unavailable";
      ui.sourceMeta.hidden = true;
    }
    ready = Boolean(status.configured && profile && !status.error);
    ui.statusLabel.textContent = profile ? "Profile loaded" : "Source unavailable";
    ui.sourceStatus.classList.toggle("error", !profile);
  } catch (error) {
    ui.serviceMessage.textContent = "Could not connect to the local server. Check that the Python app is running, then try again.";
    ui.service.hidden = false;
    ui.statusLabel.textContent = "Connection unavailable";
    ui.sourceStatus.classList.add("error");
  } finally {
    checking = false;
    ui.refresh.textContent = "Refresh status";
    ui.retry.textContent = "Try again";
    updateControls();
  }
}

function resizeQuestion() {
  ui.question.style.height = "auto";
  ui.question.style.height = `${Math.min(ui.question.scrollHeight, 160)}px`;
}

function scrollToLatest() {
  requestAnimationFrame(() => { ui.conversation.scrollTop = ui.conversation.scrollHeight; });
}

function addMessage(kind, text, found) {
  const article = element("article", `message ${kind}-message`);
  const heading = element("div", "message-heading");
  const avatar = element("span", "message-avatar", kind === "user" ? "Y" : "p");
  avatar.setAttribute("aria-hidden", "true");
  heading.append(avatar, element("span", "", kind === "user" ? "You" : "Profile companion"));
  if (kind === "assistant") {
    heading.append(element("span", `answer-label${found ? "" : " missing"}`, found ? "From the profile" : "Not in the profile"));
  }
  article.append(heading, element("div", "message-text", text));
  ui.messages.append(article);
  return article;
}

function addLoadingMessage() {
  const article = element("article", "message assistant-message loading-message");
  article.setAttribute("role", "status");
  article.setAttribute("aria-label", "Reading the profile");
  const heading = element("div", "message-heading");
  const avatar = element("span", "message-avatar", "p");
  avatar.setAttribute("aria-hidden", "true");
  heading.append(avatar, element("span", "", "Profile companion"));
  const text = element("div", "message-text");
  const dots = element("span", "loading-dots");
  dots.setAttribute("aria-hidden", "true");
  dots.append(element("span"), element("span"), element("span"));
  text.append(dots, element("span", "", "Reading the profile…"));
  article.append(heading, text);
  ui.messages.append(article);
  return article;
}

function addSources(article, sources, profileVersion) {
  if (!Array.isArray(sources) || sources.length === 0) return;
  const group = element("div", "sources");
  group.setAttribute("aria-label", "Answer sources");
  sources.forEach((source, index) => {
    const sourceNumber = source.id ?? index + 1;
    const button = element("button", "source-card");
    button.type = "button";
    button.setAttribute("aria-label", `View source ${sourceNumber}: ${source.section || "Profile"}, lines ${source.line_start} to ${source.line_end}`);
    const heading = element("span", "source-card-heading");
    const arrow = element("span", "source-card-arrow", "↗");
    arrow.setAttribute("aria-hidden", "true");
    heading.append(element("span", "source-number", String(sourceNumber)), element("span", "", source.section || "Profile"), arrow);
    const range = source.line_start === source.line_end ? `line ${source.line_start}` : `lines ${source.line_start}–${source.line_end}`;
    button.append(heading, element("span", "source-location", `${source.filename || profile?.filename || "Profile"} · ${range}`), element("span", "source-quote", source.quote || ""));
    button.addEventListener("click", () => openProfile(source, profileVersion));
    group.append(button);
  });
  article.append(group);
}

async function askQuestion(question) {
  if (!ready || busy || !question) return;
  if (question.length > 2000) {
    showError("Please keep your question to 2,000 characters or fewer.");
    return;
  }
  busy = true;
  showError("");
  const generation = conversationGeneration;
  ui.welcome.hidden = true;
  ui.messages.hidden = false;
  const userMessage = addMessage("user", question);
  ui.question.value = "";
  resizeQuestion();
  const loading = addLoadingMessage();
  updateControls();
  scrollToLatest();
  const controller = new AbortController();
  activeRequest = controller;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 120000);
  try {
    const result = await requestJson("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
      signal: controller.signal,
    });
    if (generation !== conversationGeneration) return;
    if (typeof result.answer !== "string" || typeof result.found !== "boolean") {
      throw new Error("The server returned an incomplete answer. Please try again.");
    }
    loading.remove();
    const answer = addMessage("assistant", result.answer, result.found);
    addSources(answer, result.sources, result.profile_version);
  } catch (error) {
    if (generation !== conversationGeneration) return;
    loading.remove();
    userMessage.remove();
    ui.question.value = question;
    resizeQuestion();
    if (!ui.messages.children.length) {
      ui.welcome.hidden = false;
      ui.messages.hidden = true;
    }
    showError(timedOut ? "The answer is taking longer than expected. Your question is ready to try again." : error.message || "Could not get an answer. Please try again.");
  } finally {
    clearTimeout(timeout);
    if (generation === conversationGeneration) {
      busy = false;
      activeRequest = null;
      updateControls();
      ui.question.focus({ preventScroll: true });
      scrollToLatest();
    }
  }
}

async function openProfile(source = null, profileVersion = null) {
  ui.dialogTitle.textContent = profile?.title || "Profile";
  ui.dialogFilename.textContent = profile?.filename || "Markdown source";
  ui.dialogNote.textContent = source ? `Source ${source.id ?? ""} · ${source.section || "Profile"} · Highlighted lines ${source.line_start}–${source.line_end}` : "The Markdown profile used to answer your questions.";
  ui.sourceLines.replaceChildren(element("p", "source-loading", "Loading the profile…"));
  ui.dialog.showModal();
  ui.closeDialog.focus();
  try {
    const documentData = await requestJson("/api/profile");
    ui.dialogTitle.textContent = documentData.title || "Profile";
    ui.dialogFilename.textContent = documentData.filename || "Markdown source";
    if (source && profileVersion !== documentData.version) {
      ui.dialogNote.textContent = "This reference belongs to an earlier version of the profile.";
      ui.sourceLines.replaceChildren(element("p", "source-loading", "Profile changed since this answer. Ask again for updated references."));
      return;
    }
    const lines = Array.isArray(documentData.lines) ? documentData.lines : String(documentData.markdown || "").split("\n").map((text, index) => ({ number: index + 1, text }));
    const fragment = document.createDocumentFragment();
    let firstHighlighted = null;
    lines.forEach((line) => {
      const highlighted = source && line.number >= source.line_start && line.number <= source.line_end;
      const row = element("div", `profile-line${highlighted ? " highlighted" : ""}`);
      const number = element("span", "line-number", String(line.number));
      number.setAttribute("aria-hidden", "true");
      row.append(number, element("span", "line-text", line.text || " "));
      fragment.append(row);
      if (highlighted && !firstHighlighted) firstHighlighted = row;
    });
    ui.sourceLines.replaceChildren(fragment);
    ui.sourceLines.scrollTop = 0;
    if (firstHighlighted && ui.dialog.open) requestAnimationFrame(() => {
      ui.sourceLines.scrollTop = firstHighlighted.offsetTop - ui.sourceLines.offsetTop - 24;
    });
  } catch (error) {
    ui.sourceLines.replaceChildren(element("p", "source-loading", error.message || "Could not load the profile. Close this window and try again."));
  }
}

ui.form.addEventListener("submit", (event) => {
  event.preventDefault();
  askQuestion(ui.question.value.trim());
});
ui.question.addEventListener("input", () => { resizeQuestion(); updateControls(); showError(""); });
ui.question.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!ui.send.disabled) ui.form.requestSubmit();
  }
});
ui.suggestions.forEach((button) => button.addEventListener("click", () => askQuestion(button.dataset.question)));
ui.refresh.addEventListener("click", refreshStatus);
ui.retry.addEventListener("click", refreshStatus);
ui.preview.addEventListener("click", () => openProfile());
ui.closeDialog.addEventListener("click", () => ui.dialog.close());
ui.dialog.addEventListener("click", (event) => {
  if (event.target !== ui.dialog) return;
  const bounds = ui.dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) ui.dialog.close();
});
ui.newConversation.addEventListener("click", () => {
  conversationGeneration += 1;
  activeRequest?.abort();
  activeRequest = null;
  busy = false;
  ui.messages.replaceChildren();
  ui.messages.hidden = true;
  ui.welcome.hidden = false;
  ui.question.value = "";
  resizeQuestion();
  showError("");
  updateControls();
  ui.conversation.scrollTop = 0;
  if (ready) ui.question.focus({ preventScroll: true });
});

refreshStatus();
