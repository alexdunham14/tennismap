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
  const monday = s => { const d = local(s); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return day(d); };
  const key = e => `${e.city}, ${e.country}`;
  const CATS = ["Grand Slam", "Finals", "1000", "500", "250", "Challenger/125", "ITF", "Team", "Olympics", "Other"];
  const TOUR = ["Grand Slam", "Finals", "1000", "500", "250"];
  const COLOR = { "Grand Slam": "#8a3b12", Finals: "#8a3b12", "1000": "#c0562a", "500": "#e0864f", "250": "#efb08a", "Challenger/125": "#b9b0a5", ITF: "#d6d0c8", Team: "#5b7a8a", Olympics: "#5b7a8a", Other: "#b9b0a5" };
  const LABEL = { "Challenger/125": "Challenger / WTA 125", ITF: "ITF World Tennis Tour", Team: "Team events (Davis Cup, BJK Cup, United Cup)" };
  const SHORT = { "Challenger/125": "Challenger / 125", ITF: "ITF", Team: "team" };
  const ABOUT = {
    "Grand Slam": "the four majors, two weeks each",
    Finals: "the season-ending championships for the top eight",
    "1000": "the biggest regular tour events, most of them men and women together",
    "500": "the middle rung of the main tours",
    "250": "the entry level of the main ATP and WTA tours",
    "Challenger/125": "the tier below the tours, where players ranked roughly 80 to 300 earn their points",
    ITF: "the entry level of professional tennis; the number is the prize money in thousands of dollars",
    Team: "Davis Cup and Billie Jean King Cup ties, the United Cup, the Laver Cup",
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
  const who = r => r.tours.length === 2 ? "men & women" : r.tours[0] === "ATP" ? "men" : "women";
  const tag = r => `${who(r)} · ${level(r)} · ${r.surface || "surface TBC"}`;
  const seasonFrom = events[0].start, seasonTo = events.reduce((m, e) => e.end > m ? e.end : m, "");

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const p = new URLSearchParams(location.search);
  const upcoming = events.some(e => local(e.end) >= today);
  $("from").value = p.get("from") || (upcoming ? day(today) : seasonFrom);
  $("to").value = p.get("to") || (upcoming ? day(new Date(today.getTime() + 56 * 864e5)) : seasonTo);
  $("cat").insertAdjacentHTML("beforeend", `<option value="tour">Tour level (Slams, Finals, 1000, 500, 250)</option>`);
  for (const c of CATS) if (events.some(e => e.cats.includes(c))) $("cat").insertAdjacentHTML("beforeend", `<option value="${esc(c)}">${esc(LABEL[c] || c)}</option>`);
  for (const s of [...new Set(events.map(e => e.surface).filter(Boolean))].sort()) $("surface").insertAdjacentHTML("beforeend", `<option value="${esc(s)}">${esc(s)}</option>`);
  if (p.get("cat")) $("cat").value = p.get("cat");
  if (p.get("surface")) $("surface").value = p.get("surface");
  if (p.get("q")) $("q").value = p.get("q");
  if (p.has("tour")) for (const cb of document.querySelectorAll("input[name=tour]")) cb.checked = p.getAll("tour").includes(cb.value);

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

  $("legend").innerHTML = CATS.filter(c => n(c) && c !== "Finals").map(c => `<span><i style="background:${COLOR[c]}"></i>${esc(SHORT[c] || c)}</span>`).join("") + "<span>ITF dots are small; a dot's size is the number of events</span>";

  const map = L.map("map", { scrollWheelZoom: false, worldCopyJump: true }).setView([30, 10], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
  const layer = L.layerGroup().addTo(map);

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
    u.searchParams.set("from", $("from").value); u.searchParams.set("to", $("to").value);
    for (const k of ["cat", "surface", "q"]) $(k).value.trim() ? u.searchParams.set(k, $(k).value.trim()) : u.searchParams.delete(k);
    u.searchParams.delete("tour");
    const tours = [...document.querySelectorAll("input[name=tour]:checked")].map(cb => cb.value);
    if (tours.length !== 2) for (const t of tours) u.searchParams.append("tour", t);
    history.replaceState(null, "", u);

    layer.clearLayers();
    const byCity = new Map();
    for (const e of shown) { const k = key(e); if (!byCity.has(k)) byCity.set(k, []); byCity.get(k).push(e); }
    let unplaced = 0;
    for (const [k, list] of byCity) {
      const c = cities[k];
      if (!c || c.lat == null) { unplaced += list.length; continue; }
      const best = CATS.find(cat => list.some(e => e.cats.includes(cat))) || "Other";
      const small = best === "ITF";
      L.circleMarker([c.lat, c.lon], { radius: (small ? 3 : 5) + Math.min(list.length, 6) * (small ? .7 : 1.5), color: "#333", weight: small ? .5 : 1, fillColor: COLOR[best], fillOpacity: .85 }).addTo(layer)
        .bindPopup(`<div class="pop"><b>${esc(k)}</b>${list.map(e => `${fmt(e.start)}–${fmt(e.end)} · ${esc(e.name)} <span class="tag">${esc(tag(e))}</span>`).join("<br>")}</div>`, { maxWidth: 340 });
    }

    const byWeek = new Map();
    for (const e of shown) { const w = monday(e.start); if (!byWeek.has(w)) byWeek.set(w, []); byWeek.get(w).push(e); }
    $("list").innerHTML = shown.length ? [...byWeek.keys()].sort().map(w => `
      <h2>Week of ${fmtDay(w)}</h2>
      <table>${byWeek.get(w).sort((a, b) => CATS.indexOf(top(a)) - CATS.indexOf(top(b)) || a.name.localeCompare(b.name)).map(e => `
        <tr><td class="when">${fmt(e.start)}–${fmt(e.end)}</td>
            <td>${esc(e.name)} <span class="tag">${esc(tag(e))}${prize(e) ? ", " + esc(prize(e)) : ""}${e.venue ? ", " + esc(e.venue) : ""}</span></td>
            <td class="city">${cities[key(e)] && cities[key(e)].lat != null ? `<a href="#map" data-city="${esc(key(e))}">${esc(key(e))}</a>` : esc(key(e))}</td></tr>`).join("")}
      </table>`).join("") : '<p class="none">No tournaments match. Widen the dates or clear a filter.</p>';
    const from = $("from").value, to = $("to").value;
    const fy = s => local(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    const range = from && to ? `, ${from.slice(0, 4) === to.slice(0, 4) ? `${fmt(from)} to ${fmt(to)}` : `${fy(from)} to ${fy(to)}`}` : "";
    $("count").textContent = `${shown.length} tournament${shown.length === 1 ? "" : "s"} in ${byCity.size} cit${byCity.size === 1 ? "y" : "ies"}${range}${unplaced ? ` (${unplaced} not yet on the map)` : ""}.`;
  }

  $("list").addEventListener("click", ev => {
    const a = ev.target.closest("a[data-city]"); if (!a) return;
    const c = cities[a.dataset.city]; map.setView([c.lat, c.lon], 6);
    layer.eachLayer(m => { const ll = m.getLatLng(); if (ll.lat === c.lat && ll.lng === c.lon) m.openPopup(); });
  });
  $("presets").addEventListener("click", ev => {
    const a = ev.target.closest("a[data-preset]"); if (!a) return;
    ev.preventDefault();
    const mon = local(monday(day(today)));
    const set = (f, t) => { $("from").value = f; $("to").value = t; };
    if (a.dataset.preset === "week") set(day(mon), day(new Date(mon.getTime() + 6 * 864e5)));
    else if (a.dataset.preset === "eight") set(day(today), day(new Date(today.getTime() + 56 * 864e5)));
    else set(seasonFrom, seasonTo);
    render();
  });
  for (const el of document.querySelectorAll("#f input, #f select")) el.addEventListener(el.id === "q" ? "input" : "change", render);
  $("meta").textContent = `${data.season} season, ${events.length} tournaments and ties (combined men's and women's events counted once)${cancelled.length ? `, plus ${cancelled.length} announced and then cancelled (${cancelled.map(e => e.name).join(", ")}), not shown` : ""}, from Wikipedia's ${data.season} ATP Tour, WTA Tour, ATP Challenger Tour, WTA 125, ITF World Tennis Tour, Davis Cup, and Billie Jean King Cup pages, read on ${data.generated}.`;
  render();
})();
