(async function () {
  const $ = id => document.getElementById(id);
  const [data, cities] = await Promise.all([
    fetch("tournaments.json", { cache: "no-cache" }).then(r => r.json()),
    fetch("cities.json", { cache: "no-cache" }).then(r => r.json()),
  ]);
  const cancelled = data.tournaments.filter(e => e.cancelled);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fold = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const local = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const fmt = s => local(s).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const fmtDay = s => local(s).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const day = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const plus = (s, n) => { const d = local(s); d.setDate(d.getDate() + n); return day(d); };
  const monday = s => { const d = local(s); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return day(d); };
  const key = e => `${e.city}, ${e.country}`;
  const CATS = ["Grand Slam", "Finals", "1000", "500", "250", "Challenger/125", "ITF", "Team", "Olympics", "Other"];
  const TOUR = ["Grand Slam", "Finals", "1000", "500", "250"];
  // Colour says who plays; size says the level. One rule each, so the map reads at a glance.
  const COLOR = { men: "#3b6ea5", women: "#c0562a", both: "#7a5c99" };
  const RADIUS = { "Grand Slam": 13, Finals: 11, "1000": 10, "500": 8, "250": 6.5, Olympics: 10, Team: 6.5, "Challenger/125": 5.5, ITF: 4, Other: 5.5 };
  const LABEL = { "Challenger/125": "Challenger / WTA 125", ITF: "ITF World Tennis Tour", Team: "Team events (Davis Cup, BJK Cup, United Cup)" };
  const SHORT = { "Challenger/125": "Challenger / 125", ITF: "ITF", Team: "team" };
  const ABOUT = {
    "Grand Slam": "the four majors",
    Finals: "the season-ending championships for the top eight players",
    "1000": "the highest tier of ATP/WTA tour events",
    "500": "the middle tier of ATP/WTA tour events",
    "250": "the lower tier of ATP/WTA tour events",
    "Challenger/125": "a tier below the \"tour\", but not in any sense the \"minor leagues\", as the points earned here count towards your ranking in the same way as higher-tier tournaments",
    ITF: "the entry level of professional tennis; the number next to W/M reflects the total prize money pool at the tournament",
    Team: "International team events: Davis Cup and Billie Jean King Cup ties, the United Cup, the Laver Cup",
    Olympics: "the Olympic tournament",
    Other: "everything else",
  };

  // Combined events (Indian Wells, the Slams, Adelaide 250/500…) come once from
  // each tour's page. Show them once: same name and country, same or nested
  // city ("New York" / "New York City"), dates overlapping or back to back.
  const events = [];
  const groups = new Map();
  const near = (a, b) => Math.abs(local(a) - local(b)) <= 2 * 864e5;
  const sameCity = (a, b) => fold(a) === fold(b) || fold(a).startsWith(fold(b)) || fold(b).startsWith(fold(a));
  for (const e of data.tournaments.filter(e => !e.cancelled)) {
    const k = `${fold(e.name)}|${fold(e.country)}`;
    if (!groups.has(k)) groups.set(k, []);
    const g = groups.get(k);
    const m = g.find(x => sameCity(x.city, e.city) && (x.start <= e.end || near(x.start, e.end)) && (e.start <= x.end || near(e.start, x.end)) && !x.tours.includes(e.tour));
    const part = { tour: e.tour, category: e.category, grade: e.grade, prize: e.prize };
    if (m) {
      m.tours.push(e.tour); m.parts.push(part);
      if (!m.cats.includes(e.category)) m.cats.push(e.category);
      if (e.start < m.start) m.start = e.start;
      if (e.end > m.end) m.end = e.end;
      if (!m.surface) m.surface = e.surface;
    } else {
      const r = { ...e, tours: [e.tour], cats: [e.category], parts: [part] };
      g.push(r); events.push(r);
    }
  }
  const order = c => CATS.indexOf(c);
  for (const r of events) { r.cats.sort((a, b) => order(a) - order(b)); r.parts.sort((a, b) => order(a.category) - order(b.category)); }
  events.sort((a, b) => a.start.localeCompare(b.start));
  const top = r => r.cats[0];
  const level = r => [...new Set(r.parts.map(p => p.grade || SHORT[p.category] || p.category))].join(" / ");
  const prize = r => [...new Set(r.parts.map(p => p.prize).filter(Boolean))].join(" / ");
  const whoOf = tours => tours.length === 2 ? "both" : tours[0] === "ATP" ? "men" : "women";
  const who = r => ({ both: "men & women", men: "men", women: "women" })[whoOf(r.tours)];
  const tag = r => `${who(r)}, ${level(r)}, ${r.surface || "surface TBC"}`;
  const seasonFrom = events[0].start, seasonTo = events.reduce((m, e) => e.end > m ? e.end : m, "");

  // ---- Dates -------------------------------------------------------------------------
  // Both pickers are bounded to the season and to each other ("to" cannot precede "from");
  // fixing one side moves the other rather than leaving an empty range. Empty means unbounded.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const p = new URLSearchParams(location.search);
  const upcoming = events.some(e => local(e.end) >= today);
  $("from").min = $("to").min = seasonFrom; $("from").max = $("to").max = seasonTo;
  $("from").value = p.has("from") ? p.get("from") : (upcoming ? day(today) : seasonFrom);
  $("to").value = p.has("to") ? p.get("to") : (upcoming ? day(new Date(today.getTime() + 56 * 864e5)) : seasonTo);
  function linkDates(changed) {
    const f = $("from"), t = $("to");
    if (f.value && t.value && t.value < f.value) { if (changed === "from") t.value = f.value; else f.value = t.value; }
    t.min = f.value || seasonFrom; f.max = t.value || seasonTo;
  }
  const setDates = (f, t) => { $("from").value = f; $("to").value = t; linkDates(); render(); };
  $("from").addEventListener("change", () => { linkDates("from"); render(); });
  $("to").addEventListener("change", () => { linkDates("to"); render(); });
  $("clear-dates").addEventListener("click", () => setDates("", ""));
  const shift = dir => {
    const f = $("from").value || seasonFrom, t = $("to").value || seasonTo;
    const len = Math.round((local(t) - local(f)) / 864e5) + 1;
    setDates(plus(f, dir * len), plus(t, dir * len));
  };
  $("earlier").addEventListener("click", () => shift(-1));
  $("later").addEventListener("click", () => shift(1));
  $("presets").addEventListener("click", ev => {
    const a = ev.target.closest("a[data-preset]"); if (!a) return;
    ev.preventDefault();
    const mon = monday(day(today));
    if (a.dataset.preset === "week") setDates(mon, plus(mon, 6));
    else if (a.dataset.preset === "eight") setDates(day(today), plus(day(today), 56));
    else setDates(seasonFrom, seasonTo);
  });
  linkDates();

  // ---- Other controls ----------------------------------------------------------------
  $("cat").insertAdjacentHTML("beforeend", `<option value="tour">Tour level (Slams, Finals, 1000, 500, 250)</option>`);
  for (const c of CATS) if (events.some(e => e.cats.includes(c))) $("cat").insertAdjacentHTML("beforeend", `<option value="${esc(c)}">${esc(LABEL[c] || c)}</option>`);
  for (const s of [...new Set(events.map(e => e.surface).filter(Boolean))].sort()) $("surface").insertAdjacentHTML("beforeend", `<option value="${esc(s)}">${esc(s)}</option>`);
  if (p.get("cat")) $("cat").value = p.get("cat");
  if (p.get("surface")) $("surface").value = p.get("surface");
  if (p.get("q")) $("q").value = p.get("q");
  if (p.has("tour")) for (const cb of document.querySelectorAll("input[name=tour]")) cb.checked = p.getAll("tour").includes(cb.value);
  $("reset").addEventListener("click", () => {
    $("cat").value = ""; $("surface").value = ""; $("q").value = "";
    for (const cb of document.querySelectorAll("input[name=tour]")) cb.checked = true;
    setDates(upcoming ? day(today) : seasonFrom, upcoming ? plus(day(today), 56) : seasonTo);
  });

  // The pyramid, from the data.
  const n = c => events.filter(e => e.cats.includes(c)).length;
  const parts = events.flatMap(e => e.parts);
  const grades = [...new Set(parts.filter(p => p.grade).map(p => p.grade))].sort((a, b) => a[0].localeCompare(b[0]) || parseInt(a.slice(1)) - parseInt(b.slice(1)));
  $("pyramid").innerHTML = CATS.filter(c => n(c)).map(c => `
    <li><a href="#" data-cat="${esc(c)}">${esc(LABEL[c] || c)}</a> <span class="tag">${n(c)}</span>: ${esc(ABOUT[c])}${c === "ITF" ? ` (${grades.map(g => `${g} ${parts.filter(p => p.grade === g).length}`).join(", ")})` : ""}.</li>`).join("");
  $("pyramid").addEventListener("click", ev => {
    const a = ev.target.closest("a[data-cat]"); if (!a) return;
    ev.preventDefault(); $("cat").value = a.dataset.cat; render();
  });

  const sizeKey = ["Grand Slam", "1000", "500", "250", "Challenger/125", "ITF"];
  $("legend").innerHTML = `<span><i class="dot men"></i>men</span><span><i class="dot women"></i>women</span><span><i class="dot both"></i>men &amp; women</span>`
    + `<span class="key">size is the level:</span>` + sizeKey.map(c => `<span><i class="size" style="width:${RADIUS[c] * 1.4}px;height:${RADIUS[c] * 1.4}px"></i>${esc(SHORT[c] || c)}</span>`).join("") + `<span class="key">click a dot for the list</span>`;

  // ---- Map ---------------------------------------------------------------------------
  const map = L.map("map", { worldCopyJump: true }).setView([30, 10], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  let dots = [];  // { marker, base, radius, label, rank }
  // Dots grow as the map zooms in (the same amount for every level, so the small ones gain the most),
  // else the ITF dots vanish into the tiles once a country fills the screen.
  const grow = () => Math.min(7, Math.max(0, map.getZoom() - 2) * .9);
  map.on("zoomend", () => { const g = grow(); for (const d of dots) { d.radius = d.base + g; d.marker.setRadius(d.radius); } });

  // Label a dot with its city where there is room: biggest dots first, a label goes to the
  // right of its dot, else left, above, or below, wherever the box overlaps no other label or dot.
  function placeLabels() {
    const size = map.getSize(), taken = [];
    const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const pts = dots.map(d => ({ d, pt: map.latLngToContainerPoint(d.marker.getLatLng()) }));
    for (const { d, pt } of pts) taken.push({ x: pt.x - d.radius, y: pt.y - d.radius, w: 2 * d.radius, h: 2 * d.radius });
    const ordered = pts.slice().sort((a, b) => a.d.rank - b.d.rank || b.d.radius - a.d.radius);
    for (const { d, pt } of ordered) {
      d.marker.unbindTooltip();
      if (pt.x < -20 || pt.y < -20 || pt.x > size.x + 20 || pt.y > size.y + 20) continue;
      const w = d.label.length * 6.6 + 12, h = 17;
      const r = d.radius + 2;
      const spots = { right: [{ x: pt.x + r, y: pt.y - h / 2, w, h }, [r, 0]], left: [{ x: pt.x - r - w, y: pt.y - h / 2, w, h }, [-r, 0]],
        top: [{ x: pt.x - w / 2, y: pt.y - r - h, w, h }, [0, -r]], bottom: [{ x: pt.x - w / 2, y: pt.y + r, w, h }, [0, r]] };
      const fits = box => box.x >= 0 && box.x + box.w <= size.x && box.y >= 0 && box.y + box.h <= size.y && !taken.some(t => hit(box, t));
      const side = Object.keys(spots).find(k => fits(spots[k][0]));
      if (!side) continue;
      taken.push(spots[side][0]);
      d.marker.bindTooltip(d.label, { permanent: true, direction: side, className: "marker-label", offset: spots[side][1] });
    }
  }
  map.on("zoomend moveend", placeLabels);

  function selected() {
    const from = $("from").value, to = $("to").value, cat = $("cat").value, surface = $("surface").value;
    const tours = [...document.querySelectorAll("input[name=tour]:checked")].map(cb => cb.value);
    const words = fold($("q").value.trim()).split(/\s+/).filter(Boolean);
    const inCat = e => !cat || (cat === "tour" ? e.cats.some(c => TOUR.includes(c)) : e.cats.includes(cat));
    // an event is in range if any of its days fall inside [from, to]
    return events.filter(e => (!from || e.end >= from) && (!to || e.start <= to) && e.tours.some(t => tours.includes(t)) && inCat(e)
      && (!surface || e.surface === surface) && words.every(w => fold(`${e.name} ${e.city} ${e.country}`).includes(w)));
  }

  function render() {
    const shown = selected();
    const u = new URL(location.href);
    for (const k of ["from", "to"]) $(k).value ? u.searchParams.set(k, $(k).value) : u.searchParams.set(k, "");
    for (const k of ["cat", "surface", "q"]) $(k).value.trim() ? u.searchParams.set(k, $(k).value.trim()) : u.searchParams.delete(k);
    u.searchParams.delete("tour");
    const tours = [...document.querySelectorAll("input[name=tour]:checked")].map(cb => cb.value);
    if (tours.length !== 2) for (const t of tours) u.searchParams.append("tour", t);
    history.replaceState(null, "", u);

    layer.clearLayers(); dots = [];
    const byCity = new Map();
    for (const e of shown) { const k = key(e); if (!byCity.has(k)) byCity.set(k, []); byCity.get(k).push(e); }
    let unplaced = 0;
    for (const [k, list] of byCity) {
      const c = cities[k];
      if (!c || c.lat == null) { unplaced += list.length; continue; }
      const best = CATS.find(cat => list.some(e => e.cats.includes(cat))) || "Other";
      const tours = [...new Set(list.flatMap(e => e.tours))];
      const base = RADIUS[best], radius = base + grow();
      const marker = L.circleMarker([c.lat, c.lon], { radius, color: "#333", weight: 1, fillColor: COLOR[whoOf(tours)], fillOpacity: .85 }).addTo(layer)
        .bindPopup(`<div class="pop"><b>${esc(k)}</b>${list.map(e => `${fmt(e.start)}–${fmt(e.end)}, ${esc(e.name)} <span class="tag">${esc(tag(e))}</span>`).join("<br>")}</div>`, { maxWidth: 340 });
      dots.push({ marker, base, radius, label: list[0].city, rank: CATS.indexOf(best) });
    }
    placeLabels();

    const byWeek = new Map();
    for (const e of shown) { const w = monday(e.start); if (!byWeek.has(w)) byWeek.set(w, []); byWeek.get(w).push(e); }
    $("list").innerHTML = shown.length ? [...byWeek.keys()].sort().map(w => `
      <h2>Week of ${fmtDay(w)}</h2>
      <table>${byWeek.get(w).sort((a, b) => CATS.indexOf(top(a)) - CATS.indexOf(top(b)) || a.name.localeCompare(b.name)).map(e => `
        <tr><td class="when">${fmt(e.start)}–${fmt(e.end)}</td>
            <td>${e.link ? `<a href="${esc(e.link)}" rel="noopener">${esc(e.name)}</a>` : esc(e.name)} <span class="tag">${esc(tag(e))}${prize(e) ? ", " + esc(prize(e)) : ""}${e.venue ? ", " + esc(e.venue) : ""}</span></td>
            <td class="city">${cities[key(e)] && cities[key(e)].lat != null ? `<a href="#map" data-city="${esc(key(e))}">${esc(key(e))}</a>` : esc(key(e))}</td></tr>`).join("")}
      </table>`).join("") : '<p class="none">No tournaments match. Widen the dates or clear a filter.</p>';
    const from = $("from").value, to = $("to").value;
    const fy = s => local(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    const range = from && to ? `, ${from.slice(0, 4) === to.slice(0, 4) ? `${fmt(from)} to ${fmt(to)}` : `${fy(from)} to ${fy(to)}`}` : from ? `, from ${fy(from)}` : to ? `, to ${fy(to)}` : ", whole season";
    $("count").textContent = `${shown.length} tournament${shown.length === 1 ? "" : "s"} in ${byCity.size} cit${byCity.size === 1 ? "y" : "ies"}${range}${unplaced ? ` (${unplaced} not yet on the map)` : ""}.`;
  }

  $("list").addEventListener("click", ev => {
    const a = ev.target.closest("a[data-city]"); if (!a) return;
    const c = cities[a.dataset.city]; map.setView([c.lat, c.lon], 6);
    layer.eachLayer(m => { const ll = m.getLatLng(); if (ll.lat === c.lat && ll.lng === c.lon) m.openPopup(); });
  });
  for (const el of document.querySelectorAll("#f input:not([type=date]), #f select")) el.addEventListener(el.id === "q" ? "input" : "change", render);
  const itfTo = events.filter(e => e.cats.includes("ITF")).reduce((m, e) => e.end > m ? e.end : m, "");
  const itfLinked = events.filter(e => e.link).length;
  $("meta").textContent = `${data.season} season, ${events.length} tournaments and ties (combined men's and women's events counted once)${cancelled.length ? `, plus ${cancelled.length} announced and then cancelled (${cancelled.map(e => e.name).join(", ")}), not shown` : ""}, from Wikipedia's ${data.season} ATP Tour, WTA Tour, ATP Challenger Tour, WTA 125, ITF World Tennis Tour, Davis Cup, and Billie Jean King Cup pages, read on ${data.generated}. The tour calendars are published for the whole year; Wikipedia's ITF pages are filled in week by week, so the weeks ahead${itfTo ? ` (to ${fmt(itfTo)})` : ""} come from itftennis.com's own calendar${itfLinked ? `, ${itfLinked} events, each linked` : ""}.`;
  render();
})();
