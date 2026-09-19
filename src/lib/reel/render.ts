import type { Packet, PacketChip, PacketSlot, PacketStill } from "./packet";

/**
 * The packet, as one HTML file.
 *
 * Constraints that shape every line below: it is opened by a stranger, on a
 * machine nobody controls, possibly offline, possibly on a phone, and possibly
 * printed. So there is no script from a CDN, no webfont, no fetch and no image
 * that is not already inside the file. The only URLs in the document are the
 * Drive links the editor is meant to click.
 *
 * Light, not dark. The document gets printed and scribbled on, and a dark
 * packet either wastes a cartridge or comes out unreadable.
 */

function esc(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A link the packet is willing to print: http(s) only, so no javascript: slips in. */
function safeUrl(url: string | null): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}

function link(url: string | null, text: string, className = "link"): string {
  const href = safeUrl(url);
  if (!href) return "";
  return `<a class="${className}" href="${esc(href)}" data-url="${esc(href)}" target="_blank" rel="noreferrer noopener">${esc(text)}</a>`;
}

function chipHtml(chip: PacketChip, where: string): string {
  const detail = chip.detail ? `<p class="chip-detail">${esc(chip.detail)}</p>` : "";
  const at = chip.at ? `<span class="chip-at">${esc(chip.at)}</span>` : "";
  const clip = chip.clip ? `<span class="chip-clip">${esc(chip.clip)}</span>` : "";
  const high =
    chip.priority === "high" ? `<span class="chip-high">must not be missed</span>` : "";
  const also =
    chip.ids.length > 1
      ? `<span class="chip-also">said on ${chip.ids.length} shots, so it is a rule for the whole reel</span>`
      : "";

  return `<li class="chip${chip.done ? " is-done" : ""}">
  <label>
    <input type="checkbox" data-id="${esc(chip.id)}" data-where="${esc(where)}" data-kind="${esc(chip.type_label.toLowerCase())}"${chip.done ? " checked" : ""}>
    <span class="chip-body">
      <span class="chip-line">
        <span class="chip-type" style="--tint:${esc(chip.color)}">${esc(chip.type_label)}</span>
        <span class="chip-title">${esc(chip.title)}</span>
      </span>
      <span class="chip-meta">${at}${clip}${high}${also}</span>
      ${detail}
    </span>
  </label>
</li>`;
}

function stillHtml(still: PacketStill): string {
  const picture = still.data_uri
    ? `<img src="${still.data_uri}" alt="${esc(still.label)}" width="360">`
    : `<div class="still-empty">No frame available</div>`;
  return `<figure class="still still-${esc(still.kind)}">${picture}<figcaption>${esc(still.label)}</figcaption></figure>`;
}

function slotHtml(slot: PacketSlot): string {
  const stills = slot.stills.length
    ? `<div class="stills${slot.stills.length === 1 ? " stills-one" : ""}">${slot.stills.map(stillHtml).join("")}</div>`
    : "";
  const note = slot.note ? `<p class="slot-note">${esc(slot.note)}</p>` : "";
  const warnings = slot.warnings.length
    ? `<ul class="warnings">${slot.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`
    : "";
  const instructions = slot.instructions.length
    ? `<ul class="chips">${slot.instructions.map((chip) => chipHtml(chip, `slot ${slot.number}`)).join("")}</ul>`
    : `<p class="quiet">Nothing specific was said about this shot. Cut it as it is.</p>`;
  const title = slot.app_title
    ? `<span class="slot-alias">called &ldquo;${esc(slot.app_title)}&rdquo; in the app</span>`
    : "";
  const missing = slot.missing
    ? `<p class="alarm">This clip is missing from the workspace. Ask before you cut it.</p>`
    : "";

  return `<section class="slot" id="slot-${esc(slot.id)}">
  <div class="slot-head">
    <span class="slot-num">${slot.number}</span>
    <div class="slot-id">
      <h2 class="slot-file">${esc(slot.source_name)}</h2>
      <p class="slot-range">${esc(slot.range_label)}</p>
      <p class="slot-meta">
        <span>at ${esc(slot.reel_start_tc)} in the reel</span>
        <span>${esc(slot.size_label)}</span>
        <span>${esc(slot.snap_label)}</span>
        ${title}
      </p>
      ${link(slot.link_url, slot.link_label, "link slot-link")}
    </div>
  </div>
  ${missing}
  ${stills}
  ${note}
  ${instructions}
  <p class="audio"><span class="audio-tag">Sound</span>${esc(slot.audio)}</p>
  ${warnings}
</section>`;
}

function style(): string {
  return `:root{
  --ink:#14161a; --soft:#5b6270; --faint:#878e9b;
  --line:#e3e6ec; --bg:#f4f5f8; --card:#fff; --hair:#f0f2f5;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0; background:var(--bg); color:var(--ink);
  font:16px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  padding:32px 16px 80px;
}
.page{max-width:840px;margin:0 auto}
h1,h2,h3{margin:0;font-weight:650;letter-spacing:-0.01em}
h1{font-size:30px;line-height:1.15}
a{color:inherit}
.link{
  display:inline-block;font-weight:600;font-size:14px;text-decoration:none;
  border:1px solid var(--line);border-radius:999px;padding:7px 14px;background:var(--card);
}
.link:hover{border-color:var(--ink)}
.kicker{margin:0 0 6px;font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:var(--faint)}
.head{margin-bottom:34px}
.lede{margin:10px 0 0;font-size:17px;color:var(--soft);max-width:60ch}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin:22px 0 18px;padding:0}
.facts div{margin:0}
.facts dt{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
.facts dd{margin:3px 0 0;font-size:17px;font-weight:600}
.facts .sub{display:block;font-size:13px;font-weight:400;color:var(--soft)}
.bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:4px}
.block{margin:0 0 30px;padding:22px;background:var(--card);border:1px solid var(--line);border-radius:14px}
.block > h2{font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:var(--faint);margin-bottom:14px}
.pairs{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px 26px;margin:0}
.pairs dt{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
.pairs dd{margin:2px 0 0;white-space:pre-wrap}
.slot{margin:0 0 24px;padding:24px;background:var(--card);border:1px solid var(--line);border-radius:14px}
.slot-head{display:flex;gap:18px;align-items:flex-start}
.slot-num{
  flex:none;width:52px;height:52px;border-radius:12px;background:var(--ink);color:#fff;
  font-size:24px;font-weight:650;display:flex;align-items:center;justify-content:center;
}
.slot-id{min-width:0}
.slot-file{
  font-size:18px;word-break:break-all;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:600;
}
.slot-range{margin:6px 0 0;font-size:20px;font-weight:650}
.slot-meta{margin:6px 0 12px;font-size:13px;color:var(--soft);display:flex;flex-wrap:wrap;gap:4px 14px}
.slot-alias{color:var(--faint)}
.stills{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:18px 0}
.stills-one{grid-template-columns:minmax(0,320px)}
.still{margin:0}
.still img{display:block;width:100%;height:auto;border-radius:10px;background:var(--hair)}
.still-empty{
  border:1px dashed var(--line);border-radius:10px;padding:28px 12px;text-align:center;
  color:var(--faint);font-size:13px;
}
.still figcaption{margin-top:7px;font-size:12px;color:var(--soft)}
.still-nearest figcaption{color:#8a5a12}
.slot-note{
  margin:16px 0 0;padding:14px 16px;background:var(--hair);border-radius:10px;
  font-size:17px;white-space:pre-wrap;
}
.chips{list-style:none;margin:16px 0 0;padding:0;display:grid;gap:8px}
.chip{border:1px solid var(--line);border-radius:10px}
.chip label{display:flex;gap:12px;padding:12px 14px;cursor:pointer;align-items:flex-start}
.chip input{flex:none;width:19px;height:19px;margin:2px 0 0;accent-color:#14161a}
.chip-body{min-width:0}
.chip-line{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}
.chip-type{
  flex:none;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
  padding:3px 8px;border-radius:999px;border-left:3px solid var(--tint);background:var(--hair);
}
.chip-title{font-weight:600}
.chip-meta{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;color:var(--faint);margin-top:4px}
.chip-high{color:#a32d1a;font-weight:600}
.chip-detail{margin:6px 0 0;color:var(--soft);white-space:pre-wrap}
.chip.is-done .chip-title,.chip.is-done .chip-detail{text-decoration:line-through;color:var(--faint)}
.audio{margin:18px 0 0;font-size:14px;color:var(--soft);display:flex;gap:10px;flex-wrap:wrap}
.audio-tag{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
.warnings{margin:12px 0 0;padding-left:20px;font-size:13px;color:#8a5a12}
.alarm{margin:14px 0 0;padding:12px 14px;border-radius:10px;background:#fdf0ec;color:#a32d1a;font-weight:600}
.quiet{margin:14px 0 0;color:var(--faint)}
.rows{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.rows li{display:flex;gap:10px;flex-wrap:wrap;align-items:baseline;padding-bottom:10px;border-bottom:1px solid var(--hair)}
.rows li:last-child{border-bottom:0;padding-bottom:0}
.foot{margin-top:34px;font-size:13px;color:var(--soft);display:grid;gap:8px}
.foot p{margin:0;max-width:72ch}
button{
  font:inherit;font-size:14px;font-weight:600;padding:7px 14px;border-radius:999px;
  border:1px solid var(--line);background:var(--card);color:inherit;cursor:pointer;
}
button:hover{border-color:var(--ink)}
#progress{font-size:13px;color:var(--soft)}
@media (max-width:640px){
  body{padding:20px 14px 60px}
  h1{font-size:25px}
  .block,.slot{padding:16px}
  .stills{grid-template-columns:1fr}
  .slot-head{gap:12px}
  .slot-num{width:42px;height:42px;font-size:20px}
  .slot-range{font-size:18px}
}
@media print{
  body{background:#fff;padding:0;font-size:11.5pt}
  .block,.slot{border-color:#ccc;break-inside:avoid;page-break-inside:avoid}
  .actions,button,#progress{display:none}
  .link{border:0;padding:0;text-decoration:underline}
  a[data-url]::after{content:" " attr(data-url);font-size:9pt;word-break:break-all;color:#555}
  .slot-num{background:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
}`;
}

function script(tickKey: string): string {
  // Ticks belong to the editor's browser and are keyed on the instruction id,
  // so reordering the reel or shipping v5 never wipes their work. Nothing here
  // leaves the page: there is no endpoint to send it to.
  return `(function(){
  var KEY=${JSON.stringify(tickKey)};
  var boxes=[].slice.call(document.querySelectorAll('input[type=checkbox][data-id]'));
  var out=document.getElementById('progress');
  var button=document.getElementById('copy');
  function read(){try{return JSON.parse(localStorage.getItem(KEY)||'{}')||{};}catch(e){return {};}}
  function write(state){try{localStorage.setItem(KEY,JSON.stringify(state));}catch(e){}}
  function paint(){
    var done=0;
    boxes.forEach(function(box){
      if(box.checked)done++;
      box.closest('.chip').classList.toggle('is-done',box.checked);
    });
    if(out)out.textContent=done+' of '+boxes.length+' done';
    return done;
  }
  var saved=read();
  boxes.forEach(function(box){
    var id=box.getAttribute('data-id');
    if(Object.prototype.hasOwnProperty.call(saved,id))box.checked=!!saved[id];
    box.addEventListener('change',function(){
      var next=read();
      if(box.checked)next[id]=1;else next[id]=0;
      write(next);paint();
    });
  });
  function summary(){
    var done=paint();
    var open=boxes.filter(function(b){return !b.checked;}).map(function(b){
      return b.getAttribute('data-where')+' '+b.getAttribute('data-kind');
    });
    return done+' of '+boxes.length+' done'+(open.length?', open: '+open.slice(0,10).join('; '):', all done');
  }
  function flash(text){
    if(!button)return;
    var was=button.textContent;button.textContent=text;
    setTimeout(function(){button.textContent=was;},1800);
  }
  function fallback(text){
    var area=document.createElement('textarea');
    area.value=text;area.style.position='fixed';area.style.opacity='0';
    document.body.appendChild(area);area.select();
    var ok=false;try{ok=document.execCommand('copy');}catch(e){ok=false;}
    document.body.removeChild(area);
    flash(ok?'Copied':'Copy blocked, read it off the page');
  }
  if(button)button.addEventListener('click',function(){
    var text=summary();
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){flash('Copied');},function(){fallback(text);});
    }else{fallback(text);}
  });
  paint();
})();`;
}

export function renderPacket(packet: Packet): string {
  const title = `${packet.project.name}, edit packet v${packet.packet_rev}`;

  const brief = packet.brief.pairs.length
    ? `<section class="block">
  <h2>The brief</h2>
  <dl class="pairs">${packet.brief.pairs
    .map(
      (pair) =>
        `<div><dt>${esc(pair.label)}</dt><dd>${esc(pair.value)}</dd></div>`,
    )
    .join("")}</dl>
</section>`
    : "";

  const wholeReel = packet.whole_reel.length
    ? `<section class="block">
  <h2>Applies to the whole reel</h2>
  <ul class="chips">${packet.whole_reel.map((chip) => chipHtml(chip, "whole reel")).join("")}</ul>
</section>`
    : "";

  const slots = packet.slots.length
    ? packet.slots.map(slotHtml).join("\n")
    : `<section class="block"><h2>The reel</h2><p class="quiet">No shots have been put in order yet.</p></section>`;

  const orphans = packet.orphans.length
    ? `<section class="block">
  <h2>Also said, but not inside a slot</h2>
  <p class="quiet">These were said against footage that the current order trims away. They are here so nothing goes missing, not because they are part of the cut.</p>
  <ul class="chips">${packet.orphans.map((chip) => chipHtml(chip, "outside the slots")).join("")}</ul>
</section>`
    : "";

  const folder = link(packet.footage_url, "Open the footage folder");

  const skipped = packet.counts.skipped
    ? `<p>${packet.counts.skipped} instruction${packet.counts.skipped === 1 ? "" : "s"} the creator cancelled ${packet.counts.skipped === 1 ? "is" : "are"} not shown.</p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${style()}</style>
</head>
<body>
<main class="page">

<header class="head">
  <p class="kicker">Edit packet, version ${packet.packet_rev}</p>
  <h1>${esc(packet.project.name)}</h1>
  ${packet.project.summary ? `<p class="lede">${esc(packet.project.summary)}</p>` : ""}
  <dl class="facts">
    <div>
      <dt>Runtime</dt>
      <dd>${esc(packet.runtime.total_label)}<span class="sub">${esc(packet.runtime.target_label)} for a ${esc(packet.project.niche_label.toLowerCase())}, ${esc(packet.runtime.verdict.toLowerCase())}</span></dd>
    </div>
    <div>
      <dt>Shots</dt>
      <dd>${packet.counts.slots}<span class="sub">median hold ${esc(packet.runtime.median_hold_label)}, ${esc(packet.runtime.hold_target_label)} suits this kind of reel</span></dd>
    </div>
    <div>
      <dt>Built</dt>
      <dd>${esc(packet.built_label)}<span class="sub">from the reel as it stood then</span></dd>
    </div>
    <div>
      <dt>Version</dt>
      <dd>v${packet.packet_rev}<span class="sub">a higher version in the folder replaces this file</span></dd>
    </div>
  </dl>
  <div class="bar actions">
    ${folder}
    <button id="copy" type="button">Copy progress</button>
    <span id="progress"></span>
  </div>
  ${folder ? "" : `<p class="alarm">No footage folder link was set, so the files have to be found by name.</p>`}
</header>

${brief}
${wholeReel}
${slots}
${orphans}

<section class="block">
  <h2>Sound</h2>
  <p>${esc(packet.music.line)}</p>
</section>

<footer class="foot">
  <p>Footage outside a slot's in and out does not reach the reel: everything before the in point and after the out point is dropped. The times are guidance, accurate to about 0.2s, because the shot boundaries come from a 5 fps scan, so trust your eye on the exact frame.</p>
  ${skipped}
  <p>The tick boxes are saved in this browser only, on this machine. They are not sent anywhere, and clearing your browser data clears them.</p>
</footer>

</main>
<script>${script(packet.tick_key)}</script>
</body>
</html>
`;
}
