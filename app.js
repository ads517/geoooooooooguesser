"use strict";

const ROUNDS = 5;
const MAX_POINTS = 5000;
const MAX_PLAYERS = 8;
const COLORS = ["#0a84ff", "#ff9f0a", "#bf5af2", "#30d158", "#ff375f", "#64d2ff", "#ffd60a", "#ac8e68"];
const CODE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ";
const PEER_PREFIX = "geoooooooooguesser-v1-";
const MAP_STYLES = [
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
];

const $ = (s) => document.querySelector(s);
const config = window.GAME_CONFIG || {};
const REGIONS = window.GAME_REGIONS || [];
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

let gm = null;          // google.maps, once loaded
let pano, streetView, guessMap, bigMap;
let guessMarker = null;
let bigOverlays = [];
let game = null;        // the game being played on this device
let net = null;         // multiplayer connection, or null when playing solo
let timerId = null;

// ---------------------------------------------------------------- helpers

function load(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }
function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
const fmt = (n) => Math.round(n).toLocaleString("en-US");
function fmtKm(km) {
  if (km == null) return "no guess";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${fmt(km)} km`;
}
function distanceKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
// The usual world-map curve: 5,000 on the spot, about half at 1,000 km.
const pointsFor = (km) => Math.round(MAX_POINTS * Math.exp(-km / 1492.7));
function cleanName(s) {
  return String(s ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "").trim().slice(0, 18);
}
const myName = () => cleanName($("#nick").value) || "Traveller";
const currentTimer = () => +document.querySelector("input[name=timer]:checked").value;
const currentMove = () => document.querySelector("input[name=move]:checked").value === "1";
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v; else if (k === "style") n.style.cssText = v; else n.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) n.append(k);
  return n;
}
function setScreen(name) {
  document.body.dataset.screen = name;
  document.body.classList.remove("map-open");
  if (name === "play" && pano) gm.event.trigger(pano, "resize");
}
let toastTimer = null;
function toast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}
function countUp(node, to) {
  if (reduceMotion) { node.textContent = fmt(to); return; }
  const start = performance.now(), dur = 700;
  const step = (now) => {
    const k = Math.min(1, (now - start) / dur);
    node.textContent = fmt(to * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function showSetup(message) {
  if (message) $("#setupText").textContent = message;
  setScreen("setup");
}

// ---------------------------------------------------------------- Google Maps

function loadGoogleMaps() {
  if (!config.googleMapsApiKey) { showSetup(); return; }
  window.gm_authFailure = () => showSetup(
    "Google didn't accept the API key in config.js. Check that the key is right, that the Maps JavaScript API is turned on for it, and that it allows this website.");
  window.__gameMapsReady = onMapsReady;
  const s = document.createElement("script");
  s.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(config.googleMapsApiKey) +
    "&v=weekly&loading=async&callback=__gameMapsReady";
  s.async = true;
  s.onerror = () => showSetup("Couldn't load Google Maps. Check your internet connection and reload the page.");
  document.head.append(s);
  $("#loadingText").textContent = "Loading maps…";
  setScreen("loading");
}

function onMapsReady() {
  gm = google.maps;
  streetView = new gm.StreetViewService();
  pano = new gm.StreetViewPanorama($("#pano"), {
    visible: true,
    disableDefaultUI: true,
    addressControl: false,
    showRoadLabels: false,
    fullscreenControl: false,
    motionTracking: false,
    motionTrackingControl: false,
    enableCloseButton: false,
    linksControl: true,
    clickToGo: true,
  });
  guessMap = new gm.Map($("#guessmap"), {
    center: { lat: 20, lng: 0 }, zoom: 1, minZoom: 1,
    disableDefaultUI: true, clickableIcons: false, gestureHandling: "greedy",
    draggableCursor: "crosshair", keyboardShortcuts: false, styles: MAP_STYLES,
  });
  guessMap.addListener("click", (e) => placePin(e.latLng));
  bigMap = new gm.Map($("#bigmap"), {
    center: { lat: 20, lng: 0 }, zoom: 2, minZoom: 1,
    disableDefaultUI: true, clickableIcons: false, gestureHandling: "greedy", styles: MAP_STYLES,
  });
  setScreen("home");
}

const PIN_URL = (fill, dot) => "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44">` +
  `<path d="M17 1.5C8.4 1.5 1.5 8.3 1.5 16.7 1.5 28.3 17 42.5 17 42.5S32.5 28.3 32.5 16.7C32.5 8.3 25.6 1.5 17 1.5z" fill="${fill}" stroke="#fff" stroke-width="2"/>` +
  (dot ? `<circle cx="17" cy="16.5" r="5.5" fill="#fff"/>` : "") + `</svg>`);
function answerIcon(numbered) {
  return { url: PIN_URL("#ff3b30", !numbered), scaledSize: new gm.Size(34, 44), anchor: new gm.Point(17, 42), labelOrigin: new gm.Point(17, 17) };
}
function dotIcon(color, big) {
  return { path: gm.SymbolPath.CIRCLE, scale: big ? 11 : 8, fillColor: color, fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 3 };
}
function dashedLine(a, b, color) {
  return new gm.Polyline({
    path: [a, b], geodesic: true, strokeOpacity: 0, map: bigMap,
    icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.9, strokeColor: color, scale: 2.5 }, offset: "0", repeat: "12px" }],
  });
}
function clearBigMap() { for (const o of bigOverlays) o.setMap(null); bigOverlays = []; }
function fitBigMap(points, sheet) {
  requestAnimationFrame(() => {
    const bottom = (sheet?.offsetHeight || 0) + 40;
    if (points.length === 1) { bigMap.setCenter(points[0]); bigMap.setZoom(5); return; }
    const b = new gm.LatLngBounds();
    points.forEach((p) => b.extend(p));
    bigMap.fitBounds(b, { top: 90, bottom, left: 50, right: 50 });
  });
}

// ---------------------------------------------------------------- finding places

function randomPointNear([lat, lng, km]) {
  const r = km * Math.sqrt(Math.random()), t = Math.random() * 2 * Math.PI;
  const dLat = (r * Math.cos(t)) / 111.32;
  const dLng = (r * Math.sin(t)) / (111.32 * Math.max(0.1, Math.cos(lat * Math.PI / 180)));
  return { lat: Math.max(-84, Math.min(84, lat + dLat)), lng: ((lng + dLng + 540) % 360) - 180 };
}

async function findPlace(avoid) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const region = REGIONS[Math.floor(Math.random() * REGIONS.length)];
    const request = { location: randomPointNear(region), radius: 25000, preference: gm.StreetViewPreference.NEAREST };
    if (gm.StreetViewSource.GOOGLE) request.sources = [gm.StreetViewSource.GOOGLE, gm.StreetViewSource.OUTDOOR];
    else request.source = gm.StreetViewSource.OUTDOOR;
    try {
      const { data } = await streetView.getPanorama(request);
      if (!data?.location?.pano || !(data.links || []).length) continue; // skip dead ends with nowhere to walk
      const place = { pano: data.location.pano, lat: +data.location.latLng.lat().toFixed(6), lng: +data.location.latLng.lng().toFixed(6), heading: Math.floor(Math.random() * 360) };
      if (avoid.some((p) => distanceKm(p, place) < 300)) continue;
      return place;
    } catch { /* no Street View near that spot, try another */ }
  }
  throw new Error("Couldn't find Street View nearby");
}

// Promises for each round, found one after another so places don't repeat.
function planRounds(onFound) {
  const found = [], promises = [];
  let chain = Promise.resolve();
  for (let i = 0; i < ROUNDS; i++) {
    chain = chain.then(async () => { const p = await findPlace(found); found.push(p); onFound?.(found.length); return p; });
    promises.push(chain);
  }
  promises.forEach((p) => p.catch(() => {}));
  return promises;
}

// ---------------------------------------------------------------- game flow

function newGame({ rounds, pending, timer, move, multi, gameNo = 0 }) {
  game = { rounds: rounds || [], pending: pending || [], timer, move, multi, gameNo, round: 0, guesses: [], total: 0, pin: null };
  document.body.classList.toggle("no-timer", !timer);
  document.body.classList.toggle("multi", !!multi);
}

function startSolo() {
  saveSettings();
  newGame({ pending: planRounds(), timer: currentTimer(), move: currentMove(), multi: false });
  startRound();
}

async function startRound() {
  const g = game, i = g.round;
  if (!g.rounds[i]) {
    $("#loadingText").textContent = "Finding a place…";
    setScreen("loading");
    try { g.rounds[i] = await g.pending[i]; }
    catch { if (game === g) { toast("Couldn't reach Street View. Check your connection and try again."); goHome(); } return; }
    if (game !== g) return;
  }
  const place = g.rounds[i];
  g.pin = null;
  setScreen("play");
  pano.setOptions({ linksControl: g.move, clickToGo: g.move, keyboardShortcuts: g.move });
  pano.setPano(place.pano);
  pano.setPov({ heading: place.heading, pitch: 0 });
  pano.setZoom(0);
  if (guessMarker) guessMarker.setMap(null);
  guessMarker = null;
  guessMap.setCenter({ lat: 20, lng: 0 });
  guessMap.setZoom(1);
  const btn = $("#guessBtn");
  btn.disabled = true;
  btn.textContent = "Place a pin on the map";
  $("#hudRound").textContent = `${i + 1}/${ROUNDS}`;
  $("#hudScore").textContent = fmt(g.total);
  renderStandings();
  startTimer();
}

function placePin(latLng) {
  if (!game || document.body.dataset.screen !== "play") return;
  game.pin = { lat: +latLng.lat().toFixed(6), lng: +latLng.lng().toFixed(6) };
  if (!guessMarker) guessMarker = new gm.Marker({ map: guessMap, icon: dotIcon("#0a84ff"), clickable: false });
  guessMarker.setPosition(game.pin);
  const btn = $("#guessBtn");
  btn.disabled = false;
  btn.textContent = "Guess";
}

function startTimer() {
  stopTimer();
  if (!game.timer) return;
  const deadline = Date.now() + game.timer * 1000;
  const tick = () => {
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const t = $("#hudTime");
    t.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    t.classList.toggle("low", left <= 10);
    if (left <= 0) { stopTimer(); submitGuess(); }
  };
  tick();
  timerId = setInterval(tick, 250);
}
function stopTimer() { if (timerId) clearInterval(timerId); timerId = null; }

function submitGuess() {
  if (!game || game.guesses.length > game.round) return;
  stopTimer();
  const place = game.rounds[game.round];
  const guess = game.pin
    ? { pin: game.pin, km: distanceKm(game.pin, place) }
    : { pin: null, km: null };
  guess.points = guess.pin ? pointsFor(guess.km) : 0;
  game.guesses.push(guess);
  game.total += guess.points;
  if (game.multi) sendGuess(game.round, guess.pin);
  showResult();
}

function showResult() {
  setScreen("result");
  const g = game.guesses[game.round];
  const last = game.round === ROUNDS - 1;
  $("#resPoints").textContent = "0";
  countUp($("#resPoints"), g.points);
  $("#resMeter").style.width = "0";
  requestAnimationFrame(() => { $("#resMeter").style.width = `${(g.points / MAX_POINTS) * 100}%`; });
  $("#resDetail").textContent = g.pin ? `Your guess was ${fmtKm(g.km)} away.` : "Time ran out before you placed a pin.";
  const place = game.rounds[game.round];
  $("#resLink").href = `https://www.google.com/maps/@?api=1&map_action=pano&pano=${encodeURIComponent(place.pano)}`;
  $("#nextBtn").textContent = last ? "See Results" : "Next Round";
  drawResultMap(true);
  $("#nextBtn").focus({ preventScroll: true });
}

function drawResultMap(fit) {
  if (document.body.dataset.screen !== "result") return;
  clearBigMap();
  const place = game.rounds[game.round];
  const answer = { lat: place.lat, lng: place.lng };
  const g = game.guesses[game.round];
  const points = [answer];
  const items = [];
  if (g.pin) {
    bigOverlays.push(new gm.Marker({ map: bigMap, position: g.pin, icon: dotIcon(game.multi ? myColor() : "#0a84ff", true), zIndex: 3 }));
    bigOverlays.push(dashedLine(g.pin, answer, game.multi ? myColor() : "#0a84ff"));
    points.push(g.pin);
  }
  if (game.multi) {
    for (const p of otherPlayers()) {
      const x = p.g[game.round];
      if (!x) continue;
      if (x.length === 3) {
        const pin = { lat: x[0], lng: x[1] };
        bigOverlays.push(new gm.Marker({ map: bigMap, position: pin, icon: dotIcon(p.color), zIndex: 2,
          label: { text: p.nick.slice(0, 1).toUpperCase(), color: "#fff", fontSize: "10px", fontWeight: "700" } }));
        bigOverlays.push(dashedLine(pin, answer, p.color));
        points.push(pin);
        items.push(el("li", {}, el("span", { class: "dot", style: `background:${p.color}` }), `${p.nick}: ${fmtKm(distanceKm(pin, answer))}`));
      } else {
        items.push(el("li", {}, el("span", { class: "dot", style: `background:${p.color}` }), `${p.nick}: no guess`));
      }
    }
  }
  bigOverlays.push(new gm.Marker({ map: bigMap, position: answer, icon: answerIcon(false), zIndex: 4 }));
  $("#resOthers").replaceChildren(...items);
  if (fit) fitBigMap(points, $("#result"));
}

function nextRound() {
  if (!game) return;
  if (game.round < ROUNDS - 1) { game.round++; startRound(); }
  else showSummary();
}

const VERDICTS = [
  [22000, "Incredible. You could find your way home from anywhere."],
  [16000, "A seasoned traveller. Your passport must be full."],
  [10000, "A solid sense of direction, with a few detours."],
  [5000, "You found the right continents. Mostly."],
  [0, "Every explorer starts somewhere. Try another round."],
];

function showSummary() {
  stopTimer();
  setScreen("summary");
  countUp($("#sumPoints"), game.total);
  $("#sumVerdict").textContent = VERDICTS.find(([min]) => game.total >= min)[1];
  $("#sumRounds").replaceChildren(...game.guesses.map((g, i) => el("li", {},
    el("span", { class: "name" }, `Round ${i + 1}`),
    el("span", { class: "meta" }, `${fmtKm(g.km)} · ${fmt(g.points)}`))));
  clearBigMap();
  const points = [];
  game.rounds.forEach((place, i) => {
    const answer = { lat: place.lat, lng: place.lng };
    points.push(answer);
    bigOverlays.push(new gm.Marker({ map: bigMap, position: answer, icon: answerIcon(true), zIndex: 3,
      label: { text: String(i + 1), color: "#fff", fontSize: "12px", fontWeight: "700" } }));
    const g = game.guesses[i];
    if (g?.pin) {
      bigOverlays.push(new gm.Marker({ map: bigMap, position: g.pin, icon: dotIcon("#0a84ff"), zIndex: 2 }));
      bigOverlays.push(dashedLine(g.pin, answer, "#0a84ff"));
      points.push(g.pin);
    }
  });
  fitBigMap(points, $("#summary"));
  updateSummaryControls();
}

function updateSummaryControls() {
  if (document.body.dataset.screen !== "summary") return;
  const again = $("#againBtn"), note = $("#sumNote");
  note.textContent = "";
  if (!game.multi) { again.hidden = false; again.textContent = "Play Again"; return; }
  renderSummaryBoard();
  if (!net || net.closed) { again.hidden = true; note.textContent = "The host has left, so this game is over."; return; }
  if (net.role === "host") { again.hidden = false; again.textContent = "New Game for Everyone"; return; }
  const next = net.state?.game;
  if (next && next.gameNo > game.gameNo) { again.hidden = false; again.textContent = "Join Next Game"; }
  else { again.hidden = true; note.textContent = "Waiting for the host to start another game…"; }
}

function goHome() {
  stopTimer();
  leaveNetwork();
  game = null;
  document.body.classList.remove("multi");
  setScreen("home");
}

// ---------------------------------------------------------------- multiplayer (PeerJS)

const meId = () => net?.peer?.id;
function playersList() { return net?.state?.players || []; }
function otherPlayers() { return playersList().filter((p) => p.id !== meId() && p.gameNo === game?.gameNo); }
function myColor() { return playersList().find((p) => p.id === meId())?.color || COLORS[0]; }

function openPeer(id) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const peer = id ? new Peer(id, { debug: 1 }) : new Peer({ debug: 1 });
    const done = (fn, v) => { if (settled) return; settled = true; clearTimeout(timer); fn(v); };
    const timer = setTimeout(() => { peer.destroy(); done(reject, { type: "timeout" }); }, 12000);
    peer.on("open", () => done(resolve, peer));
    peer.on("error", (e) => { if (!settled) { peer.destroy(); done(reject, e); } });
  });
}

function friendsNote(text, isError) {
  const n = $("#friendsNote");
  n.textContent = text;
  n.classList.toggle("error", !!isError);
}
function setFriendsBusy(busy) { $("#createBtn").disabled = busy; $("#joinBtn").disabled = busy; }

async function createGame() {
  if (!window.Peer) { friendsNote("Multiplayer couldn't load. Check your connection and reload.", true); return; }
  saveSettings();
  setFriendsBusy(true);
  friendsNote("Creating a game…");
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => CODE_LETTERS[b % CODE_LETTERS.length]).join("");
    try {
      const peer = await openPeer(PEER_PREFIX + code);
      net = { role: "host", code, peer, conns: new Map(), players: new Map(), gameNo: 0, rounds: null, timer: 0, move: true, state: null };
      net.players.set(peer.id, { id: peer.id, nick: myName(), color: COLORS[0], online: true, gameNo: 0, g: [] });
      peer.on("connection", hostAccept);
      peer.on("disconnected", () => { if (net?.peer === peer && !peer.destroyed) peer.reconnect(); });
      peer.on("error", () => {});
      setFriendsBusy(false);
      friendsNote("");
      enterLobby();
      hostBroadcast();
      return;
    } catch (e) {
      if (e?.type !== "unavailable-id") break;
    }
  }
  setFriendsBusy(false);
  friendsNote("Couldn't create a game. Check your connection and try again.", true);
}

function hostAccept(conn) {
  conn.on("open", () => net?.conns.set(conn.peer, conn));
  conn.on("data", (msg) => hostReceive(conn, msg));
  conn.on("close", () => {
    if (!net || net.role !== "host") return;
    net.conns.delete(conn.peer);
    const p = net.players.get(conn.peer);
    if (p) p.online = false;
    hostBroadcast();
  });
  conn.on("error", () => {});
}

function hostReceive(conn, msg) {
  if (!net || net.role !== "host" || !msg || typeof msg !== "object") return;
  net.conns.set(conn.peer, conn); // a message can arrive before the "open" event fires here
  let p = net.players.get(conn.peer);
  if (msg.t === "hello") {
    if (!p) {
      if ([...net.players.values()].filter((x) => x.online).length >= MAX_PLAYERS) { conn.send({ t: "full" }); setTimeout(() => conn.close(), 300); return; }
      const used = new Set([...net.players.values()].map((x) => x.color));
      p = { id: conn.peer, color: COLORS.find((c) => !used.has(c)) || COLORS[net.players.size % COLORS.length], gameNo: 0, g: [] };
      net.players.set(conn.peer, p);
    }
    p.nick = cleanName(msg.nick) || "Traveller";
    p.online = true;
    hostBroadcast();
  } else if (msg.t === "guess" && p) {
    hostRecordGuess(p, msg.gameNo, msg.round, msg.pin);
  } else if (msg.t === "nick" && p) {
    p.nick = cleanName(msg.nick) || "Traveller";
    hostBroadcast();
  }
}

function hostRecordGuess(p, gameNo, round, pin) {
  if (gameNo !== net.gameNo || !net.rounds || round !== p.g.length || round >= ROUNDS) return;
  if (p.gameNo !== gameNo) { p.gameNo = gameNo; p.g = []; if (round !== 0) return; }
  const place = net.rounds[round];
  const ok = pin && Number.isFinite(pin.lat) && Number.isFinite(pin.lng) && Math.abs(pin.lat) <= 90 && Math.abs(pin.lng) <= 180;
  p.g.push(ok ? [pin.lat, pin.lng, pointsFor(distanceKm(pin, place))] : [0]);
  hostBroadcast();
}

function hostBroadcast() {
  if (!net || net.role !== "host") return;
  const state = {
    t: "state",
    code: net.code,
    hostId: net.peer.id,
    players: [...net.players.values()].map((p) => ({ id: p.id, nick: p.nick, color: p.color, online: p.online, gameNo: p.gameNo, g: p.g })),
    game: net.rounds ? { gameNo: net.gameNo, rounds: net.rounds, timer: net.timer, move: net.move } : null,
  };
  for (const c of net.conns.values()) { try { c.send(state); } catch {} }
  receiveState(state);
}

async function joinGame(code) {
  if (!window.Peer) { friendsNote("Multiplayer couldn't load. Check your connection and reload.", true); return; }
  if (!/^[A-Z]{4}$/.test(code)) { friendsNote("Game codes are 4 letters.", true); return; }
  saveSettings();
  setFriendsBusy(true);
  friendsNote("Joining…");
  let peer;
  try {
    peer = await openPeer(null);
    const conn = peer.connect(PEER_PREFIX + code, { reliable: true });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject({ type: "timeout" }), 12000);
      conn.on("open", () => { clearTimeout(timer); resolve(); });
      peer.on("error", (e) => { clearTimeout(timer); reject(e); });
    });
    net = { role: "guest", code, peer, conn, state: null, closed: false };
    conn.on("data", guestReceive);
    conn.on("close", hostGone);
    conn.on("error", () => {});
    peer.on("error", () => {});
    conn.send({ t: "hello", nick: myName() });
    setFriendsBusy(false);
    friendsNote("");
    enterLobby();
  } catch (e) {
    peer?.destroy();
    setFriendsBusy(false);
    friendsNote(e?.type === "peer-unavailable" || e?.type === "timeout"
      ? "No game with that code. Check it with your friend." : "Couldn't connect. Check your connection and try again.", true);
  }
}

function guestReceive(msg) {
  if (!net || !msg || typeof msg !== "object") return;
  if (msg.t === "full") { toast("That game is full."); goHome(); return; }
  if (msg.t === "state") receiveState(msg);
}

function hostGone() {
  if (!net || net.role !== "guest") return;
  net.closed = true;
  toast("The host left the game.");
  if (document.body.dataset.screen === "lobby") { goHome(); return; }
  renderStandings();
  updateSummaryControls();
}

function sanitizeState(s) {
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const players = Array.isArray(s.players) ? s.players.slice(0, 16).map((p) => ({
    id: String(p?.id ?? ""), nick: cleanName(p?.nick) || "Traveller",
    color: /^#[0-9a-f]{6}$/i.test(p?.color) ? p.color : COLORS[0],
    online: !!p?.online, gameNo: num(p?.gameNo),
    g: Array.isArray(p?.g) ? p.g.slice(0, ROUNDS).map((x) => (Array.isArray(x) && x.length === 3 ? [num(x[0]), num(x[1]), Math.max(0, Math.min(MAX_POINTS, num(x[2])))] : [0])) : [],
  })) : [];
  let gameInfo = null;
  const sg = s.game;
  if (sg && Array.isArray(sg.rounds) && sg.rounds.length === ROUNDS) {
    gameInfo = {
      gameNo: num(sg.gameNo), timer: [0, 60, 120].includes(sg.timer) ? sg.timer : 0, move: sg.move !== false,
      rounds: sg.rounds.map((r) => ({ pano: String(r?.pano ?? "").slice(0, 200), lat: num(r?.lat), lng: num(r?.lng), heading: num(r?.heading) })),
    };
  }
  return { players, game: gameInfo, hostId: String(s.hostId ?? "") };
}

function receiveState(raw) {
  if (!net) return;
  net.state = sanitizeState(raw);
  renderLobby();
  renderStandings();
  const screen = document.body.dataset.screen;
  if (screen === "result" && game?.multi) drawResultMap(false);
  if (screen === "summary") updateSummaryControls();
  const next = net.state.game;
  if (net.role === "guest" && next && screen === "lobby" && (!game || next.gameNo > game.gameNo)) startNetGame(next);
}

function startNetGame(info) {
  newGame({ rounds: info.rounds, timer: info.timer, move: info.move, multi: true, gameNo: info.gameNo });
  startRound();
}

async function hostStartGame() {
  if (!net || net.role !== "host") return;
  saveSettings();
  net.timer = currentTimer();
  net.move = currentMove();
  $("#startBtn").disabled = true;
  $("#loadingText").textContent = "Finding places… 0 of 5";
  setScreen("loading");
  try {
    const rounds = await Promise.all(planRounds((n) => { $("#loadingText").textContent = `Finding places… ${n} of 5`; }));
    if (!net) return;
    net.gameNo += 1;
    net.rounds = rounds;
    for (const p of net.players.values()) { p.gameNo = net.gameNo; p.g = []; }
    hostBroadcast();
    startNetGame({ rounds, timer: net.timer, move: net.move, gameNo: net.gameNo });
  } catch {
    toast("Couldn't reach Street View. Check your connection and try again.");
    setScreen("lobby");
  } finally {
    $("#startBtn").disabled = false;
  }
}

function sendGuess(round, pin) {
  if (!net) return;
  if (net.role === "host") hostRecordGuess(net.players.get(net.peer.id), game.gameNo, round, pin);
  else if (!net.closed) { try { net.conn.send({ t: "guess", gameNo: game.gameNo, round, pin }); } catch {} }
}

function leaveNetwork() {
  if (!net) return;
  const n = net;
  net = null;
  try { n.peer.destroy(); } catch {}
}

function enterLobby() {
  $("#codeText").textContent = net.code;
  const host = net.role === "host";
  $("#lobbyTitle").textContent = host ? "Your Game" : "You're In";
  $("#lobbyHelp").textContent = host
    ? "Share this code. Friends open this page, tap Play with Friends and enter it."
    : "The game starts when the host taps Start.";
  $("#startBtn").hidden = !host;
  document.body.classList.add("multi");
  setScreen("lobby");
  renderLobby();
}

function avatar(p) {
  return el("span", { class: "avatar", style: `background:${p.color}` }, p.nick.slice(0, 1).toUpperCase());
}

function renderLobby() {
  if (!net || document.body.dataset.screen !== "lobby") return;
  const players = playersList().filter((p) => p.online);
  $("#playerList").replaceChildren(...players.map((p) => el("li", {},
    avatar(p),
    el("span", { class: "name" }, p.nick),
    el("span", { class: "meta" }, [p.id === net.state?.hostId || (net.role === "host" && p.id === meId()) ? "Host" : "", p.id === meId() ? "You" : ""].filter(Boolean).join(" · ")))));
  $("#lobbyNote").textContent = net.role === "host"
    ? (players.length < 2 ? "You can start now, or wait for friends to join." : `${players.length} players ready.`)
    : "Waiting for the host…";
}

function renderStandings() {
  const box = $("#standings");
  if (!game?.multi || !net) { box.replaceChildren(); return; }
  const players = playersList().filter((p) => p.gameNo === game.gameNo)
    .map((p) => ({ ...p, total: p.g.reduce((s, x) => s + (x.length === 3 ? x[2] : 0), 0) }))
    .sort((a, b) => b.total - a.total);
  box.replaceChildren(...players.map((p) => el("li", { class: p.online ? "" : "off" },
    el("span", { class: "dot", style: `background:${p.color}` }),
    el("span", { class: "name" }, p.nick, p.id === meId() ? el("span", { class: "you" }, " (you)") : null),
    el("b", {}, fmt(p.total)),
    el("span", { class: "prog" }, `${p.g.length}/${ROUNDS}`))));
}

function renderSummaryBoard() {
  const players = playersList().filter((p) => p.gameNo === game.gameNo)
    .map((p) => ({ ...p, total: p.g.reduce((s, x) => s + (x.length === 3 ? x[2] : 0), 0) }))
    .sort((a, b) => b.total - a.total);
  $("#sumBoard").replaceChildren(...players.map((p, i) => el("li", {},
    el("span", { class: "rank" }, String(i + 1)),
    avatar(p),
    el("span", { class: "name" }, p.nick, p.id === meId() ? " (you)" : ""),
    el("span", { class: "meta" }, p.g.length < ROUNDS ? `${p.g.length}/${ROUNDS} · ${fmt(p.total)}` : fmt(p.total)))));
}

// ---------------------------------------------------------------- wiring

function saveSettings() {
  save("lp.settings", { nick: cleanName($("#nick").value), timer: currentTimer(), move: currentMove() });
}

function initUI() {
  const s = load("lp.settings", {});
  if (s.nick) $("#nick").value = cleanName(s.nick);
  const timerInput = document.querySelector(`input[name=timer][value="${[0, 60, 120].includes(s.timer) ? s.timer : 0}"]`);
  if (timerInput) timerInput.checked = true;
  if (s.move === false) document.querySelector('input[name=move][value="0"]').checked = true;

  $("#nick").addEventListener("change", () => {
    saveSettings();
    if (net?.role === "guest" && !net.closed) { try { net.conn.send({ t: "nick", nick: myName() }); } catch {} }
    if (net?.role === "host") { net.players.get(net.peer.id).nick = myName(); hostBroadcast(); }
  });
  document.querySelectorAll("input[name=timer], input[name=move]").forEach((r) => r.addEventListener("change", saveSettings));

  $("#soloBtn").onclick = () => { if (gm) startSolo(); };
  $("#friendsBtn").onclick = () => { friendsNote(""); setScreen("friends"); };
  $("#friendsBack").onclick = () => setScreen("home");
  $("#createBtn").onclick = createGame;
  $("#joinCode").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4); });
  $("#joinForm").addEventListener("submit", (e) => { e.preventDefault(); joinGame($("#joinCode").value); });
  $("#codeBtn").onclick = async () => {
    const hint = $("#copyHint");
    try { await navigator.clipboard.writeText(net?.code || ""); hint.textContent = "Copied"; }
    catch { hint.textContent = "Couldn't copy. Read it out instead."; }
    setTimeout(() => { hint.textContent = "Tap to copy"; }, 2000);
  };
  $("#startBtn").onclick = hostStartGame;
  $("#leaveBtn").onclick = goHome;

  $("#guessBtn").onclick = submitGuess;
  $("#startOverBtn").onclick = () => {
    const place = game?.rounds[game.round];
    if (!place) return;
    pano.setPano(place.pano);
    pano.setPov({ heading: place.heading, pitch: 0 });
  };
  let quitArmed = null;
  $("#quitBtn").onclick = () => {
    const b = $("#quitBtn");
    if (quitArmed) { clearTimeout(quitArmed); quitArmed = null; b.classList.remove("confirm"); b.innerHTML = b.dataset.icon; goHome(); return; }
    b.dataset.icon = b.innerHTML;
    b.classList.add("confirm");
    b.textContent = "Leave Game";
    quitArmed = setTimeout(() => { quitArmed = null; b.classList.remove("confirm"); b.innerHTML = b.dataset.icon; }, 3000);
  };
  $("#mapFab").onclick = () => document.body.classList.add("map-open");
  $("#mapClose").onclick = () => document.body.classList.remove("map-open");
  $("#nextBtn").onclick = nextRound;
  $("#doneBtn").onclick = goHome;
  $("#againBtn").onclick = () => {
    if (!game?.multi) { startSolo(); return; }
    if (net?.role === "host") { setScreen("lobby"); hostStartGame(); return; }
    const next = net?.state?.game;
    if (next && next.gameNo > game.gameNo) startNetGame(next);
  };

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.target.closest?.("input, button, a")) return;
    const screen = document.body.dataset.screen;
    if (screen === "play" && game?.pin) submitGuess();
    else if (screen === "result") nextRound();
  });
}

initUI();
loadGoogleMaps();
