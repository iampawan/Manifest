// Build a single self-contained HTML docs hub from the manifest repo's
// markdown — sidebar nav, search, cross-doc links, rendered offline-embedded
// content (marked + highlight.js load from CDN at view time).
//
// Usage (from repo root): node scripts/build-docs.mjs
//   node scripts/build-docs.mjs [repo-root] [out.html]
// Defaults: repo-root = the repo this script lives in;
//           out.html   = <repo-root>/docs/manifest-docs.html
//
// Run it as the last step of a release so the hub tracks the docs. New
// docs/releases/*.md files are picked up automatically.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url))); // scripts/.. = repo root
const ROOT = process.argv[2] || REPO;
const OUT = process.argv[3] || join(ROOT, "docs", "manifest-docs.html");

// Release notes are auto-discovered (newest first) so a new release shows up
// without editing this script.
let releaseFiles = [];
try {
  releaseFiles = readdirSync(join(ROOT, "docs", "releases"))
    .filter((f) => f.endsWith(".md"))
    .sort().reverse()
    .map((f) => `docs/releases/${f}`);
} catch { /* no releases dir */ }

const SECTIONS = [
  { title: "Overview", files: ["QUICKSTART.md", "README.md", "GUIDE.md", "CHANGELOG.md", "CONTRIBUTING.md"] },
  { title: "Reference", files: [
    "reference/CONTRACT-FORMAT.md", "reference/CRITIC-RULES.md", "reference/CRITIC-PROTOCOL.md",
    "reference/BUG-PATTERNS.md", "reference/bug-patterns.candidates.md",
    "reference/STACK-PROFILES.md", "reference/PR-COMMENT-STYLE.md",
    "reference/RECOMMENDED-LINT-RULES.md",
  ] },
  { title: "Guides", files: [
    "docs/INSTALL-FOR-TRYERS.md", "docs/RELIABILITY.md",
    "docs/PUBLISH-CHECKLIST.md", "docs/superseded-critic-sizing.md",
  ] },
  { title: "Proposals", files: [
    "docs/proposals/model-tiering-and-advisor.md",
    "docs/proposals/next-features-roadmap.md",
  ] },
  { title: "Releases", files: releaseFiles },
];

const slug = (p) => p.replace(/[\/.]/g, "-").replace(/-md$/, "");
const titleOf = (md, p) => {
  const m = md.split("\n").find((l) => /^#\s+/.test(l));
  return m ? m.replace(/^#\s+/, "").trim() : basename(p);
};

let version = "";
try { version = JSON.parse(readFileSync(join(ROOT, ".claude-plugin/plugin.json"), "utf8")).version; } catch {}

const sections = [];
let docCount = 0;
for (const sec of SECTIONS) {
  const docs = [];
  for (const f of sec.files) {
    let md;
    try { md = readFileSync(join(ROOT, f), "utf8"); } catch { continue; }
    docs.push({ id: slug(f), path: f, base: basename(f), title: titleOf(md, f), md });
    docCount++;
  }
  if (docs.length) sections.push({ title: sec.title, docs });
}

const data = { version, generated: new Date().toISOString().slice(0, 10), docCount, sections };
// Safe embed: neutralize any </script> or HTML-comment sequences in JSON.
const json = JSON.stringify(data).replace(/</g, "\\u003c").replace(/-->/g, "--\\u003e");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Manifest — Documentation</title>
<link rel="stylesheet" media="(prefers-color-scheme: light)" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css">
<link rel="stylesheet" media="(prefers-color-scheme: dark)" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
<style>
  :root{
    --bg:#ffffff; --bg-2:#f7f7f5; --line:#e7e6e1; --ink:#1a1a18; --muted:#6b6a64;
    --accent:#bd5d3a; --accent-soft:#f3e6df; --code-bg:#f5f4f1; --sidebar:#faf9f6;
  }
  @media (prefers-color-scheme: dark){
    :root{ --bg:#16161a; --bg-2:#1d1d22; --line:#2c2c33; --ink:#e9e8e4; --muted:#9b9a92;
      --accent:#e08a64; --accent-soft:#2a2320; --code-bg:#1d1d22; --sidebar:#131316; }
  }
  *{box-sizing:border-box}
  html,body{margin:0;height:100%}
  body{font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    color:var(--ink); background:var(--bg);}
  a{color:var(--accent); text-decoration:none}
  a:hover{text-decoration:underline}
  .app{display:grid; grid-template-columns:300px 1fr; height:100vh}
  /* sidebar */
  .side{background:var(--sidebar); border-right:1px solid var(--line); overflow-y:auto; padding:0}
  .brand{position:sticky; top:0; background:var(--sidebar); padding:18px 20px 12px; border-bottom:1px solid var(--line); z-index:2}
  .brand h1{margin:0; font-size:17px; letter-spacing:.2px; display:flex; align-items:center; gap:8px}
  .badge{font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--accent);
    background:var(--accent-soft); padding:4px 7px; border-radius:6px}
  .brand .meta{color:var(--muted); font-size:12px; margin-top:4px}
  .search{width:100%; margin-top:12px; padding:8px 10px; border:1px solid var(--line);
    border-radius:8px; background:var(--bg); color:var(--ink); font-size:13px}
  nav{padding:10px 12px 40px}
  .group{margin:10px 4px 4px; font:600 11px/1 ui-monospace,monospace; letter-spacing:.12em;
    text-transform:uppercase; color:var(--muted)}
  nav a{display:block; padding:6px 10px; border-radius:7px; color:var(--ink); font-size:13.5px}
  nav a:hover{background:var(--bg-2); text-decoration:none}
  nav a.active{background:var(--accent-soft); color:var(--accent); font-weight:600}
  nav a.hide{display:none}
  a.start{display:block; margin:12px 12px 6px; padding:11px 12px; border-radius:9px;
    background:var(--accent); color:#fff; font-weight:600; font-size:13.5px; text-align:center;
    box-shadow:0 1px 0 rgba(0,0,0,.04)}
  a.start:hover{text-decoration:none; filter:brightness(1.06)}
  a.start.active{background:var(--accent); color:#fff}
  a.start small{display:block; font-weight:500; opacity:.85; font-size:11px; margin-top:2px}
  /* content */
  .main{overflow-y:auto; height:100vh}
  .doc{max-width:820px; margin:0 auto; padding:40px 48px 120px}
  .crumbs{color:var(--muted); font:12px ui-monospace,monospace; margin-bottom:18px}
  .doc h1{font-size:28px; line-height:1.2; margin:.2em 0 .6em; border-bottom:1px solid var(--line); padding-bottom:.3em}
  .doc h2{font-size:21px; margin:1.8em 0 .5em; padding-top:.3em}
  .doc h3{font-size:17px; margin:1.4em 0 .4em}
  .doc h4{font-size:15px; margin:1.2em 0 .3em; color:var(--muted)}
  .doc p,.doc li{font-size:15px}
  .doc code{background:var(--code-bg); padding:.12em .4em; border-radius:5px;
    font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
  .doc pre{background:var(--code-bg); border:1px solid var(--line); border-radius:10px;
    padding:14px 16px; overflow:auto}
  .doc pre code{padding:0; font-size:13px; line-height:1.5}
  /* let the themed pre background show through; the hljs theme only colors tokens */
  .doc pre code.hljs,.doc pre code{background:transparent !important}
  .doc table{border-collapse:collapse; width:100%; margin:1em 0; font-size:13.5px; display:block; overflow:auto}
  .doc th,.doc td{border:1px solid var(--line); padding:7px 10px; text-align:left}
  .doc th{background:var(--bg-2)}
  .doc blockquote{margin:1em 0; padding:.4em 1em; border-left:3px solid var(--accent);
    background:var(--bg-2); color:var(--muted); border-radius:0 8px 8px 0}
  .doc img{max-width:100%}
  .doc hr{border:none; border-top:1px solid var(--line); margin:2em 0}
  .empty{color:var(--muted); padding:60px; text-align:center}
  .menu-btn{display:none}
  @media (max-width:820px){
    .app{grid-template-columns:1fr}
    .side{position:fixed; inset:0 40% 0 0; transform:translateX(-100%); transition:.2s; z-index:9}
    .side.open{transform:none}
    .menu-btn{display:inline-flex; position:fixed; top:12px; left:12px; z-index:10;
      background:var(--accent); color:#fff; border:none; border-radius:8px; padding:8px 12px; font-size:14px}
    .doc{padding:64px 20px 100px}
  }
</style>
</head>
<body>
<button class="menu-btn" onclick="document.querySelector('.side').classList.toggle('open')">☰ Docs</button>
<div class="app">
  <aside class="side">
    <div class="brand">
      <h1>Manifest <span class="badge" id="ver"></span></h1>
      <div class="meta" id="meta"></div>
      <input class="search" id="search" placeholder="Filter docs… (/)" autocomplete="off">
    </div>
    <nav id="nav"></nav>
  </aside>
  <main class="main">
    <article class="doc" id="doc"><div class="empty">Loading…</div></article>
  </main>
</div>
<script id="docdata" type="application/json">${json}</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.0/marked.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<script>
(function(){
  var DATA = JSON.parse(document.getElementById('docdata').textContent);
  var byId = {}, byBase = {};
  DATA.sections.forEach(function(s){ s.docs.forEach(function(d){ byId[d.id]=d; byBase[d.base]=d; }); });
  document.getElementById('ver').textContent = 'v' + (DATA.version||'');
  document.getElementById('meta').textContent = DATA.docCount + ' documents · generated ' + DATA.generated;

  // sidebar — pin a prominent "Start here" CTA at the top for onboarding
  var nav = document.getElementById('nav');
  var startDoc = byBase['QUICKSTART.md'];
  if (startDoc){
    var sa=document.createElement('a'); sa.className='start'; sa.href='#'+startDoc.id;
    sa.innerHTML='★ Start here<small>5-minute quickstart — new to Manifest?</small>';
    sa.dataset.id=startDoc.id; sa.dataset.search='start here quickstart onboarding getting started new';
    nav.appendChild(sa);
  }
  DATA.sections.forEach(function(s){
    var docs=s.docs.filter(function(d){ return !startDoc || d.id!==startDoc.id; });
    if(!docs.length) return;
    var g = document.createElement('div'); g.className='group'; g.textContent=s.title; nav.appendChild(g);
    docs.forEach(function(d){
      var a=document.createElement('a'); a.href='#'+d.id; a.textContent=d.title;
      a.dataset.id=d.id; a.dataset.search=(d.title+' '+d.path).toLowerCase(); nav.appendChild(a);
    });
  });

  if (window.marked) marked.setOptions({ gfm:true, breaks:false });

  function render(id){
    var d = byId[id] || DATA.sections[0].docs[0];
    var el = document.getElementById('doc');
    el.innerHTML = '<div class="crumbs">'+d.path+'</div>' + marked.parse(d.md);
    // heading anchors
    el.querySelectorAll('h1,h2,h3,h4').forEach(function(h){
      if(!h.id) h.id = h.textContent.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
    });
    // rewrite cross-doc .md links to in-page hashes
    el.querySelectorAll('a[href]').forEach(function(a){
      var href=a.getAttribute('href'); if(!href) return;
      var b=href.split('/').pop().split('#')[0];
      if(byBase[b]) a.setAttribute('href','#'+byBase[b].id);
      else if(/^https?:/.test(href)) a.target='_blank';
    });
    // highlight
    if(window.hljs) el.querySelectorAll('pre code').forEach(function(c){ try{hljs.highlightElement(c);}catch(e){} });
    // active link
    document.querySelectorAll('nav a').forEach(function(a){ a.classList.toggle('active', a.dataset.id===d.id); });
    document.querySelector('.main').scrollTop=0;
    var act=document.querySelector('nav a.active'); if(act) act.scrollIntoView({block:'nearest'});
    document.title = d.title + ' — Manifest Docs';
    document.querySelector('.side').classList.remove('open');
  }

  window.addEventListener('hashchange', function(){ render(location.hash.slice(1)); });
  render(location.hash.slice(1) || DATA.sections[0].docs[0].id);

  // search filter
  var search=document.getElementById('search');
  search.addEventListener('input', function(){
    var q=this.value.toLowerCase().trim();
    document.querySelectorAll('nav a').forEach(function(a){
      a.classList.toggle('hide', q && a.dataset.search.indexOf(q)===-1);
    });
    document.querySelectorAll('.group').forEach(function(g){
      var n=g.nextElementSibling, any=false;
      while(n && n.tagName==='A'){ if(!n.classList.contains('hide')) any=true; n=n.nextElementSibling; }
      g.style.display = any || !q ? '' : 'none';
    });
  });
  document.addEventListener('keydown', function(e){
    if(e.key==='/' && document.activeElement!==search){ e.preventDefault(); search.focus(); }
  });
})();
</script>
</body>
</html>`;

writeFileSync(OUT, html);
console.log("wrote " + OUT + " — " + docCount + " docs, " + (html.length/1024).toFixed(0) + " KB");
