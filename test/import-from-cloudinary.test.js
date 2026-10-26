const test = require('node:test');
const assert = require('node:assert');

const { mapFolder, sourceFolder, mapRef, csvEscape, csvRow, primaryUrl, parseCloudinaryUrl } = require('../scripts/import-from-cloudinary');
const { sanitizeFolder } = require('../utils/validate');

test('cloudinary folder: valid names pass through lowercased', () => {
  assert.strictEqual(mapFolder('Products/Shoes'), 'products/shoes');
  assert.strictEqual(mapFolder('users/avatars_2024'), 'users/avatars_2024');
  assert.strictEqual(mapFolder(''), '');
  assert.strictEqual(mapFolder(undefined), '');
});

test('cloudinary folder: anything else collapses to "-" and empty segments go', () => {
  assert.strictEqual(mapFolder('My Photos/Summer 2024!!'), 'my-photos/summer-2024');
  assert.strictEqual(mapFolder('//a//b/'), 'a/b');
  assert.strictEqual(mapFolder('Café/Ñandú'), 'cafe/nandu');
  assert.strictEqual(mapFolder('-hidden/_private/ok'), 'hidden/private/ok');
  assert.strictEqual(mapFolder('!!!/real'), 'real');
  assert.strictEqual(mapFolder('../../etc'), 'etc');
  assert.strictEqual(mapFolder('日本/写真'), '');
});

test('cloudinary folder: at most 5 levels and 100 characters', () => {
  assert.strictEqual(mapFolder('a/b/c/d/e/f/g'), 'a/b/c/d/e');
  const long = mapFolder(`${'x'.repeat(60)}/${'y'.repeat(60)}`);
  assert.ok(long.length <= 100);
  assert.strictEqual(long, `${'x'.repeat(60)}/${'y'.repeat(39)}`);
  assert.strictEqual(mapFolder(`${'a'.repeat(99)}/b`), 'a'.repeat(99));
  // a cut that lands on a dash must not leave the segment ending in one
  assert.ok(!mapFolder(`${'a'.repeat(97)}/b-cdef`).endsWith('-'));
});

test('cloudinary folder: every mapped value is accepted by the API', () => {
  const samples = ['Products/Shoes', 'My Photos/Summer 2024!!', 'a/b/c/d/e/f/g', `${'x'.repeat(60)}/${'y'.repeat(60)}`,
    '-_-/__/--x', 'Ünïcödé Folder/Sub Folder (1)', '   spaced   /  out  ', 'a/'.repeat(80)];
  for (const sample of samples) {
    const mapped = mapFolder(sample);
    assert.strictEqual(sanitizeFolder(mapped), mapped, sample);
  }
});

test('cloudinary folder: asset_folder wins, otherwise the public_id directory', () => {
  assert.strictEqual(sourceFolder({ public_id: 'a/b/photo', asset_folder: 'Shop' }), 'Shop');
  assert.strictEqual(sourceFolder({ public_id: 'a/b/photo', asset_folder: '' }), '');
  assert.strictEqual(sourceFolder({ public_id: 'a/b/photo' }), 'a/b');
  assert.strictEqual(sourceFolder({ public_id: 'photo' }), '');
});

test('cloudinary ref: public_id capped at 120 characters', () => {
  assert.strictEqual(mapRef('shop/shoe-1'), 'shop/shoe-1');
  assert.strictEqual(mapRef('p'.repeat(200)).length, 120);
  assert.strictEqual(mapRef(''), undefined);
});

test('csv: plain values stay plain, separators and quotes are quoted', () => {
  assert.strictEqual(csvEscape('shop/shoe-1'), 'shop/shoe-1');
  assert.strictEqual(csvEscape('a,b'), '"a,b"');
  assert.strictEqual(csvEscape('say "hi"'), '"say ""hi"""');
  assert.strictEqual(csvEscape('line\nbreak'), '"line\nbreak"');
  assert.strictEqual(csvEscape(null), '');
  assert.strictEqual(csvEscape(undefined), '');
  assert.strictEqual(csvEscape(42), '42');
});

test('csv: values a spreadsheet would run as formulas are defused', () => {
  assert.strictEqual(csvEscape('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.strictEqual(csvEscape('+1'), '"\'+1"');
  assert.strictEqual(csvEscape('@sum'), '"\'@sum"');
  assert.strictEqual(csvEscape('-2+3'), '"\'-2+3"');
});

test('csv: a row ends with a newline', () => {
  assert.strictEqual(csvRow(['a', 'b,c', '']), 'a,"b,c",\n');
});

test('primary url: largest image variant, or the document file', () => {
  const image = {
    kind: 'image',
    variants: {
      thumb: { url: 'https://cdn.example.com/t.webp', width: 160, height: 160 },
      large: { url: 'https://cdn.example.com/l.webp', width: 1600, height: 1067 },
      medium: { url: 'https://cdn.example.com/m.webp', width: 800, height: 533 },
    },
  };
  assert.strictEqual(primaryUrl(image), 'https://cdn.example.com/l.webp');
  assert.strictEqual(primaryUrl({ kind: 'document', file: { url: 'https://cdn.example.com/terms.pdf' } }), 'https://cdn.example.com/terms.pdf');
  assert.strictEqual(primaryUrl({ kind: 'image', variants: {} }), '');
});

test('cloudinary url: key, secret and cloud are read', () => {
  assert.deepStrictEqual(parseCloudinaryUrl('cloudinary://123:abc@demo'), { key: '123', secret: 'abc', cloud: 'demo' });
  assert.strictEqual(parseCloudinaryUrl('https://demo'), null);
  assert.strictEqual(parseCloudinaryUrl(undefined), null);
});
