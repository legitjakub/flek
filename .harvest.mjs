import { chromium } from 'playwright';
const terms = process.env.TERMS.split('|');
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
for (const term of terms) {
  await p.goto('https://unsplash.com/s/photos/' + encodeURIComponent(term), { waitUntil: 'domcontentloaded' }).catch(()=>{});
  await p.waitForTimeout(4000);
  const ids = await p.evaluate(() => {
    const set = new Set();
    for (const img of document.querySelectorAll('img')) {
      const m = (img.currentSrc || img.src || '').match(/images\.unsplash\.com\/(photo-[0-9a-f]+-[0-9a-f]+)/);
      if (m) set.add(m[1]);
    }
    return [...set].slice(0, 6);
  });
  console.log(`${term} :: ${ids.join(' ')}`);
}
await b.close();
