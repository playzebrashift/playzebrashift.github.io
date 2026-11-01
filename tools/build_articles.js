// Build the articles: one guide per picture type, written from the game's own pictures and explanations.
// Writes articles/*.html, articles/img/*.jpg, sitemap.xml and robots.txt (needs Playwright and Pillow).
// Usage: node tools/build_articles.js   (run tools/build_app.py first so index.html is current)
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'articles'), IMG = path.join(OUT, 'img');
const SITE = 'https://playzebrashift.github.io/';

const GUIDES = [
  { slug: 'ecg-patterns', kinds: ['ecg'], title: 'ECG patterns to know', h1: 'ECG patterns to know',
    desc: '12-lead ECG patterns every emergency clinician should recognise, from STEMI and hyperkalaemia to torsades and Wellens, each with what to look for and what it is often mistaken for.',
    intro: ['Each tracing below is a full 12-lead layout at 25 mm/s and 10 mm/mV, with a long rhythm strip of lead II underneath. Find the pattern first, then check what it is most often confused with.',
      'Read the rhythm and rate, then the intervals, then the ST segments and T waves, lead by lead. Most of the patterns here are one clear finding against an otherwise ordinary ECG.'] },
  { slug: 'ultrasound-signs', kinds: ['us'], title: 'Bedside ultrasound signs', h1: 'Bedside ultrasound signs',
    desc: 'Point-of-care ultrasound signs for the emergency department: AAA, cholecystitis, ectopic pregnancy, FAST, DVT, the barcode sign, testicular torsion and more, explained.',
    intro: ['Ultrasound shows fluid as black (anechoic), stones and bone as bright with a dark shadow behind them, and solid organs as grey speckle. Almost every sign below is one of those three ideas.',
      'The probe marker and labels sit at the top of each scan, and the depth scale in centimetres runs down the right-hand side.'] },
  { slug: 'microscopy', kinds: ['mic'], title: 'Microscope slides to recognise', h1: 'Microscope slides to recognise',
    desc: 'Blood films, Gram stains, CSF preparations, joint fluid and urine microscopy: malaria, schistocytes, Gram-negative diplococci, urate crystals, casts and more, explained.',
    intro: ['These are the slides that change management at the bedside: a parasite on a blood film, organisms in CSF, crystals in a joint or casts in the urine.',
      'Look at the background first (which stain or preparation it is), then at the cells, then at anything that should not be there.'] },
  { slug: 'blood-gases-and-lab-patterns', kinds: ['abg', 'lab'], title: 'Blood gas and lab patterns', h1: 'Blood gas and lab patterns',
    desc: 'How to read blood gases and lab panels in the emergency department: DKA, toxic alcohols, mixed salicylate gases, CSF patterns in meningitis and Guillain–Barré, adrenal crisis, tumour lysis and more.',
    intro: ['For a blood gas, start with the pH, then decide whether the CO₂ or the bicarbonate explains it, then calculate the anion gap: Na⁺ − (Cl⁻ + HCO₃⁻), normally about 8–12 mmol/L.',
      'For other panels, look for the pattern rather than any single number. H marks a high result, L a low one, and * an abnormal result without a numeric range.'] },
  { slug: 'x-rays', kinds: ['xr'], title: 'X-ray findings to spot', h1: 'X-ray findings to spot',
    desc: 'Chest and abdominal X-ray findings for the emergency department: pneumothorax, pulmonary oedema, consolidation, a widened mediastinum, free air and small bowel obstruction.',
    intro: ['Use the same order every time: check it is the right patient and film, then look at the airway, lungs and pleura, the heart and mediastinum, the diaphragm and anything below it, and finally the bones and soft tissues.'] }
];

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

function page({ title, desc, url, body, img, ld }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article"><meta property="og:site_name" content="Zebra Shift">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${url}">
${img ? `<meta property="og:image" content="${img}"><meta name="twitter:card" content="summary_large_image">` : ''}
<meta name="theme-color" content="#1C6973">
<link rel="icon" href="../icons/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&display=swap">
<link rel="stylesheet" href="articles.css">
${ld ? `<script type="application/ld+json">${JSON.stringify(ld)}</script>` : ''}
</head>
<body>
<header class="top"><a class="brand" href="../"><img src="../icons/favicon.svg" alt="" width="28" height="28">Zebra Shift</a><nav><a href="./">Articles</a><a class="play" href="../#hunt">Play today's hunt</a></nav></header>
<main>${body}</main>
<footer><p><b>For education and entertainment only.</b> Not medical advice, and no substitute for clinical judgement or local guidelines. The pictures are drawn by the game for teaching, not taken from patients.</p>
<p><a href="../">Play Zebra Shift</a> · <a href="./">All articles</a> · <a href="../privacy.html">Privacy</a></p></footer>
</body>
</html>
`;
}

(async () => {
  fs.mkdirSync(IMG, { recursive: true });
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1200, height: 1000 } });
  p.on('pageerror', e => console.error('page error:', e.message));
  await p.goto('file://' + path.join(ROOT, 'index.html')); await p.waitForTimeout(900);
  const { READS, USED, KIND } = await p.evaluate(() => {
    const used = {};
    for (const [n, a] of Object.entries(READ_AT)) for (const [, , k] of a) (used[k] = used[k] || []).push(n);
    return { READS: Object.fromEntries(Object.entries(READS).map(([k, r]) => [k, { k: r.k, o: r.o, x: r.x, title: readTitle(k) }])), USED: used, KIND: RD_KIND };
  });
  // every picture drawn by the game at the width a player sees it
  for (const k of Object.keys(READS)) {
    await p.evaluate(k => {
      let h = document.getElementById('artpic');
      if (!h) { h = document.createElement('div'); h.id = 'artpic'; h.style.cssText = 'position:fixed;left:0;top:0;z-index:9999;background:#fff;padding:8px'; document.body.appendChild(h); }
      const kind = READS[k].k, dark = !['ecg', 'abg', 'lab'].includes(kind);
      h.style.width = kind === 'ecg' ? '1100px' : kind === 'abg' || kind === 'lab' ? '480px' : dark ? '440px' : '456px';
      h.style.padding = dark ? '0' : '8px'; h.style.background = dark ? '#000' : '#fff';
      h.innerHTML = readImage(k); const z = h.querySelector('.rdzoom'); if (z) z.remove();
    }, k);
    await p.waitForTimeout(60);
    await (await p.$('#artpic')).screenshot({ path: path.join(IMG, k + '.png') });
  }
  await b.close();
  execFileSync('python3', ['-c', `import glob,os
from PIL import Image
for f in glob.glob(${JSON.stringify(IMG)}+'/*.png'):
    im=Image.open(f).convert('RGB');im.save(f[:-4]+'.jpg',quality=84,optimize=True);os.remove(f)`]);
  const size = k => execFileSync('python3', ['-c', `from PIL import Image;im=Image.open(${JSON.stringify(path.join(IMG, k + '.jpg'))});print(im.width,im.height)`]).toString().trim().split(' ').map(Number);

  const today = new Date().toISOString().slice(0, 10), urls = [SITE, SITE + 'articles/'];
  for (const g of GUIDES) {
    const keys = Object.keys(READS).filter(k => g.kinds.includes(READS[k].k));
    const url = `${SITE}articles/${g.slug}.html`; urls.push(url);
    const sections = keys.map(k => {
      const r = READS[k], [w, h] = size(k), used = USED[k] || [];
      return `<section class="item ${r.k}" id="${slugify(r.o[0])}">
<h2>${esc(r.o[0])}</h2>
<figure><img src="img/${k}.jpg" alt="${esc(r.title + ': ' + r.o[0])}" width="${w}" height="${h}" loading="lazy" decoding="async"><figcaption>${esc(r.title)}</figcaption></figure>
<p>${esc(r.x)}</p>
<p class="conf"><b>Often confused with:</b> ${r.o.slice(1).map(esc).join(' · ')}</p>
${used.length ? `<p class="seen">In the game: ${used.map(esc).join(', ')}</p>` : ''}
</section>`;
    }).join('\n');
    const body = `<article>
<p class="kicker">Zebra Shift guide · ${keys.length} pictures</p>
<h1>${esc(g.h1)}</h1>
${g.intro.map(t => `<p class="lede">${esc(t)}</p>`).join('\n')}
<nav class="toc" aria-label="In this guide"><ol>${keys.map(k => `<li><a href="#${slugify(READS[k].o[0])}">${esc(READS[k].o[0])}</a></li>`).join('')}</ol></nav>
${sections}
<aside class="cta"><h2>Practise them for real</h2><p>Every picture here also turns up during shifts in Zebra Shift, an ER game for clinicians and the curious. Read them in the Reading room, or try today's seven-patient Zebra Hunt.</p>
<p><a class="btn" href="../#reads">Open the Reading room</a> <a class="btn alt" href="../#hunt">Play today's hunt</a></p></aside>
</article>`;
    const ld = { '@context': 'https://schema.org', '@type': 'Article', headline: g.title, description: g.desc, dateModified: today, image: `${SITE}articles/img/${keys[0]}.jpg`, publisher: { '@type': 'Organization', name: 'Zebra Shift' }, mainEntityOfPage: url };
    fs.writeFileSync(path.join(OUT, g.slug + '.html'), page({ title: `${g.title}: ${keys.length} explained · Zebra Shift`, desc: g.desc, url, body, img: `${SITE}articles/img/${keys[0]}.jpg`, ld }));
  }
  // the hub
  const hub = `<article>
<p class="kicker">Zebra Shift articles</p>
<h1>Read it yourself</h1>
<p class="lede">Short guides to the pictures that come up on a night in the emergency department: ECGs, bedside ultrasound, microscope slides, blood gases and lab panels, and X-rays. Each one shows the finding, what to look for, and what it is often confused with.</p>
<ul class="cards">${GUIDES.map(g => { const keys = Object.keys(READS).filter(k => g.kinds.includes(READS[k].k)); return `<li><a href="${g.slug}.html"><img src="img/${keys[0]}.jpg" alt="" loading="lazy"><b>${esc(g.title)}</b><span>${keys.length} pictures · ${esc(g.desc.split(':')[0])}</span></a></li>`; }).join('')}</ul>
<aside class="cta"><h2>Prefer to play?</h2><p>Zebra Hunt is seven patients a day with four choices for each. One of them is a Unicorn, but you only find out which when you answer. It takes a minute and needs no sign-up.</p><p><a class="btn" href="../#hunt">Play today's hunt</a></p></aside>
</article>`;
  fs.writeFileSync(path.join(OUT, 'index.html'), page({ title: 'Articles · Zebra Shift', desc: 'Guides to ECGs, bedside ultrasound, microscope slides, blood gases, lab panels and X-rays for emergency clinicians and the curious.', url: SITE + 'articles/', body: hub, img: `${SITE}articles/img/antstemi.jpg` }));
  urls.push(SITE + 'privacy.html');
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`);
  fs.writeFileSync(path.join(ROOT, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /admin.html\nSitemap: ${SITE}sitemap.xml\n`);
  console.log('Wrote', GUIDES.length, 'guides,', Object.keys(READS).length, 'pictures, sitemap.xml and robots.txt');
})();
