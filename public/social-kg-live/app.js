/*
 * FinProof Social Context KG — Live viewer.
 * A standalone service page (served from /social-kg-live/) that renders the REAL
 * social-context knowledge graph from FinProof's API and, when an analysis runs on
 * a real review case, zooms/highlights the exact nodes & edges the social-context
 * sub-agent references — driven by the live `social_context_kg:*` trace events.
 */
const ROLE_HEADERS = { "x-finproof-role": "reviewer", "x-finproof-tenant-id": "tenant-demo" };
const PHASE_MS = 1050; // min time each activation phase stays on screen so it is legible

const PHASES = {
  country: { label: "분석 대상 국가 범위 확정", color: "#60a5fa" },
  date: { label: "게시 예정일 ↔ 민감 기념일 대조", color: "#f59e0b" },
  term: { label: "민감 표현·용어 탐지", color: "#22d3ee" },
  symbol: { label: "시각 상징 탐지", color: "#a78bfa" },
  financial: { label: "금융 홍보 표현 탐지", color: "#34d399" },
  campaign: { label: "캠페인 의도 추론", color: "#94a3b8" },
  slang: { label: "위험 은어 탐지", color: "#ef4444" },
  safe_context: { label: "안전 문맥 확인", color: "#10b981" },
  event: { label: "민감 사건 노드 활성화", color: "#f472b6" },
  stakeholder: { label: "영향 이해관계자 추적", color: "#fb7185" },
  rule: { label: "사회맥락 리스크 규칙 판정", color: "#f43f5e" },
  done: { label: "사회맥락 그래프 탐색 완료", color: "#a78bfa" }
};

const typeColors = { Country: "#60a5fa", SensitiveEvent: "#f472b6", SensitiveTerm: "#22d3ee", SensitiveSymbol: "#a78bfa", FinancialPromoTerm: "#34d399", Date: "#f59e0b", Stakeholder: "#fb7185", Region: "#fbbf24", TargetGroup: "#f97316", Concept: "#94a3b8" };
const relationColors = { associatedTerm: "#22d3ee", associatedSymbol: "#a78bfa", affectsStakeholder: "#fb7185", hasSensitiveDate: "#f59e0b", hasDate: "#f59e0b", termOfEvent: "#38bdf8", symbolOfEvent: "#c084fc", isFinancialPromoTermFor: "#34d399", occurredInOrAssociatedRegion: "#fbbf24", evokesEvent: "#f472b6", targetsGroup: "#fb7185", visuallyEvokesEvent: "#8b5cf6", hasDerogatoryRiskTerm: "#ef4444" };
const countryLabels = { cambodia: "Cambodia", vietnam: "Vietnam", myanmar: "Myanmar", china: "China", thailand: "Thailand", south_korea: "South Korea", global: "Global" };
const riskLabels = { high: "High", caution: "Caution", info: "Info", none: "None" };
const typeOrder = ["Country", "SensitiveEvent", "SensitiveTerm", "SensitiveSymbol", "FinancialPromoTerm", "Date", "Stakeholder", "Region", "TargetGroup", "Concept"];
const countryOrder = ["south_korea", "cambodia", "vietnam", "myanmar", "china", "thailand", "global"];
const riskOrder = ["high", "caution", "info", "none"];

const canvas = document.getElementById("graph");
const ctx = canvas.getContext("2d");
const tooltip = document.getElementById("tooltip");
const caseSelect = document.getElementById("caseSelect");
const analyzeBtn = document.getElementById("analyzeBtn");
const replayBtn = document.getElementById("replayBtn");
const liveChip = document.getElementById("liveChip");
const liveChipText = document.getElementById("liveChipText");
const liveSteps = document.getElementById("liveSteps");

let DATA = null;
let nodeById = new Map();
let visibleSet = new Set();
const state = { width: 1, height: 1, dpr: 1, zoom: 1, offsetX: 0, offsetY: 0, selected: null, hovered: null, dragNode: null, dragCanvas: false, lastX: 0, lastY: 0, alpha: 1, paused: false, search: "", types: new Set(), countries: new Set(), risks: new Set(["high", "caution", "info", "none"]), cam: null, forceVisible: new Set(), live: { on: false, ref: new Set(), spot: new Set(), edges: new Set(), phaseColor: "#64748b", risk: null } };

// live-run bookkeeping
let pollTimer = null;
let paceTimer = null;
let lastSeq = null;
let pollStatus = null;
let queue = [];
let pumping = false;
let lastRun = [];
const stepEls = new Map();

// auto-follow: viewer tails whichever case is being analyzed (no manual pick needed)
const ACTIVE_STATUSES = new Set(["parsing", "analysis_queued", "analysis_in_progress"]);
const WATCH_MS = 2500;
let followedId = null;
let watchStarted = false;
const statusMap = new Map();

function api(method, path) {
  return fetch(path, { method, headers: ROLE_HEADERS, cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`);
    return r.status === 204 ? null : r.json();
  });
}

function hexToRgb(hex) { let h = hex.replace("#", ""); if (h.length === 3) h = h.split("").map((c) => c + c).join(""); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mix(hex, target, t) { const a = hexToRgb(hex); const b = hexToRgb(target); return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`; }
function hashCode(value) { let hash = 0; for (let i = 0; i < value.length; i += 1) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0; return Math.abs(hash); }
function labelFor(node) { return node.labelKo || node.labelLocal || node.labelEn || node.id; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
function searchableText(node) { return [node.id, node.labelKo, node.labelLocal, node.labelEn, node.type, node.countryId, node.sensitivityLevel, ...(node.aliases || []), ...(node.sourceRefs || [])].join(" ").toLowerCase(); }
function resize() { const rect = canvas.getBoundingClientRect(); state.dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1)); state.width = Math.max(1, rect.width); state.height = Math.max(1, rect.height); canvas.width = Math.round(state.width * state.dpr); canvas.height = Math.round(state.height * state.dpr); ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0); }
function worldToScreen(x, y) { return { x: x * state.zoom + state.offsetX, y: y * state.zoom + state.offsetY }; }
function screenToWorld(x, y) { return { x: (x - state.offsetX) / state.zoom, y: (y - state.offsetY) / state.zoom }; }

function initPositions() {
  // Obsidian-style: node size scales with connection count (degree), not just type.
  for (const node of DATA.nodes) { const deg = node.degree || 0; let r = 3 + Math.sqrt(deg) * 1.7; if (node.type === "Country") r = Math.max(r, 13); else if (node.type === "SensitiveEvent") r = Math.max(r, 8); node.radius = Math.min(r, 20); node.vx = 0; node.vy = 0; }
  const countries = countryOrder.filter((country) => DATA.nodes.some((node) => node.countryId === country));
  const ring = Math.max(270, Math.min(560, DATA.nodes.length * 1.35));
  const centers = new Map();
  countries.forEach((country, index) => { const angle = (Math.PI * 2 * index) / countries.length - Math.PI / 2; centers.set(country, { x: Math.cos(angle) * ring, y: Math.sin(angle) * ring * 0.78 }); });
  for (const node of DATA.nodes) { const center = centers.get(node.countryId) || { x: 0, y: 0 }; const seed = hashCode(node.id); const angle = (seed % 6283) / 1000; const spread = node.type === "Country" ? 0 : 55 + (seed % 145); node.x = center.x + Math.cos(angle) * spread; node.y = center.y + Math.sin(angle) * spread; }
  state.offsetX = state.width / 2; state.offsetY = state.height / 2;
}

function visibleNodeSet() {
  const q = state.search.trim().toLowerCase();
  const visible = new Set();
  for (const node of DATA.nodes) {
    if (state.forceVisible.has(node.id)) { visible.add(node.id); continue; }
    if (!state.types.has(node.type)) continue;
    if (!state.countries.has(node.countryId)) continue;
    if (!state.risks.has(node.sensitivityLevel || "none")) continue;
    if (q && !searchableText(node).includes(q)) continue;
    visible.add(node.id);
  }
  if (q) { for (const edge of DATA.edges) { if (visible.has(edge.from) || visible.has(edge.to)) { visible.add(edge.from); visible.add(edge.to); } } }
  return visible;
}
function visibleEdges() { return DATA.edges.filter((edge) => visibleSet.has(edge.from) && visibleSet.has(edge.to)); }
function updateFilters() { visibleSet = visibleNodeSet(); state.alpha = Math.max(state.alpha, 0.6); updateFocusSelect(); }

function step() {
  if (state.paused || state.alpha < 0.01) return;
  const nodes = DATA.nodes.filter((node) => visibleSet.has(node.id));
  const edges = visibleEdges();
  for (const node of nodes) { const countryIndex = Math.max(0, countryOrder.indexOf(node.countryId)); const angle = (Math.PI * 2 * countryIndex) / countryOrder.length - Math.PI / 2; const targetX = Math.cos(angle) * 360 + (Math.max(0, typeOrder.indexOf(node.type)) - 4) * 12; const targetY = Math.sin(angle) * 285 + ((hashCode(node.id) % 9) - 4) * 10; node.vx += (targetX - node.x) * 0.0009 * state.alpha; node.vy += (targetY - node.y) * 0.0009 * state.alpha; }
  for (const edge of edges) { const a = nodeById.get(edge.from); const b = nodeById.get(edge.to); if (!a || !b) continue; const dx = b.x - a.x; const dy = b.y - a.y; const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy)); const target = 82 + (1 - edge.weight) * 38 + (a.type === "Country" || b.type === "Country" ? 42 : 0); const force = (dist - target) * 0.0044 * state.alpha * Math.max(0.25, edge.weight); const fx = (dx / dist) * force; const fy = (dy / dist) * force; if (state.dragNode !== a) { a.vx += fx; a.vy += fy; } if (state.dragNode !== b) { b.vx -= fx; b.vy -= fy; } }
  for (let i = 0; i < nodes.length; i += 1) { const a = nodes[i]; for (let j = i + 1; j < nodes.length; j += 1) { const b = nodes[j]; const dx = b.x - a.x; const dy = b.y - a.y; const d2 = Math.max(20, dx * dx + dy * dy); if (d2 > 22000) continue; const dist = Math.sqrt(d2); const force = ((100 + a.radius + b.radius) / d2) * 1.65 * state.alpha; const fx = (dx / dist) * force; const fy = (dy / dist) * force; if (state.dragNode !== a) { a.vx -= fx; a.vy -= fy; } if (state.dragNode !== b) { b.vx += fx; b.vy += fy; } } }
  for (const node of nodes) { if (state.dragNode === node) continue; node.vx *= 0.86; node.vy *= 0.86; node.x += node.vx; node.y += node.vy; }
  state.alpha *= 0.992;
}

function applyCam() {
  const c = state.cam;
  if (!c) return;
  const k = Math.min(1, (performance.now() - c.t0) / c.dur);
  const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  state.zoom = c.fz + (c.tz - c.fz) * e; state.offsetX = c.fx + (c.tx - c.fx) * e; state.offsetY = c.fy + (c.ty - c.fy) * e;
  if (k >= 1) state.cam = null;
}
function tweenTo(z, ox, oy, dur) { state.cam = { fz: state.zoom, fx: state.offsetX, fy: state.offsetY, tz: z, tx: ox, ty: oy, t0: performance.now(), dur: Math.max(1, dur) }; }
function focusOn(ids, dur = 950) {
  const ns = ids.map((id) => nodeById.get(id)).filter((n) => n && visibleSet.has(n.id));
  if (!ns.length) return;
  const xs = ns.map((n) => n.x); const ys = ns.map((n) => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const gw = Math.max(140, maxX - minX); const gh = Math.max(140, maxY - minY);
  const z = Math.max(0.35, Math.min(1.5, Math.min((state.width - 300) / gw, (state.height - 220) / gh)));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  tweenTo(z, state.width / 2 - cx * z, state.height / 2 - cy * z, dur);
}

function draw() {
  applyCam();
  step();
  ctx.clearRect(0, 0, state.width, state.height);
  const edges = visibleEdges();
  const nodes = DATA.nodes.filter((node) => visibleSet.has(node.id));
  for (const edge of edges) drawEdge(edge);
  for (const node of nodes.sort((a, b) => a.radius - b.radius)) drawNode(node);
  for (const node of nodes) if (shouldLabel(node)) drawLabel(node);
  document.getElementById("visibleStats").textContent = `${nodes.length} visible nodes · ${edges.length} visible edges · zoom ${state.zoom.toFixed(2)}x`;
  requestAnimationFrame(draw);
}
function edgeLiveState(edge) {
  if (!state.live.on) return "normal";
  if (state.live.edges.has(`${edge.from}|${edge.to}`)) return "spot";
  if (state.live.ref.has(edge.from) && state.live.ref.has(edge.to)) return "ref";
  return "dim";
}
function drawEdge(edge) {
  const a = nodeById.get(edge.from); const b = nodeById.get(edge.to); if (!a || !b) return;
  const p1 = worldToScreen(a.x, a.y); const p2 = worldToScreen(b.x, b.y);
  const selectedActive = state.selected && (edge.from === state.selected.id || edge.to === state.selected.id);
  const live = edgeLiveState(edge);
  // Minimal: thin, calm grey lines by default; only the active subgraph brightens.
  let color = "rgba(148,163,184,1)"; let alpha = 0.13; let width = 0.7;
  if (live === "spot") { color = state.live.phaseColor; alpha = 0.85; width = 1.9; }
  else if (live === "ref") { color = "rgba(199,210,254,1)"; alpha = 0.32; width = 1; }
  else if (live === "dim") { alpha = 0.03; width = 0.6; }
  else if (selectedActive) { color = "rgba(103,232,249,1)"; alpha = 0.6; width = 1.3; }
  else if (state.live.on) { alpha = 0.05; }
  ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
  ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = width; ctx.stroke(); ctx.globalAlpha = 1;
}
function nodeLiveState(node) {
  if (!state.live.on) return "normal";
  if (state.live.spot.has(node.id)) return "spot";
  if (state.live.ref.has(node.id)) return "ref";
  return "dim";
}
function drawNode(node) {
  const p = worldToScreen(node.x, node.y); const color = typeColors[node.type] || "#94a3b8";
  const selected = state.selected?.id === node.id; const hovered = state.hovered?.id === node.id;
  const live = nodeLiveState(node);
  const r = Math.max(1.8, node.radius * state.zoom);

  let fill; let alpha = 1; let ring = null; let ringW = 0;
  if (live === "spot") {
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300);
    ctx.beginPath(); ctx.arc(p.x, p.y, r + 6 + pulse * 8, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.globalAlpha = 0.1 + pulse * 0.12; ctx.fill(); ctx.globalAlpha = 1;
    fill = color; ring = state.live.phaseColor; ringW = 2;
  } else if (live === "ref") {
    fill = color; alpha = 0.95; ring = "rgba(226,232,240,0.4)"; ringW = 1;
  } else if (live === "dim") {
    fill = mix(color, "#0a0d13", 0.68); alpha = 0.5;
  } else {
    // idle base — flat, muted (color pushed toward slate) so activation reads as a clear pop.
    fill = mix(color, "#4b5563", 0.42); alpha = node.virtual ? 0.62 : 0.92;
    if (selected) { ring = "#c4b5fd"; ringW = 2; }
    else if (hovered) { ring = "rgba(103,232,249,0.8)"; ringW = 1.5; }
    else if (node.sensitivityLevel === "high") { ring = "rgba(251,113,133,0.5)"; ringW = 1; }
  }

  if (selected || hovered) { ctx.beginPath(); ctx.arc(p.x, p.y, r + (selected ? 7 : 5), 0, Math.PI * 2); ctx.fillStyle = selected ? "rgba(139,92,246,0.16)" : "rgba(34,211,238,0.12)"; ctx.fill(); }
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.globalAlpha = alpha; ctx.fill(); ctx.globalAlpha = 1;
  if (ring) { ctx.strokeStyle = ring; ctx.lineWidth = ringW; ctx.stroke(); }
}
function shouldLabel(node) {
  if (state.live.on) return state.live.spot.has(node.id) || (state.live.ref.has(node.id) && state.zoom > 0.9) || node.type === "Country";
  return state.zoom > 0.68 && (node.type === "Country" || node.sensitivityLevel === "high" || node.degree > 8 || state.selected?.id === node.id || state.hovered?.id === node.id);
}
function drawLabel(node) {
  const p = worldToScreen(node.x, node.y); const text = labelFor(node);
  const spot = state.live.on && state.live.spot.has(node.id);
  ctx.font = node.type === "Country" ? "600 12px Inter, sans-serif" : "500 10.5px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(4,7,13,0.9)"; ctx.shadowBlur = 4;
  ctx.fillStyle = spot ? "#f8fafc" : node.type === "Country" ? "rgba(226,232,240,0.92)" : "rgba(180,190,205,0.8)";
  ctx.fillText(text, p.x, p.y + node.radius * state.zoom + 12);
  ctx.shadowBlur = 0; ctx.textAlign = "left";
}
function nodeAt(x, y) { if (!DATA) return null; const world = screenToWorld(x, y); let best = null; let bestD = Infinity; for (const node of DATA.nodes) { if (!visibleSet.has(node.id)) continue; const dx = node.x - world.x; const dy = node.y - world.y; const d = Math.sqrt(dx * dx + dy * dy); const hit = Math.max(10 / state.zoom, node.radius + 5); if (d < hit && d < bestD) { best = node; bestD = d; } } return best; }

function renderControls() {
  document.getElementById("metrics").innerHTML = [[DATA.stats.totalNodes, "nodes"], [DATA.stats.totalEdges, "edges"], [DATA.metadata.counts.sensitiveEvents, "events"], [DATA.stats.highRiskEvents, "high-risk"], [DATA.metadata.countries.length, "countries"]].map(([v, l]) => `<div class="metric"><b>${v}</b><span>${l}</span></div>`).join("");
  renderChecks("typeFilters", typeOrder.filter((x) => DATA.stats.typeCounts[x]), state.types, DATA.stats.typeCounts, typeColors, (value, checked) => { if (checked) state.types.add(value); else state.types.delete(value); updateFilters(); });
  renderChecks("countryFilters", countryOrder.filter((x) => DATA.stats.countryCounts[x]), state.countries, DATA.stats.countryCounts, {}, (value, checked) => { if (checked) state.countries.add(value); else state.countries.delete(value); updateFilters(); }, countryLabels);
  renderChecks("riskFilters", riskOrder, state.risks, DATA.stats.riskCounts, { high: "#fb7185", caution: "#fbbf24", info: "#34d399", none: "#94a3b8" }, (value, checked) => { if (checked) state.risks.add(value); else state.risks.delete(value); updateFilters(); }, riskLabels);
  document.getElementById("relationList").innerHTML = Object.entries(DATA.stats.relationCounts).sort((a, b) => b[1] - a[1]).map(([rel, count]) => `<div class="legend-row"><span class="legend-left"><span class="dot" style="color:${relationColors[rel] || "#94a3b8"};background:currentColor"></span>${escapeHtml(rel)}</span><span class="count">${count}</span></div>`).join("");
  document.getElementById("profile").innerHTML = [["Authored nodes", DATA.stats.authoredNodes], ["Inferred nodes", DATA.stats.inferredNodes], ["Risk rules", DATA.metadata.counts.riskRules], ["Safe contexts", DATA.metadata.counts.safeContexts]].map(([label, value]) => `<div class="mini-card"><b>${value}</b><span>${label}</span></div>`).join("");
  document.getElementById("principles").innerHTML = (DATA.metadata.operationPrinciples || []).map((x) => `<div class="edge-item">${escapeHtml(x)}</div>`).join("");
  document.getElementById("priorCases").innerHTML = (DATA.priorCases || []).slice(0, 10).map((x) => `<div class="edge-item"><b>${escapeHtml(x.title || x.id || "Prior case")}</b><br>${escapeHtml(x.lesson || "")}</div>`).join("");
  updateFocusSelect();
}
function renderChecks(id, values, active, counts, colors, onChange, labels = {}) { const root = document.getElementById(id); root.innerHTML = values.map((value) => `<label class="chip"><input type="checkbox" data-value="${escapeHtml(value)}" ${active.has(value) ? "checked" : ""}><span class="dot" style="color:${colors[value] || "#64748b"};background:currentColor"></span>${escapeHtml(labels[value] || value)} <span class="count">${counts[value] || 0}</span></label>`).join(""); root.querySelectorAll("input").forEach((input) => input.addEventListener("change", () => onChange(input.dataset.value, input.checked))); }
function updateFocusSelect() { const q = state.search.trim().toLowerCase(); const options = DATA.nodes.filter((node) => visibleSet.has(node.id)).filter((node) => !q || searchableText(node).includes(q)).sort((a, b) => b.degree - a.degree || labelFor(a).localeCompare(labelFor(b))).slice(0, 120); document.getElementById("focusSelect").innerHTML = options.map((node) => `<option value="${escapeHtml(node.id)}">${escapeHtml(labelFor(node))} · ${escapeHtml(node.type)} · ${escapeHtml(countryLabels[node.countryId] || node.countryId)}</option>`).join(""); }
function selectNode(node, center = false) { state.selected = node; renderInspector(node); state.alpha = 0.8; if (center) focusOn([node.id], 700); }
function renderInspector(node) { const root = document.getElementById("inspector"); if (!node) { root.className = "empty"; root.innerHTML = "노드를 클릭하면 온톨로지 엔티티, 민감도, 별칭, 연결 관계가 여기에 표시됩니다."; return; } root.className = "node-card"; const connected = DATA.edges.filter((edge) => edge.from === node.id || edge.to === node.id); const aliases = (node.aliases || []).slice(0, 10); const metaEntries = Object.entries(node.metadata || {}).slice(0, 6); root.innerHTML = `<h3 class="node-title">${escapeHtml(labelFor(node))}</h3><div class="node-sub">${escapeHtml(node.labelEn || node.labelLocal || node.id)}</div><div class="pillbar"><span class="pill">${escapeHtml(node.type)}</span><span class="pill">${escapeHtml(countryLabels[node.countryId] || node.countryId)}</span><span class="pill ${node.sensitivityLevel}">${escapeHtml(riskLabels[node.sensitivityLevel] || node.sensitivityLevel)}</span>${node.virtual ? '<span class="pill">inferred</span>' : ""}<span class="pill">degree ${node.degree}</span></div><dl class="kv"><div><dt>ID</dt><dd>${escapeHtml(node.id)}</dd></div>${aliases.length ? `<div><dt>Aliases</dt><dd>${aliases.map(escapeHtml).join(", ")}</dd></div>` : ""}${(node.sourceRefs || []).length ? `<div><dt>Sources</dt><dd>${node.sourceRefs.map(escapeHtml).join(", ")}</dd></div>` : ""}${metaEntries.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(Array.isArray(value) ? value.join(", ") : String(value))}</dd></div>`).join("")}</dl><div class="section" style="padding-bottom:0;border-bottom:0"><h2>Connected Paths</h2><div class="scroll-list">${connected.slice(0, 24).map((edge) => { const otherId = edge.from === node.id ? edge.to : edge.from; const other = nodeById.get(otherId); return `<div class="edge-item" data-node="${escapeHtml(otherId)}"><b>${escapeHtml(edge.relation)}</b><br>${escapeHtml(labelFor(node))} → ${escapeHtml(other ? labelFor(other) : otherId)} <span class="count">${Number(edge.weight).toFixed(2)}</span></div>`; }).join("") || '<div class="empty">연결 관계 없음</div>'}</div></div>`; root.querySelectorAll(".edge-item[data-node]").forEach((item) => item.addEventListener("click", () => { const next = nodeById.get(item.dataset.node); if (next) selectNode(next, true); })); }
function fitGraph() { const nodes = DATA.nodes.filter((node) => visibleSet.has(node.id)); if (!nodes.length) return; const xs = nodes.map((node) => node.x); const ys = nodes.map((node) => node.y); const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys); const graphW = Math.max(1, maxX - minX); const graphH = Math.max(1, maxY - minY); const z = Math.max(0.18, Math.min(1.7, Math.min((state.width - 80) / graphW, (state.height - 80) / graphH))); tweenTo(z, state.width / 2 - ((minX + maxX) / 2) * z, state.height / 2 - ((minY + maxY) / 2) * z, 700); }

/* ---------------- live analysis ---------------- */
function setChip(stateName, text) { liveChip.dataset.state = stateName; liveChipText.textContent = text; }
function resetLiveVisual() { state.live = { on: false, ref: new Set(), spot: new Set(), edges: new Set(), phaseColor: "#64748b", risk: null }; state.forceVisible = new Set(); stepEls.clear(); liveSteps.innerHTML = ""; }
function resetLive() { resetLiveVisual(); lastRun = []; }

function addStep(phase, cfg, meta) {
  for (const el of stepEls.values()) el.classList.remove("active");
  const el = document.createElement("div");
  el.className = "step active";
  el.style.setProperty("--stepc", cfg.color);
  el.innerHTML = `<b>${escapeHtml(cfg.label)}</b><div class="meta">${escapeHtml(meta)}</div>`;
  liveSteps.appendChild(el);
  liveSteps.scrollTop = liveSteps.scrollHeight;
  stepEls.set(phase + ":" + stepEls.size, el);
}
function nodeNames(ids) { return ids.map((id) => { const n = nodeById.get(id); return n ? labelFor(n) : id; }); }

function applyPhase(evt) {
  const cfg = PHASES[evt.phase] || { label: evt.phase, color: "#64748b" };
  state.live.on = true;
  state.live.phaseColor = cfg.color;

  if (evt.phase === "done") {
    state.live.spot = new Set();
    const refs = [...state.live.ref];
    if (refs.length) focusOn(refs, 1200);
    const risk = state.live.risk ? ` · 최종 리스크 ${state.live.risk.toUpperCase()}` : "";
    addStep("done", cfg, `참조 노드 ${refs.length}개 · 관련 엣지 ${state.live.edges.size}개${risk}`);
    setChip("done", cfg.label);
    return;
  }

  const ids = (evt.nodeIds || []).filter((id) => nodeById.has(id));
  ids.forEach((id) => { state.live.ref.add(id); state.forceVisible.add(id); });
  state.live.spot = new Set(ids);
  (evt.edges || []).forEach((e) => { state.live.edges.add(`${e.from}|${e.to}`); [e.from, e.to].forEach((id) => { if (nodeById.has(id)) { state.live.ref.add(id); state.forceVisible.add(id); } }); });
  if (evt.riskLevel) state.live.risk = evt.riskLevel;
  updateFilters();
  state.alpha = 0.9;

  const focusIds = ids.length ? ids : (evt.edges || []).flatMap((e) => [e.from, e.to]);
  if (focusIds.length) focusOn(focusIds, 950);

  const names = nodeNames(ids).slice(0, 6);
  let meta = names.length ? names.join(", ") : "해당 없음";
  if (names.length && ids.length > names.length) meta += ` 외 ${ids.length - names.length}개`;
  if (evt.phase === "rule" && evt.note) meta = `${evt.note}${evt.riskLevel ? ` (${evt.riskLevel})` : ""}`;
  addStep(evt.phase, cfg, meta);
  setChip("running", cfg.label);
}

function pump() {
  if (pumping) return;
  if (!queue.length) { maybeFinish(); return; }
  pumping = true;
  const ev = queue.shift();
  const payload = ev.payload || {};
  applyPhase({ phase: ev.event, nodeIds: payload.nodeIds, edges: payload.edges, riskLevel: payload.riskLevel, note: payload.note });
  paceTimer = setTimeout(() => { pumping = false; pump(); }, PHASE_MS);
}
function maybeFinish() {
  if (pollStatus === "running" || pollStatus === "queued" || pumping || queue.length) return;
  replayBtn.disabled = lastRun.length === 0;
  if (pollStatus === "failed") setChip("error", "분석이 실패했어요");
  else if (liveChip.dataset.state !== "done") setChip("done", lastRun.length ? "분석 완료 — 강조 유지" : "분석 완료 (사회맥락 없음)");
  // stop tailing this run; the watcher keeps looking for the next analysis
  followedId = null;
}

function reflectStage(ev) {
  // surface a couple of high-level stages in the chip without stealing focus from the graph.
  if (ev.stage === "pipeline" && ev.event === "start") setChip("running", "AI 분석 파이프라인 시작…");
  else if (ev.stage === "rag_retrieve" && ev.event === "done") setChip("running", "관련 규정·사례 검색 중…");
  else if (ev.stage === "cove" && ev.event === "start") setChip("running", "근거 교차 검증 중…");
}

async function pollEvents(id) {
  if (id !== followedId) return; // a newer analysis took over
  try {
    const q = lastSeq != null ? `?since=${lastSeq}` : "";
    const res = await api("GET", `/api/v1/review-cases/${encodeURIComponent(id)}/analysis/events${q}`);
    pollStatus = res.status || pollStatus;
    for (const ev of res.events || []) {
      lastSeq = lastSeq == null ? ev.seq : Math.max(lastSeq, ev.seq);
      if (ev.stage === "social_context_kg") { queue.push(ev); lastRun.push(ev); }
      else reflectStage(ev);
    }
    pump();
  } catch { /* transient network/poll error — retry next tick */ }
  if (id !== followedId) return;
  if (pollStatus === "running" || pollStatus === "queued" || queue.length || pumping) {
    pollTimer = setTimeout(() => pollEvents(id), 1200);
  } else {
    maybeFinish();
  }
}

// Attach the viewer to a case's analysis run and start following its trace events.
function followCase(id, title, force = false) {
  if (id === followedId && !force) return;
  clearTimeout(pollTimer); clearTimeout(paceTimer);
  followedId = id;
  queue = []; pumping = false; lastSeq = null; pollStatus = "running"; lastRun = [];
  resetLive();
  replayBtn.disabled = true;
  const label = title || id;
  setChip("running", `분석 따라가는 중 — ${label}`);
  if (caseSelect.querySelector(`option[value="${CSS.escape(id)}"]`)) caseSelect.value = id;
  pollEvents(id);
}

// Manual trigger (secondary): start analysis on the selected case; if it is already
// running/queued the server returns 409 and we simply attach to the existing run.
async function startAnalysis() {
  const id = caseSelect.value;
  if (!id) return;
  const title = caseSelect.selectedOptions[0]?.dataset.title || id;
  setChip("running", "AI 분석 시작 중…");
  try { await api("POST", `/api/v1/review-cases/${encodeURIComponent(id)}/analysis/start`); }
  catch (e) {
    if (String(e.message) !== "409") { setChip("error", `분석 시작 실패 (${e.message})`); return; }
    // already running — just follow it
  }
  followCase(id, title, true);
}

function replayRun() {
  if (!lastRun.length) return;
  clearTimeout(paceTimer);
  queue = [...lastRun]; pumping = false; pollStatus = "completed";
  resetLiveVisual();
  replayBtn.disabled = true;
  setChip("running", "재생 중…");
  pump();
}

// Poll the case list; when a case transitions into an active analysis state, auto-follow it.
async function watchActiveAnalysis() {
  try {
    const res = await api("GET", "/api/v1/review-cases?pageSize=50");
    const items = res.items || res.data || res.reviewCases || (Array.isArray(res) ? res : []);
    // keep the picker in sync (status badge)
    if (items.length) {
      const current = caseSelect.value;
      caseSelect.innerHTML = items.map((c) => `<option value="${escapeHtml(c.id)}" data-title="${escapeHtml(c.title || c.id)}">${escapeHtml(c.title || c.id)} · ${escapeHtml(c.status || "")}</option>`).join("");
      if (current) caseSelect.value = current;
      analyzeBtn.disabled = false;
    }
    // detect a case that just entered an active state (newly started analysis)
    let justStarted = null;
    let anyActive = null;
    for (const c of items) {
      const active = ACTIVE_STATUSES.has(c.status);
      if (active) { anyActive = anyActive || c; if (!ACTIVE_STATUSES.has(statusMap.get(c.id) || "")) justStarted = c; }
      statusMap.set(c.id, c.status);
    }
    const target = justStarted || (!ACTIVE_STATUSES.has(statusMap.get(followedId) || "") ? anyActive : null);
    if (target && (target.id !== followedId || justStarted)) {
      followCase(target.id, target.title, target.id === followedId);
    } else if (!followedId && !anyActive && liveChip.dataset.state === "idle") {
      setChip("idle", "분석 대기 중 — 심의 화면에서 AI 분석을 시작하세요");
    }
  } catch { /* transient — retry next tick */ }
  setTimeout(watchActiveAnalysis, WATCH_MS);
}

function startWatching() {
  if (watchStarted) return;
  watchStarted = true;
  setChip("idle", "분석 대기 중 — 심의 화면에서 AI 분석을 시작하세요");
  watchActiveAnalysis();
}

/* ---------------- events ---------------- */
document.getElementById("search").addEventListener("input", (event) => { state.search = event.target.value; updateFilters(); });
document.getElementById("focusBtn").addEventListener("click", () => { const node = nodeById.get(document.getElementById("focusSelect").value); if (node) selectNode(node, true); });
document.getElementById("resetBtn").addEventListener("click", () => { state.search = ""; document.getElementById("search").value = ""; state.types = new Set(Object.keys(DATA.stats.typeCounts)); state.countries = new Set(Object.keys(DATA.stats.countryCounts)); state.risks = new Set(["high", "caution", "info", "none"]); state.live.on = false; state.forceVisible = new Set(); visibleSet = visibleNodeSet(); renderControls(); renderInspector(null); fitGraph(); });
document.getElementById("pauseBtn").addEventListener("click", (event) => { state.paused = !state.paused; event.currentTarget.textContent = state.paused ? "Resume" : "Pause"; });
document.getElementById("fitBtn").addEventListener("click", fitGraph);
analyzeBtn.addEventListener("click", startAnalysis);
replayBtn.addEventListener("click", replayRun);
canvas.addEventListener("mousemove", (event) => { const rect = canvas.getBoundingClientRect(); const x = event.clientX - rect.left; const y = event.clientY - rect.top; if (state.dragNode) { const w = screenToWorld(x, y); state.dragNode.x = w.x; state.dragNode.y = w.y; state.dragNode.vx = 0; state.dragNode.vy = 0; state.alpha = 0.75; return; } if (state.dragCanvas) { state.offsetX += x - state.lastX; state.offsetY += y - state.lastY; state.lastX = x; state.lastY = y; return; } state.hovered = nodeAt(x, y); if (state.hovered) { tooltip.style.display = "block"; tooltip.style.left = `${event.clientX}px`; tooltip.style.top = `${event.clientY}px`; tooltip.innerHTML = `<b>${escapeHtml(labelFor(state.hovered))}</b><span>${escapeHtml(state.hovered.type)} · ${escapeHtml(countryLabels[state.hovered.countryId] || state.hovered.countryId)} · degree ${state.hovered.degree}</span>`; } else tooltip.style.display = "none"; });
canvas.addEventListener("mousedown", (event) => { const rect = canvas.getBoundingClientRect(); const x = event.clientX - rect.left; const y = event.clientY - rect.top; const node = nodeAt(x, y); canvas.classList.add("dragging"); state.cam = null; if (node) { state.dragNode = node; selectNode(node); } else { state.dragCanvas = true; state.lastX = x; state.lastY = y; } });
window.addEventListener("mouseup", () => { state.dragNode = null; state.dragCanvas = false; canvas.classList.remove("dragging"); });
canvas.addEventListener("click", (event) => { const rect = canvas.getBoundingClientRect(); const node = nodeAt(event.clientX - rect.left, event.clientY - rect.top); if (node) selectNode(node); });
canvas.addEventListener("wheel", (event) => { event.preventDefault(); state.cam = null; const rect = canvas.getBoundingClientRect(); const x = event.clientX - rect.left; const y = event.clientY - rect.top; const before = screenToWorld(x, y); state.zoom = Math.max(0.16, Math.min(4, state.zoom * Math.exp(-event.deltaY * 0.001))); state.offsetX = x - before.x * state.zoom; state.offsetY = y - before.y * state.zoom; }, { passive: false });
window.addEventListener("resize", () => { resize(); fitGraph(); });

async function boot() {
  resize();
  try {
    DATA = await api("GET", "/api/v1/social-context-kg/graph");
  } catch (e) {
    document.getElementById("visibleStats").textContent = `그래프 로드 실패 (${e.message})`;
    setChip("error", "그래프 로드 실패");
    return;
  }
  nodeById = new Map(DATA.nodes.map((node) => [node.id, node]));
  state.types = new Set(Object.keys(DATA.stats.typeCounts));
  state.countries = new Set(Object.keys(DATA.stats.countryCounts));
  initPositions();
  visibleSet = visibleNodeSet();
  renderControls();
  renderInspector(null);
  fitGraph();
  draw();
  startWatching();
}
boot();
