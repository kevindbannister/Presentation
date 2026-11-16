const state = { slides: [], active: 0, ws: null, obsConnected: false, outputWindow: null, notesKey: "" };
const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
let toastTimer;

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}
function setObsStatus(connected, error) {
  state.obsConnected = !!connected;
  $("obs-dot").parentElement.classList.toggle("connected", !!connected);
  $("obs-status").textContent = connected ? "OBS connected" : (error ? "OBS connection error" : "OBS disconnected");
}
function wsConnect() {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  state.ws = new WebSocket(scheme + "//" + location.host + "/ws?role=control");
  state.ws.onopen = () => state.ws.send(JSON.stringify({ type: "obsStatusRequest" }));
  state.ws.onmessage = (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch (_) { return; }
    if (message.type === "obsStatus") setObsStatus(message.connected, message.error);
    if (message.type === "navigate") goTo(state.active + message.delta, true);
  };
  state.ws.onclose = () => { setObsStatus(false); setTimeout(wsConnect, 1600); };
}
function sendSlideState() {
  const slide = state.slides[state.active];
  if (!slide) return;
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ type: "slideState", slide: {
    title: slide.title, html: slide.html, background: slide.background, width: slide.width, height: slide.height, index: state.active, total: state.slides.length
  }}));
}
function commandsOf(slide) {
  return (slide && slide.notes ? slide.notes.split(/\r?\n/) : []).map((line) => line.trim()).filter((line) => line.startsWith("#"));
}
function validateCommand(line) {
  return /^#scene\s*:\s*.+$/i.test(line) || /^#source\.(show|hide)\s*:\s*.+$/i.test(line) || /^#layout\s*:\s*(portrait|landscape)$/i.test(line);
}
async function runCommands() {
  const slide = state.slides[state.active];
  const commands = commandsOf(slide);
  if (!commands.length) return toast("There are no OBS commands on this slide.");
  if (!state.obsConnected) return toast("Connect to OBS before running slide commands.");
  try {
    const response = await fetch("/api/obs/commands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commands, layouts: currentLayoutSources() }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "OBS command failed");
    $("action-result").textContent = result.results.join(" · ") || "Commands completed.";
    $("action-result").style.color = "#66dfb0";
    toast("Slide actions sent to OBS");
  } catch (error) {
    $("action-result").textContent = error.message;
    $("action-result").style.color = "#ff9a9a";
    toast(error.message);
  }
}
function goTo(index, run) {
  if (!state.slides.length) return;
  const target = Math.max(0, Math.min(state.slides.length - 1, index));
  if (target === state.active && index === state.active) return;
  state.active = target;
  renderWorkspace();
  sendSlideState();
  if (run) runCommands();
}
function buildSlideList() {
  const list = $("slide-list");
  if (!state.slides.length) {
    list.innerHTML = '<div class="empty-slides"><span>＋</span><strong>Import a PowerPoint</strong><small>Your slide notes will be read for OBS commands.</small></div>';
    return;
  }
  list.innerHTML = state.slides.map((slide, index) => {
    const commands = commandsOf(slide);
    const preview = slide.previewText ? escapeHtml(slide.previewText.slice(0, 42)) : "Slide " + (index + 1);
    return '<div class="slide-row ' + (index === state.active ? "active" : "") + '" data-index="' + index + '">' +
      '<div class="slide-thumb">' + (slide.firstImage ? '<img src="' + slide.firstImage + '">' : preview) + '</div>' +
      '<div class="slide-row-info"><strong>Slide ' + (index + 1) + (slide.title ? " · " + escapeHtml(slide.title.slice(0, 22)) : "") + '</strong>' +
      '<small>' + (slide.notes ? "Notes added" : "No notes") + "</small>" +
      (commands.length ? '<div class="mini-action">' + commands.length + ' OBS ' + (commands.length === 1 ? "action" : "actions") + "</div>" : "") +
      "</div></div>";
  }).join("");
  list.querySelectorAll(".slide-row").forEach((row) => row.addEventListener("click", () => goTo(Number(row.dataset.index), true)));
}
function renderActions(slide) {
  const commands = commandsOf(slide);
  $("action-badge").textContent = String(commands.length);
  $("command-count").textContent = commands.length ? commands.length + " OBS " + (commands.length === 1 ? "action" : "actions") : "No OBS actions";
  $("actions-list").innerHTML = commands.length ? commands.map((line) => '<div class="action-chip ' + (validateCommand(line) ? "valid" : "invalid") + '">' + escapeHtml(line) + "</div>").join("") : '<div class="no-actions">No # commands on this slide.</div>';
  $("test-slide-actions").disabled = !commands.length;
  $("run-actions").disabled = !commands.length;
}
function renderWorkspace() {
  buildSlideList();
  const slide = state.slides[state.active];
  const has = !!slide;
  $("stage-empty").classList.toggle("hidden", has);
  $("slide-design").classList.toggle("active", has);
  $("previous-button").disabled = !has || state.active === 0;
  $("next-button").disabled = !has || state.active >= state.slides.length - 1;
  $("present-button").disabled = !has;
  $("test-slide-actions").disabled = !has || !commandsOf(slide).length;
  $("run-actions").disabled = !has || !commandsOf(slide).length;
  $("slide-position").textContent = has ? (state.active + 1) + " / " + state.slides.length : "0 / 0";
  $("slide-count").textContent = state.slides.length ? state.slides.length + (state.slides.length === 1 ? " slide" : " slides") : "No slides yet";
  $("slide-count-small").textContent = String(state.slides.length);
  $("active-slide-label").textContent = has ? "Slide " + (state.active + 1) + (slide.title ? " · " + slide.title : "") : "No slide selected";
  if (has) {
    const design = $("slide-design");
    design.innerHTML = slide.html;
    design.style.background = slide.background;
    $("stage-frame").style.aspectRatio = slide.width + " / " + slide.height;
    $("stage-ratio").textContent = slide.width > slide.height ? "LANDSCAPE" : "PORTRAIT";
    $("notes-editor").value = slide.notes || "";
    $("slide-layout").value = slide.layout || "auto";
    $("slide-layout").disabled = false;
    $("save-notes").disabled = !state.notesKey;
    $("notes-save-status").textContent = slide.notesEdited ? (slide.notesSaved ? "Saved in this browser" : "Unsaved changes") : "From PowerPoint";
    renderActions(slide);
    const next = state.slides[state.active + 1];
    $("next-label").textContent = next ? "Slide " + (state.active + 2) : "—";
    $("next-preview").innerHTML = next ? '<div class="slide-design active" style="aspect-ratio:' + next.width + '/' + next.height + ';background:' + next.background + '">' + next.html + "</div>" : '<div class="next-placeholder">No next slide</div>';
  } else {
    $("stage-frame").style.aspectRatio = "16 / 9";
    $("stage-ratio").textContent = "16:9";
    $("notes-editor").value = "";
    $("slide-layout").value = "auto";
    $("slide-layout").disabled = true;
    $("save-notes").disabled = true;
    $("notes-save-status").textContent = "No edits yet";
    $("next-preview").innerHTML = '<div class="next-placeholder">No next slide</div>';
    $("next-label").textContent = "—";
    renderActions(null);
  }
}
function parseXml(text) {
  return new DOMParser().parseFromString(text, "application/xml");
}
function elements(node, ns, name) {
  return Array.from(node.getElementsByTagNameNS(ns, name));
}
function child(node, ns, name) {
  return Array.from(node.childNodes || []).find((item) => item.nodeType === 1 && item.namespaceURI === ns && item.localName === name) || null;
}
function normalizeZipPath(path) {
  const parts = [];
  String(path).split("/").forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") parts.pop(); else parts.push(part);
  });
  return parts.join("/");
}
function relationshipMap(xml) {
  const doc = parseXml(xml);
  const map = {};
  elements(doc, "http://schemas.openxmlformats.org/package/2006/relationships", "Relationship").forEach((rel) => {
    map[rel.getAttribute("Id")] = rel.getAttribute("Target");
  });
  return map;
}
function firstColor(node) {
  if (!node) return null;
  const direct = elements(node, "http://schemas.openxmlformats.org/drawingml/2006/main", "srgbClr")[0];
  if (direct) return "#" + direct.getAttribute("val");
  const scheme = elements(node, "http://schemas.openxmlformats.org/drawingml/2006/main", "schemeClr")[0];
  const schemeMap = { lt1: "#ffffff", dk1: "#000000", lt2: "#e7e6e6", dk2: "#44546a", accent1: "#4472c4", accent2: "#ed7d31", accent3: "#a5a5a5", accent4: "#ffc000", accent5: "#5b9bd5", accent6: "#70ad47" };
  return scheme ? schemeMap[scheme.getAttribute("val")] || null : null;
}
async function dataUriFor(zip, filePath) {
  const file = zip.file(filePath);
  if (!file) return "";
  const ext = pathExtension(filePath);
  const mime = ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp" })[ext] || "application/octet-stream";
  const base64 = await file.async("base64");
  return "data:" + mime + ";base64," + base64;
}
function pathExtension(value) {
  return String(value).split(".").pop().toLowerCase();
}
function shapeTransform(shape) {
  const ns = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const xfrm = elements(shape, ns, "xfrm")[0];
  if (!xfrm) return null;
  const off = child(xfrm, ns, "off");
  const ext = child(xfrm, ns, "ext");
  if (!off || !ext) return null;
  return { x: Number(off.getAttribute("x")) || 0, y: Number(off.getAttribute("y")) || 0, w: Number(ext.getAttribute("cx")) || 0, h: Number(ext.getAttribute("cy")) || 0 };
}
function styleShape(shape, transform, width, height, fill, fontColor, fontSize, align) {
  const x = transform.x / width * 100, y = transform.y / height * 100, w = transform.w / width * 100, h = transform.h / height * 100;
  const fs = fontSize ? (fontSize / 100 * 96 / 72 / (width / 9525) * 100) : 1.35;
  return "left:" + x + "%;top:" + y + "%;width:" + w + "%;height:" + h + "%;" +
    (fill ? "background:" + fill + ";" : "") +
    (fontColor ? "color:" + fontColor + ";" : "color:#111;") +
    "font-size:" + fs + "cqw;text-align:" + (align || "left") + ";";
}
async function renderSlide(zip, slidePath, width, height, slideRelationships) {
  const xml = await zip.file(slidePath).async("text");
  const doc = parseXml(xml);
  const pNs = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const aNs = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const relNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const bgNode = elements(doc, pNs, "bg")[0];
  const bgColor = firstColor(bgNode) || "#ffffff";
  const spTree = elements(doc, pNs, "spTree")[0];
  const nodes = spTree ? Array.from(spTree.children) : [];
  const markup = [];
  let previewText = "";
  let firstImage = "";
  for (const shape of nodes) {
    if (!shape.namespaceURI || shape.localName === "nvGrpSpPr" || shape.localName === "grpSpPr") continue;
    const transform = shapeTransform(shape);
    if (!transform || !transform.w || !transform.h) continue;
    const spPr = child(shape, pNs, "spPr");
    const fill = firstColor(spPr && elements(spPr, aNs, "solidFill")[0]);
    if (shape.localName === "pic") {
      const blip = elements(shape, aNs, "blip")[0];
      const relId = blip && blip.getAttributeNS(relNs, "embed");
      const target = relId && slideRelationships[relId];
      const mediaPath = target ? normalizeZipPath("ppt/slides/" + target) : "";
      const src = mediaPath ? await dataUriFor(zip, mediaPath) : "";
      if (src) {
        if (!firstImage) firstImage = src;
        markup.push('<div class="shape" style="' + styleShape(shape, transform, width, height, null, null, 0, "left") + '"><img src="' + src + '"></div>');
      }
      continue;
    }
    if (shape.localName !== "sp") continue;
    const textBody = child(shape, pNs, "txBody");
    if (!textBody) {
      if (fill) markup.push('<div class="shape" style="' + styleShape(shape, transform, width, height, fill, null, 0, "left") + '"></div>');
      continue;
    }
    const paras = elements(textBody, aNs, "p");
    const lines = paras.map((para) => elements(para, aNs, "t").map((t) => t.textContent || "").join(""));
    const text = lines.join("\n").trim();
    if (!text) continue;
    if (!previewText) previewText = text.replace(/\s+/g, " ");
    const runProps = elements(textBody, aNs, "rPr")[0] || elements(textBody, aNs, "defRPr")[0];
    const textColor = firstColor(runProps && elements(runProps, aNs, "solidFill")[0]);
    const fontSize = runProps ? Number(runProps.getAttribute("sz")) : 0;
    const pPr = elements(textBody, aNs, "pPr")[0];
    const alignCode = pPr && pPr.getAttribute("algn");
    const align = ({ ctr: "center", r: "right", just: "justify" })[alignCode] || "left";
    markup.push('<div class="shape" style="' + styleShape(shape, transform, width, height, fill, textColor, fontSize, align) + '">' + escapeHtml(text) + "</div>");
  }
  return { html: markup.join(""), background: bgColor, previewText, firstImage };
}
function noteText(xml) {
  const doc = parseXml(xml);
  const pNs = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const aNs = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const result = [];
  elements(doc, pNs, "sp").forEach((shape) => {
    const ph = elements(shape, pNs, "ph")[0];
    if (ph && ["sldNum", "dt", "hdr", "ftr"].includes(ph.getAttribute("type"))) return;
    const text = elements(shape, aNs, "t").map((item) => item.textContent || "").join("");
    if (text.trim()) result.push(text.trim());
  });
  return result.join("\n");
}
async function importPowerPoint(file) {
  if (!window.JSZip) throw new Error("PowerPoint reader did not load. Check your internet connection and try again.");
  const zip = await JSZip.loadAsync(file);
  const presentation = parseXml(await zip.file("ppt/presentation.xml").async("text"));
  const rels = relationshipMap(await zip.file("ppt/_rels/presentation.xml.rels").async("text"));
  const size = elements(presentation, "http://schemas.openxmlformats.org/presentationml/2006/main", "sldSz")[0];
  const width = Number(size && size.getAttribute("cx")) || 12192000;
  const height = Number(size && size.getAttribute("cy")) || 6858000;
  const slideIds = elements(presentation, "http://schemas.openxmlformats.org/presentationml/2006/main", "sldId");
  const slidePaths = slideIds.map((item) => normalizeZipPath("ppt/" + rels[item.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id")])).filter((p) => zip.file(p));
  const noteMap = {};
  const noteFiles = Object.keys(zip.files).filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name));
  for (const notePath of noteFiles) {
    const relPath = notePath.replace("notesSlides/", "notesSlides/_rels/") + ".rels";
    const relFile = zip.file(relPath);
    if (!relFile) continue;
    const noteRels = relationshipMap(await relFile.async("text"));
    const slideTarget = Object.entries(noteRels).find((entry) => /\/slide$/.test(entry[1]));
    if (!slideTarget) continue;
    const targetPath = normalizeZipPath("ppt/notesSlides/" + slideTarget[1]);
    noteMap[targetPath] = noteText(await zip.file(notePath).async("text"));
  }
  state.slides = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const slidePath = slidePaths[i];
    const relFile = zip.file(slidePath.replace("slides/", "slides/_rels/") + ".rels");
    const slideRels = relFile ? relationshipMap(await relFile.async("text")) : {};
    const rendered = await renderSlide(zip, slidePath, width, height, slideRels);
    const notes = noteMap[slidePath] || "";
    const title = (rendered.previewText || "").split(/\s+/).slice(0, 5).join(" ");
    state.slides.push({ title, html: rendered.html, background: rendered.background, width, height, notes, previewText: rendered.previewText, firstImage: rendered.firstImage });
  }
  state.notesKey = notesStorageKey(file);
  try {
    const saved = JSON.parse(localStorage.getItem(state.notesKey) || "null");
    if (Array.isArray(saved)) saved.forEach((item, index) => {
      if (state.slides[index]) {
        state.slides[index].notes = item.notes || "";
        state.slides[index].layout = item.layout || layoutFromNotes(item.notes);
        state.slides[index].notesEdited = true;
        state.slides[index].notesSaved = true;
      }
    });
  } catch (_) {}
  state.slides.forEach((slide) => { if (!slide.layout) slide.layout = layoutFromNotes(slide.notes); });
  state.active = 0;
  $("deck-title").textContent = file.name.replace(/\.pptx$/i, "");
  renderWorkspace();
  sendSlideState();
  toast("Imported " + state.slides.length + " slides");
}
function openOutput() {
  const url = location.origin + "/output";
  state.outputWindow = window.open(url, "presentationOutput");
  if (!state.outputWindow) toast("Allow pop-ups to open the presentation output.");
  setTimeout(sendSlideState, 400);
  runCommands();
}
async function connectObs() {
  const address = $("obs-address").value.trim() || "ws://127.0.0.1:4455";
  const password = $("obs-password").value;
  $("connection-message").textContent = "Connecting…";
  $("connection-message").className = "connection-message";
  try {
    const response = await fetch("/api/obs/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address, password }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not connect");
    $("connection-message").textContent = "Connected to OBS.";
    $("connection-message").classList.add("ok");
    setObsStatus(true);
  } catch (error) {
    $("connection-message").textContent = error.message;
    $("connection-message").classList.remove("ok");
    setObsStatus(false, true);
  }
}
async function disconnectObs() {
  try { await fetch("/api/obs/disconnect", { method: "POST" }); } catch (_) {}
  $("connection-message").textContent = "Disconnected.";
  $("connection-message").className = "connection-message";
  setObsStatus(false);
}
function showTab(name) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
  $("tab-slide").classList.toggle("hidden", name !== "slide");
  $("tab-actions").classList.toggle("hidden", name !== "actions");
}
function renameShow() {
  const name = prompt("Name this show", $("deck-title").textContent);
  if (name && name.trim()) $("deck-title").textContent = name.trim();
}
function clearShow() {
  if (state.slides.length && !confirm("Start a new show? The current imported deck will be cleared.")) return;
  state.slides = [];
  state.active = 0;
  $("deck-title").textContent = "Untitled show";
  renderWorkspace();
}


function notesStorageKey(file) {
  return "presentation.notes.v1:" + file.name + ":" + file.size + ":" + file.lastModified;
}
function currentLayoutSources() {
  return {
    portrait: $("portrait-source") ? $("portrait-source").value.trim() : "",
    landscape: $("landscape-source") ? $("landscape-source").value.trim() : ""
  };
}
function saveLayoutSources() {
  try { localStorage.setItem("presentation.layout-sources.v1", JSON.stringify(currentLayoutSources())); } catch (_) {}
}
function loadLayoutSources() {
  try {
    const saved = JSON.parse(localStorage.getItem("presentation.layout-sources.v1") || "{}");
    $("portrait-source").value = saved.portrait || "";
    $("landscape-source").value = saved.landscape || "";
  } catch (_) {}
}
function layoutFromNotes(notes) {
  const match = String(notes || "").match(/^#layout\s*:\s*(portrait|landscape)\s*$/im);
  return match ? match[1].toLowerCase() : "auto";
}
function saveNotesToBrowser() {
  if (!state.notesKey) return;
  try {
    localStorage.setItem(state.notesKey, JSON.stringify(state.slides.map((slide) => ({ notes: slide.notes || "", layout: slide.layout || "auto" }))));
    state.slides.forEach((slide) => { slide.notesSaved = true; slide.notesEdited = false; });
    $("notes-save-status").textContent = "Saved in this browser";
    toast("Speaker notes saved");
  } catch (_) {
    $("notes-save-status").textContent = "Could not save notes";
    toast("Browser storage is full");
  }
}
function setSlideLayout(layout) {
  const slide = state.slides[state.active];
  if (!slide) return;
  const lines = String(slide.notes || "").split(/\r?\n/).filter((line) => !/^\s*#layout\s*:/i.test(line));
  if (layout !== "auto") lines.push("#layout: " + layout);
  slide.notes = lines.join("\n").replace(/^\n+|\n+$/g, "");
  slide.layout = layout;
  slide.notesEdited = true;
  slide.notesSaved = false;
  $("notes-editor").value = slide.notes;
  $("notes-save-status").textContent = "Unsaved changes";
  $("save-notes").disabled = false;
  renderActions(slide);
}


function setup() {
  loadLayoutSources();
  wsConnect();
  $("open-settings").addEventListener("click", () => $("settings-modal").classList.remove("hidden"));
  $("close-settings").addEventListener("click", () => $("settings-modal").classList.add("hidden"));
  $("settings-modal").addEventListener("click", (event) => { if (event.target === $("settings-modal")) $("settings-modal").classList.add("hidden"); });
  $("connect-obs").addEventListener("click", connectObs);
  $("disconnect-obs").addEventListener("click", disconnectObs);
  $("portrait-source").addEventListener("input", saveLayoutSources);
  $("landscape-source").addEventListener("input", saveLayoutSources);
  $("slide-layout").addEventListener("change", (event) => setSlideLayout(event.target.value));
  $("notes-editor").addEventListener("input", (event) => {
    const slide = state.slides[state.active];
    if (!slide) return;
    slide.notes = event.target.value;
    slide.layout = layoutFromNotes(slide.notes);
    slide.notesEdited = true;
    slide.notesSaved = false;
    $("slide-layout").value = slide.layout;
    $("notes-save-status").textContent = "Unsaved changes";
    $("save-notes").disabled = false;
    renderActions(slide);
  });
  $("save-notes").addEventListener("click", saveNotesToBrowser);
  $("previous-button").addEventListener("click", () => goTo(state.active - 1, true));
  $("next-button").addEventListener("click", () => goTo(state.active + 1, true));
  $("present-button").addEventListener("click", openOutput);
  $("test-slide-actions").addEventListener("click", runCommands);
  $("run-actions").addEventListener("click", runCommands);
  $("new-show").addEventListener("click", clearShow);
  $("rename-show").addEventListener("click", renameShow);
  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => showTab(tab.dataset.tab)));
  $("copy-output").addEventListener("click", async () => {
    const url = location.origin + "/output";
    try { await navigator.clipboard.writeText(url); toast("OBS source URL copied"); }
    catch (_) { toast("OBS source URL: " + url); }
  });
  const fileInput = $("pptx-file");
  const emptyInput = $("empty-file");
  const handleFile = async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try { toast("Reading PowerPoint…"); await importPowerPoint(file); }
    catch (error) { alert("Could not import this PowerPoint: " + error.message); }
    event.target.value = "";
  };
  fileInput.addEventListener("change", handleFile);
  emptyInput.addEventListener("change", handleFile);
  document.addEventListener("keydown", (event) => {
    if (event.target && ["INPUT", "TEXTAREA"].includes(event.target.tagName)) return;
    if (event.key === "ArrowRight") { event.preventDefault(); goTo(state.active + 1, true); }
    if (event.key === "ArrowLeft") { event.preventDefault(); goTo(state.active - 1, true); }
    if (event.code === "Space") { event.preventDefault(); openOutput(); }
  });
}

function setupOutput() {
  $("app").classList.add("output-only");
  $("output-mode").classList.remove("hidden");
  $("output-mode").classList.add("active");
  $("output-mode").querySelector(".output-empty").classList.add("visible");
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(scheme + "//" + location.host + "/ws?role=output");
  socket.onmessage = (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch (_) { return; }
    if (message.type !== "slideState" || !message.slide) return;
    const slide = message.slide;
    const container = $("output-slide");
    const aspect = Number(slide.width) / Number(slide.height);
    container.classList.toggle("portrait", aspect < 1);
    container.innerHTML = '<div class="slide-design active" style="aspect-ratio:' + slide.width + '/' + slide.height + ';background:' + slide.background + '">' + slide.html + "</div>";
    $("output-mode").querySelector(".output-empty").classList.remove("visible");
  };
}

if (new URLSearchParams(location.search).get("output") === "1" || location.pathname === "/output") setupOutput();
else setup();
