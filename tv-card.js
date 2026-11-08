/*! TV Card — compact glass card for a TV in Home Assistant · MIT · github.com/stathisktm/tv-card */

const TV_VERSION = "1.1.2";

const TV_DEFAULTS = {
  title: "",
  entity: "",            // media_player (channels / apps via its source list)
  remote: "",            // remote.* for the d-pad and channel keys (Android TV Remote)
  epg_entity: "",        // sensor whose attributes hold { key: { channel, title, start, end, logo, next_title, next_start } }
  picture_mode_entity: "",
  hide_sources: ["Live Tv", "Notify", "Pipup", "Android TV Launcher"],
  show_apps: true,
  show_channels: true,
  logo_colors: true,     // tint the card from the channel logo
  volume_step: 1,        // % per remote volume key press (TCL: 1)
  color_on: "linear-gradient(135deg, #1e3a8a, #7c3aed)",
  color_off: "linear-gradient(135deg, #1f2937, #374151)",
};

const TV_PICTURE = { vivid: "Δυναμική", standard: "Τυπική", sport: "Σπορ", movie: "Ταινία", smart: "Έξυπνη", game: "Παιχνίδι", eco: "Eco" };

const TV_APP_ICONS = [
  [/netflix/i, "mdi:netflix"], [/youtube/i, "mdi:youtube"], [/spotify/i, "mdi:spotify"], [/stremio/i, "mdi:movie-open"],
  [/cosmote|ote|nova|vodafone/i, "mdi:television-classic"], [/tunein|radio/i, "mdi:radio"], [/prime/i, "mdi:filmstrip"],
  [/disney/i, "mdi:castle"], [/plex|kodi/i, "mdi:play-box-multiple"],
];

const tvBad = (s) => s === undefined || s === null || s === "" || s === "unknown" || s === "unavailable";
const tvEsc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** "ΣΚΑΪ HD" / "Σκάι" / "skai" → "ΣΚΑΙ" … for matching a source with its EPG entry. */
const tvNorm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
  .replace(/\bHD\b|\bTV\b/g, "").replace(/[^A-Z0-9Α-Ω]/g, "");
/** The most vivid colour of a logo (white, black, greys and transparent pixels ignored), or null. */
const tvColorCache = new Map();
function tvLogoColor(url) {
  if (tvColorCache.has(url)) return tvColorCache.get(url);
  const job = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const n = 48, cv = document.createElement("canvas");
        cv.width = cv.height = n;
        const g = cv.getContext("2d", { willReadFrequently: true });
        g.drawImage(img, 0, 0, n, n);
        const px = g.getImageData(0, 0, n, n).data;
        const bins = new Map();
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i], gg = px[i + 1], b = px[i + 2], a = px[i + 3];
          if (a < 128) continue;
          const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
          if (mx < 40 || mx - mn < 40) continue; // black, white and greys
          const k = `${r >> 5},${gg >> 5},${b >> 5}`;
          const e = bins.get(k) || { c: 0, r: 0, g: 0, b: 0 };
          e.c++; e.r += r; e.g += gg; e.b += b;
          bins.set(k, e);
        }
        let best = null;
        for (const e of bins.values()) if (!best || e.c > best.c) best = e;
        resolve(best && best.c > 6 ? [best.r / best.c, best.g / best.c, best.b / best.c].map(Math.round) : null);
      } catch (e) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  tvColorCache.set(url, job);
  return job;
}

const tvTime = (d) => d.toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", hour12: false });

class TvCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = null;
    this._keys = {};
    this._dpad = false;
  }

  static getConfigElement() { return document.createElement("tv-card-editor"); }

  static getStubConfig(hass) {
    const ids = Object.keys(hass?.states || {});
    const tv = ids.find((id) => id.startsWith("media_player.") && hass.states[id].attributes.device_class === "tv"
      && (hass.states[id].attributes.source_list || []).length) || ids.find((id) => id.startsWith("media_player.")) || "";
    const epg = ids.find((id) => id.startsWith("sensor.") && Object.values(hass.states[id].attributes)
      .some((v) => v && typeof v === "object" && "channel" in v && "title" in v)) || "";
    return { entity: tv, epg_entity: epg };
  }

  setConfig(config) {
    if (!config || !config.entity) throw new Error("Όρισε entity (media_player της τηλεόρασης)");
    this._config = { ...TV_DEFAULTS, ...config };
    this._keys = {};
    this._render();
    if (this._hass) this._update();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this.shadowRoot.querySelector("ha-card")) this._render();
    this._update();
  }

  connectedCallback() { this._tick = setInterval(() => this._updateProgress(), 30000); }
  disconnectedCallback() { clearInterval(this._tick); }
  getCardSize() { return 4; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: "auto" }; }

  /* ================= RENDER ================= */

  _render() {
    const c = this._config;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; }
        [hidden] { display:none !important; }
        ha-card { display:block; background:rgba(0,0,0,.28) !important; border:1px solid rgba(255,255,255,.035) !important;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.025), 0 2px 8px rgba(0,0,0,.12) !important; padding:8px 9px 9px; color:#fff !important; overflow:hidden; }
        .head { display:flex; align-items:center; gap:7px; height:30px; margin-bottom:6px; }
        .head ha-icon { --mdc-icon-size:18px; }
        .name { font-size:14px; font-weight:600; flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer; }
        .chip { font-size:9px; font-weight:600; padding:3px 8px; border-radius:99px; background:rgba(255,255,255,.10); white-space:nowrap; max-width:40%; overflow:hidden; text-overflow:ellipsis; }
        .chip:empty { display:none; }
        .btn { width:30px; height:30px; min-width:30px; border-radius:50%; border:1px solid rgba(255,255,255,.10); background:rgba(8,8,14,.30);
          color:#fff; display:grid; place-items:center; cursor:pointer; padding:0; transition:background .18s, transform .12s, color .18s; }
        .btn ha-icon { --mdc-icon-size:17px; }
        .btn:active { transform:scale(.92); }
        .btn.on { color:#a5b4fc; border-color:rgba(165,180,252,.45); background:rgba(165,180,252,.12); }

        .now { position:relative; overflow:hidden; border-radius:12px; padding:8px; display:flex; gap:10px; align-items:center;
          background:var(--tv-off); min-height:64px; box-sizing:border-box; margin-bottom:6px; }
        .now::after { content:""; position:absolute; inset:0; background:var(--tv-tint, var(--tv-on)); opacity:0; transition:opacity .35s; }
        .now.on::after { opacity:1; }
        .now > * { position:relative; z-index:1; }
        .logo { flex:none; width:56px; height:56px; border-radius:11px; background:#fff center/78% no-repeat; box-shadow:0 3px 10px rgba(0,0,0,.3); display:grid; place-items:center; color:#111; }
        .logo.none { background:rgba(255,255,255,.14); color:#fff; }
        .logo ha-icon { --mdc-icon-size:28px; }
        .info { min-width:0; flex:1; }
        .ch { font-size:8px; text-transform:uppercase; letter-spacing:.35px; opacity:.75; margin-bottom:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .title { font-size:13px; font-weight:700; line-height:1.2; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
        .next { font-size:9px; opacity:.75; margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .prog { position:absolute; left:0; right:0; bottom:0; height:3px; background:rgba(255,255,255,.12); z-index:1; }
        .prog i { display:block; height:100%; width:0; background:rgba(255,255,255,.85); border-radius:0 3px 3px 0; transition:width 1s; }
        .prog.hidden, .next:empty { display:none; }
        .times { font-size:8px; opacity:.7; font-variant-numeric:tabular-nums; margin-top:2px; }
        .times:empty { display:none; }

        .ctrl { display:flex; align-items:center; gap:5px; margin-bottom:6px; }
        .ctrl .sp { flex:1; }
        .vol { flex:1; display:flex; align-items:center; gap:6px; min-width:0; }
        .vol span { font-size:10px; font-weight:700; min-width:26px; text-align:right; font-variant-numeric:tabular-nums; }
        input[type=range] { flex:1; min-width:40px; height:15px; margin:0; appearance:none; -webkit-appearance:none; background:transparent; cursor:pointer; }
        input[type=range]::-webkit-slider-runnable-track { height:4px; border-radius:4px; background:rgba(255,255,255,.14); }
        input[type=range]::-webkit-slider-thumb { appearance:none; -webkit-appearance:none; width:12px; height:12px; margin-top:-4px; border-radius:50%; border:2px solid rgba(8,8,14,.8); background:#a5b4fc; }
        input[type=range]::-moz-range-track { height:4px; border-radius:4px; background:rgba(255,255,255,.14); }
        input[type=range]::-moz-range-thumb { width:10px; height:10px; border-radius:50%; border:2px solid rgba(8,8,14,.8); background:#a5b4fc; }

        .row { display:flex; gap:5px; overflow-x:auto; scrollbar-width:none; margin-bottom:6px; padding-bottom:1px;
          touch-action:pan-y; overscroll-behavior-x:contain; cursor:grab; user-select:none; -webkit-user-select:none;
          -webkit-mask-image:linear-gradient(90deg, #000 92%, transparent); mask-image:linear-gradient(90deg, #000 92%, transparent); }
        .row.drag { cursor:grabbing; }
        .row::-webkit-scrollbar { display:none; }
        .row:empty { display:none; }
        .chn { flex:none; width:62px; border:0; padding:0; background:none; color:#fff; cursor:pointer; font:inherit; text-align:center; }
        .chn .l { height:38px; border-radius:9px; background:#fff center/72% no-repeat; border:2px solid transparent; transition:transform .12s, border-color .18s; }
        .chn .l.txt { background:rgba(8,8,14,.42); display:grid; place-items:center; font-size:10px; font-weight:700; color:#fff; }
        .chn.on .l { border-color:#a5b4fc; }
        .chn:active .l { transform:scale(.94); }
        .chn .t { font-size:8px; opacity:.72; margin-top:3px; line-height:1.15; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; min-height:18px; }
        .pill { flex:none; height:25px; padding:0 9px; border-radius:8px; border:1px solid rgba(255,255,255,.11); background:rgba(8,8,14,.42);
          color:#fff; font:inherit; font-size:9px; font-weight:600; display:flex; align-items:center; gap:4px; cursor:pointer; white-space:nowrap; }
        .pill ha-icon { --mdc-icon-size:14px; }
        .pill.on { background:var(--tv-tint, var(--tv-on)); border-color:transparent; }
        .ctrl .play { background:rgba(255,255,255,.16); }

        .pad { display:grid; grid-template-columns:repeat(3, 44px); grid-template-rows:repeat(3, 38px); gap:5px; justify-content:center; margin:2px 0 4px; }
        .pad[hidden], .padx[hidden] { display:none; }
        .pad button { border-radius:10px; }
        .pad .ok { border-radius:50%; background:rgba(165,180,252,.18); }
        .padx { display:flex; justify-content:center; gap:8px; margin-bottom:4px; }
        .pad button, .padx button { border:1px solid rgba(255,255,255,.10); background:rgba(8,8,14,.42); color:#fff; display:grid; place-items:center; cursor:pointer; padding:0; }
        .padx button { width:38px; height:30px; border-radius:9px; }
        .pad ha-icon, .padx ha-icon { --mdc-icon-size:18px; }
        .pad button:active, .padx button:active { transform:scale(.92); }

        .card.off .row, .card.off .ctrl .vol { opacity:.5; }
        .warn { font-size:9px; opacity:.75; }
      </style>
      <ha-card>
        <div class="card">
          <div class="head">
            <ha-icon icon="mdi:television"></ha-icon>
            <div class="name"></div>
            <div class="chip app"></div>
            <button class="btn power" title="Ενεργοποίηση / απενεργοποίηση"><ha-icon icon="mdi:power"></ha-icon></button>
          </div>

          <div class="now">
            <div class="logo none"><ha-icon icon="mdi:television"></ha-icon></div>
            <div class="info">
              <div class="ch"></div>
              <div class="title">—</div>
              <div class="times"></div>
              <div class="next"></div>
            </div>
            <div class="prog hidden"><i></i></div>
          </div>

          <div class="ctrl">
            <button class="btn" data-m="media_previous_track" title="Προηγούμενο (κανάλι ή κομμάτι)"><ha-icon icon="mdi:skip-previous"></ha-icon></button>
            <button class="btn play" data-m="media_play_pause" title="Αναπαραγωγή / παύση"><ha-icon icon="mdi:play-pause"></ha-icon></button>
            <button class="btn" data-m="media_next_track" title="Επόμενο (κανάλι ή κομμάτι)"><ha-icon icon="mdi:skip-next"></ha-icon></button>
            <div class="vol">
              <button class="btn mute" title="Σίγαση"><ha-icon icon="mdi:volume-high"></ha-icon></button>
              <input type="range" min="0" max="100" step="1">
              <span class="volv">--</span>
            </div>
            <button class="btn dpad" title="Τηλεχειριστήριο"><ha-icon icon="mdi:remote"></ha-icon></button>
          </div>

          <div class="pad" hidden>
            <span></span><button data-r="DPAD_UP"><ha-icon icon="mdi:chevron-up"></ha-icon></button><span></span>
            <button data-r="DPAD_LEFT"><ha-icon icon="mdi:chevron-left"></ha-icon></button>
            <button class="ok" data-r="DPAD_CENTER"><ha-icon icon="mdi:circle-medium"></ha-icon></button>
            <button data-r="DPAD_RIGHT"><ha-icon icon="mdi:chevron-right"></ha-icon></button>
            <span></span><button data-r="DPAD_DOWN"><ha-icon icon="mdi:chevron-down"></ha-icon></button><span></span>
          </div>
          <div class="padx" hidden>
            <button data-r="BACK" title="Πίσω"><ha-icon icon="mdi:arrow-left"></ha-icon></button>
            <button data-r="HOME" title="Αρχική"><ha-icon icon="mdi:home"></ha-icon></button>
            <button data-r="MENU" title="Μενού"><ha-icon icon="mdi:menu"></ha-icon></button>
            <button data-r="INFO" title="Πληροφορίες"><ha-icon icon="mdi:information-outline"></ha-icon></button>
          </div>

          <div class="row chans"></div>
          <div class="row apps"></div>
          <div class="row pics"></div>
          <div class="warn" hidden></div>
        </div>
      </ha-card>`;
    const card = this.shadowRoot.querySelector("ha-card");
    card.style.setProperty("--tv-on", c.color_on || TV_DEFAULTS.color_on);
    card.style.setProperty("--tv-off", c.color_off || TV_DEFAULTS.color_off);
    this._keys = {};
    this._bind();
  }

  _bind() {
    const $ = (s) => this.shadowRoot.querySelector(s);
    const tv = () => this._config.entity;
    // turn_on / turn_off rather than toggle: some template media players ignore toggle.
    $(".power").addEventListener("click", () => {
      const off = ["off", "standby", "unavailable", "unknown"].includes(this._st?.state);
      this._call("media_player", off ? "turn_on" : "turn_off", { entity_id: tv() });
      this._haptic();
    });
    $(".name").addEventListener("click", () => this._moreInfo(tv()));
    $(".mute").addEventListener("click", () => {
      const a = this._st?.attributes || {};
      this._call("media_player", "volume_mute", { entity_id: tv(), is_volume_muted: !a.is_volume_muted });
    });
    const vol = $(".ctrl input");
    vol.addEventListener("input", () => { this._dragVol = Date.now(); $(".volv").textContent = `${vol.value}%`; });
    vol.addEventListener("change", () => { this._setVolume(vol.value / 100); this._haptic(); });
    for (const row of this.shadowRoot.querySelectorAll(".row")) this._dragScroll(row);
    // On Live TV next/previous pick the neighbouring channel from the card's own channel list
    // (the same select_source a logo tap uses); in apps they go to the TV as next/previous track.
    for (const b of this.shadowRoot.querySelectorAll("[data-m]")) {
      b.addEventListener("click", () => {
        const m = b.dataset.m, list = this._chanList || [];
        const live = m !== "media_play_pause" && list.length && (list.includes(this._source) || this._liveTv);
        if (live) {
          const i = list.indexOf(this._source), step = m === "media_next_track" ? 1 : -1;
          const next = list[i < 0 ? 0 : (i + step + list.length) % list.length];
          this._call("media_player", "select_source", { entity_id: tv(), source: next });
        } else this._call("media_player", m, { entity_id: tv() });
        this._haptic();
      });
    }
    $(".dpad").addEventListener("click", () => {
      this._dpad = !this._dpad;
      $(".pad").hidden = $(".padx").hidden = !this._dpad;
      $(".dpad").classList.toggle("on", this._dpad);
    });
    for (const b of this.shadowRoot.querySelectorAll("[data-r]")) b.addEventListener("click", () => this._remote(b.dataset.r));
    $(".chans").addEventListener("click", (ev) => {
      if (this._dragged) return;
      const s = ev.target.closest("[data-src]")?.dataset.src;
      if (s) { this._call("media_player", "select_source", { entity_id: tv(), source: s }); this._haptic(); }
    });
    $(".apps").addEventListener("click", (ev) => {
      if (this._dragged) return;
      const s = ev.target.closest("[data-src]")?.dataset.src;
      if (s) { this._call("media_player", "select_source", { entity_id: tv(), source: s }); this._haptic(); }
    });
    $(".pics").addEventListener("click", (ev) => {
      const o = ev.target.closest("[data-opt]")?.dataset.opt;
      if (o) { this._call("select", "select_option", { entity_id: this._config.picture_mode_entity, option: o }); this._haptic(); }
    });
  }

  /* ================= ACTIONS ================= */

  _call(domain, service, data) { this._hass?.callService(domain, service, data); }
  _remote(cmd) {
    if (!this._config.remote) return;
    this._call("remote", "send_command", { entity_id: this._config.remote, command: cmd });
    this._haptic();
  }
  /** Many TV players can only step the volume (Android TV Remote). With a remote set, the slider
   *  becomes the right number of volume key presses; otherwise it's a plain volume_set. */
  _setVolume(level) {
    const a = this._st?.attributes || {}, c = this._config;
    const cur = typeof a.volume_level === "number" ? a.volume_level : null;
    if (c.remote && cur !== null) {
      const steps = Math.round(((level - cur) * 100) / (Number(c.volume_step) || 1));
      if (!steps) return;
      this._call("remote", "send_command", {
        entity_id: c.remote, command: steps > 0 ? "VOLUME_UP" : "VOLUME_DOWN",
        num_repeats: Math.min(Math.abs(steps), 50), delay_secs: 0.05,
      });
    } else this._call("media_player", "volume_set", { entity_id: c.entity, volume_level: level });
  }

  /** Horizontal swipe / drag for the channel and app rows, done here so the dashboard can't take it. */
  _dragScroll(row) {
    let x0 = 0, s0 = 0, id = null, moved = false;
    row.addEventListener("pointerdown", (e) => { id = e.pointerId; x0 = e.clientX; s0 = row.scrollLeft; moved = false; });
    row.addEventListener("pointermove", (e) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - x0;
      if (!moved && Math.abs(dx) > 6) { moved = true; row.classList.add("drag"); try { row.setPointerCapture(id); } catch (_) {} }
      if (moved) { row.scrollLeft = s0 - dx; e.preventDefault(); }
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      row.classList.remove("drag");
      if (moved) { this._dragged = true; setTimeout(() => { this._dragged = false; }, 60); }
    };
    row.addEventListener("pointerup", end);
    row.addEventListener("pointercancel", end);
  }

  _haptic() { this.dispatchEvent(new CustomEvent("haptic", { detail: "light", bubbles: true, composed: true })); }
  _moreInfo(entityId) { this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true })); }

  /* ================= STATE ================= */

  get _st() { return this._hass?.states[this._config.entity]; }

  /** EPG entries keyed by normalised channel name. */
  _epg() {
    const e = this._hass?.states[this._config.epg_entity];
    const map = {};
    if (!e) return map;
    for (const [key, v] of Object.entries(e.attributes || {})) {
      if (v && typeof v === "object" && "title" in v) map[tvNorm(v.channel || key)] = { key, ...v };
    }
    return map;
  }

  _findEpg(epg, source) {
    const n = tvNorm(source);
    if (!n) return null;
    if (epg[n]) return epg[n];
    // "OPEN HD" ↔ "Open Beyond", "ΕΡΤ NEWS" ↔ "ΕΡΤ News"…
    const k = Object.keys(epg).find((x) => x.startsWith(n) || n.startsWith(x));
    return k ? epg[k] : null;
  }

  _url(p) { return !p ? "" : p.startsWith("http") ? p : this._hass.hassUrl(p); }

  _update() {
    const $ = (s) => this.shadowRoot.querySelector(s);
    if (!this._hass || !$("ha-card")) return;
    const c = this._config, st = this._st;
    const warn = $(".warn");
    warn.hidden = !!st;
    warn.textContent = st ? "" : `Δεν βρέθηκε: ${c.entity}`;
    if (!st) return;
    const a = st.attributes || {};
    const on = !["off", "unavailable", "unknown", "standby"].includes(st.state);

    $(".name").textContent = c.title || a.friendly_name || c.entity;
    $(".card").classList.toggle("off", !on);
    $(".power").classList.toggle("on", on);
    $(".now").classList.toggle("on", on);
    $(".app").textContent = on ? (a.app_name && a.app_name !== a.source ? a.app_name : "") : "";

    const epg = this._epg();
    const source = on ? a.source || "" : "";
    const cur = this._findEpg(epg, a.media_channel || source);
    this._cur = on ? cur : null;

    const logoUrl = on ? this._url(a.entity_picture || cur?.logo) : "";
    if (this._keys.tint !== logoUrl) {
      this._keys.tint = logoUrl;
      const card = $("ha-card");
      if (!c.logo_colors || !logoUrl) card.style.removeProperty("--tv-tint");
      else tvLogoColor(logoUrl).then((rgb) => {
        if (this._keys.tint !== logoUrl) return;
        if (!rgb) { card.style.removeProperty("--tv-tint"); return; }
        const [r, g, b] = rgb, d = (v) => Math.round(v * 0.45);
        card.style.setProperty("--tv-tint", `linear-gradient(135deg, rgb(${r},${g},${b}), rgb(${d(r)},${d(g)},${d(b)}))`);
      });
    }
    const logo = $(".logo");
    if (this._keys.logo !== logoUrl) {
      this._keys.logo = logoUrl;
      logo.className = "logo" + (logoUrl ? "" : " none");
      logo.style.backgroundImage = logoUrl ? `url("${logoUrl}")` : "";
      logo.innerHTML = logoUrl ? "" : `<ha-icon icon="${on ? "mdi:television-play" : "mdi:television-off"}"></ha-icon>`;
    }
    $(".ch").textContent = !on ? "Κλειστή" : source || a.app_name || "";
    $(".title").textContent = !on ? "Η τηλεόραση είναι κλειστή" : (cur?.title || a.media_title || a.app_name || source || "Σε λειτουργία");
    $(".next").textContent = on && cur?.next_title ? `Μετά ${cur.next_start || ""} · ${cur.next_title}` : "";
    this._updateProgress();

    // Volume — never yank the slider from under a finger.
    const v = a.volume_level;
    $(".mute ha-icon").setAttribute("icon", a.is_volume_muted ? "mdi:volume-off" : "mdi:volume-high");
    if (v != null && !(this._dragVol && Date.now() - this._dragVol < 1500)) {
      $(".ctrl input").value = Math.round(v * 100);
      $(".volv").textContent = `${Math.round(v * 100)}%`;
    } else if (v == null) $(".volv").textContent = "--";
    $(".dpad").hidden = !c.remote;
    const f = a.supported_features || 0;
    $("[data-m=media_previous_track]").hidden = !(f & 16);
    $("[data-m=media_next_track]").hidden = !(f & 32);
    $("[data-m=media_play_pause]").hidden = !(f & 1) && !(f & 16384);

    // Channels (sources with a TV logo / EPG entry) and apps (the rest).
    const hide = new Set((c.hide_sources || []).map((s) => s.toLowerCase()));
    const sources = (a.source_list || []).filter((s) => !hide.has(String(s).toLowerCase()));
    const chans = [], apps = [];
    for (const s of sources) {
      const e = this._findEpg(epg, s);
      if (e || /\bHD\b/i.test(s)) chans.push({ s, e }); else apps.push(s);
    }
    this._chanList = chans.map((x) => x.s);
    this._source = source;
    this._liveTv = on && (/^live\s*tv$/i.test(a.app_name || "") || a.app_id === "com.tcl.tv" || a.media_content_type === "channel");
    const ckey = JSON.stringify([chans.map((x) => [x.s, x.e?.title, x.e?.logo]), source, on, c.show_channels]);
    if (this._keys.chans !== ckey) {
      this._keys.chans = ckey;
      $(".chans").innerHTML = !c.show_channels ? "" : chans.map(({ s, e }) => {
        const l = this._url(e?.logo);
        return `<button class="chn${on && s === source ? " on" : ""}" data-src="${tvEsc(s)}" title="${tvEsc(s)}">
          <div class="l${l ? "" : " txt"}" ${l ? `style="background-image:url('${tvEsc(l)}')"` : ""}>${l ? "" : tvEsc(s.replace(/\s*HD$/i, ""))}</div>
          <div class="t">${tvEsc(e?.title || s)}</div></button>`;
      }).join("");
      $(".chans .on")?.scrollIntoView?.({ block: "nearest", inline: "center" });
    }
    const akey = JSON.stringify([apps, source, a.app_name, on, c.show_apps]);
    if (this._keys.apps !== akey) {
      this._keys.apps = akey;
      $(".apps").innerHTML = !c.show_apps ? "" : apps.map((s) => {
        const icon = (TV_APP_ICONS.find(([re]) => re.test(s)) || [null, "mdi:application"])[1];
        const active = on && (s === source || s === a.app_name);
        return `<button class="pill${active ? " on" : ""}" data-src="${tvEsc(s)}"><ha-icon icon="${icon}"></ha-icon>${tvEsc(s)}</button>`;
      }).join("");
    }

    const pm = this._hass.states[c.picture_mode_entity];
    const opts = pm?.attributes?.options || [];
    const pkey = JSON.stringify([opts, pm?.state, on]);
    if (this._keys.pics !== pkey) {
      this._keys.pics = pkey;
      $(".pics").innerHTML = !pm || !on ? "" : `<span class="pill" style="cursor:default;background:none;border:0;padding-left:2px"><ha-icon icon="mdi:palette"></ha-icon></span>` +
        opts.map((o) => `<button class="pill${o === pm.state ? " on" : ""}" data-opt="${tvEsc(o)}">${tvEsc(TV_PICTURE[o] || o)}</button>`).join("");
    }
  }

  _updateProgress() {
    const $ = (s) => this.shadowRoot.querySelector(s);
    const prog = $(".prog"), times = $(".times");
    if (!prog) return;
    const cur = this._cur;
    const start = cur?.start ? new Date(cur.start) : null, end = cur?.end ? new Date(cur.end) : null;
    const ok = start && end && !isNaN(start) && !isNaN(end) && end > start;
    prog.classList.toggle("hidden", !ok);
    times.textContent = ok ? `${tvTime(start)} – ${tvTime(end)}` : "";
    if (ok) prog.firstElementChild.style.width = `${Math.min(100, Math.max(0, ((Date.now() - start) / (end - start)) * 100))}%`;
  }
}

/* ================= VISUAL EDITOR ================= */

const TV_LABELS = {
  title: "Τίτλος (κενό = όνομα συσκευής)",
  entity: "Τηλεόραση (media_player)",
  remote: "Τηλεχειριστήριο (remote) — για βελάκια και κανάλι ±",
  epg_entity: "Πρόγραμμα TV (αισθητήρας EPG)",
  picture_mode_entity: "Λειτουργία εικόνας (select)",
  hide_sources: "Πηγές που δεν εμφανίζονται",
  show_channels: "Κανάλια",
  show_apps: "Εφαρμογές",
  logo_colors: "Χρώμα από τον λογότυπο",
  volume_step: "Βήμα έντασης ανά πάτημα (%)",
  color_on: "Χρώμα: ανοιχτή",
  color_off: "Χρώμα: κλειστή",
};

const TV_SCHEMA = [
  { name: "entity", required: true, selector: { entity: { filter: { domain: "media_player" } } } },
  { name: "title", selector: { text: {} } },
  { name: "remote", selector: { entity: { filter: { domain: "remote" } } } },
  { name: "epg_entity", selector: { entity: { filter: { domain: "sensor" } } } },
  { name: "picture_mode_entity", selector: { entity: { filter: { domain: ["select", "input_select"] } } } },
  { type: "grid", name: "", schema: [{ name: "show_channels", selector: { boolean: {} } }, { name: "show_apps", selector: { boolean: {} } }, { name: "logo_colors", selector: { boolean: {} } }] },
  { name: "volume_step", selector: { number: { min: 1, max: 10, mode: "box" } } },
  { name: "hide_sources", selector: { text: { multiple: true } } },
  {
    type: "expandable", title: "Χρώματα (χρώμα ή CSS gradient)", icon: "mdi:palette",
    schema: [{ name: "color_on", selector: { text: {} } }, { name: "color_off", selector: { text: {} } }],
  },
];

class TvCardEditor extends HTMLElement {
  setConfig(config) { this._config = { ...config }; this._render(); }
  set hass(hass) { this._hass = hass; if (this._form) this._form.hass = hass; }
  async _render() {
    if (!this._form) {
      if (!customElements.get("ha-form") && window.loadCardHelpers) {
        const helpers = await window.loadCardHelpers();
        const c = await helpers.createCardElement({ type: "entities", entities: [] });
        await c.constructor.getConfigElement?.();
      }
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => TV_LABELS[s.name] ?? s.name;
      this._form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        this._config = { ...this._config, ...ev.detail.value };
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = TV_SCHEMA;
    this._form.data = { ...TV_DEFAULTS, ...this._config };
  }
}

if (!customElements.get("tv-card")) customElements.define("tv-card", TvCard);
if (!customElements.get("tv-card-editor")) customElements.define("tv-card-editor", TvCardEditor);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "tv-card")) {
  window.customCards.push({
    type: "tv-card",
    name: "TV Card",
    description: "Συμπαγής κάρτα τηλεόρασης: τι παίζει τώρα και μετά (EPG), κανάλια με λογότυπους, εφαρμογές, ένταση, τηλεχειριστήριο και λειτουργία εικόνας.",
    preview: true,
    documentationURL: "https://github.com/stathisktm/tv-card",
  });
}

console.info(`%c TV-CARD %c ${TV_VERSION} `, "background:#4338ca;color:#fff;border-radius:3px 0 0 3px;padding:1px 4px", "background:#222;color:#fff;border-radius:0 3px 3px 0;padding:1px 4px");
