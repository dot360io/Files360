const test = require('node:test');
const assert = require('node:assert');

const zip = require('../utils/zip');
const cfb = require('../utils/cfb');
const { createZip } = require('./helpers/zip-writer');
const { createCfb, propertySet, lpstr, int16, int32 } = require('./helpers/cfb-writer');

test('zip: reads entries, contents and the listing', () => {
  const buffer = createZip({ 'a.txt': 'hello', 'dir/': '', 'dir/b.json': '{"x":1}' });
  const archive = zip.open(buffer);

  assert.deepStrictEqual(archive.names(), ['a.txt', 'dir/', 'dir/b.json']);
  assert.ok(archive.has('dir/b.json'));
  assert.strictEqual(archive.text('a.txt'), 'hello');
  assert.strictEqual(archive.read('missing.txt'), null);

  const listing = archive.list();
  assert.strictEqual(listing.length, 3);
  assert.deepStrictEqual(listing.find((e) => e.name === 'dir/'), {
    name: 'dir/',
    bytes: 0,
    compressed: 0,
    directory: true,
  });
  assert.strictEqual(listing.find((e) => e.name === 'a.txt').bytes, 5);
});

test('zip: refuses anything that is not an archive', () => {
  assert.strictEqual(zip.looksLikeZip(Buffer.from([0x89, 0x50, 0x4e, 0x47])), false);
  assert.strictEqual(zip.looksLikeZip(Buffer.from('PK\u0003\u0004 and more')), true);
  assert.throws(() => zip.open(Buffer.from('not an archive at all')), zip.ZipError);
});

test('zip: an entry above the cap is refused rather than inflated', () => {
  const buffer = createZip({ 'big.bin': Buffer.alloc(4096, 1) });
  const archive = zip.open(buffer);
  assert.throws(() => archive.read('big.bin', 1024), /preview limit/);
  assert.strictEqual(archive.read('big.bin', 8192).length, 4096);
});

test('zip: a truncated archive fails instead of reading past the end', () => {
  const buffer = createZip({ 'a.txt': 'hello there' });
  assert.throws(() => zip.open(buffer.subarray(0, buffer.length - 10)), zip.ZipError);
});

test('cfb: reads the mini stream, the body stream and the directory', () => {
  const buffer = createCfb({ bodyName: 'WordDocument', bodyBytes: 5000 });
  const container = cfb.open(buffer);

  assert.ok(cfb.looksLikeCfb(buffer));
  assert.deepStrictEqual(container.names(), ['Root Entry', '\u0005SummaryInformation', 'WordDocument']);

  // The body spans several sectors, the property set lives in the mini stream
  const body = container.read('WordDocument');
  assert.strictEqual(body.length, 5000);
  assert.ok(body.every((byte) => byte === 0x41));
  assert.ok(container.read('\u0005SummaryInformation').length > 0);
});

test('cfb: decodes every property value type Office writes', () => {
  const container = cfb.open(createCfb());
  const properties = cfb.readPropertySet(container.read('\u0005SummaryInformation'));

  assert.strictEqual(properties[2], 'Quarterly report'); // VT_LPSTR
  assert.strictEqual(properties[4], 'Åsa Lindström'); // VT_LPWSTR, non-ASCII
  assert.strictEqual(properties[14], 12); // VT_I4
  assert.strictEqual(properties[15], 2481);
  assert.match(String(properties[12]), /^2026-03-04T09:15/); // VT_FILETIME
  assert.strictEqual(properties[1], undefined, 'the code page is consumed, not reported');
});

test('cfb: a UTF-8 code page switches how strings are decoded', () => {
  const container = cfb.open(
    createCfb({
      summary: propertySet([
        [1, 0x02, int16(65001)],
        [2, 0x1e, Buffer.concat([int32(Buffer.byteLength('Ωmega') + 1), Buffer.from('Ωmega\0', 'utf8')])],
      ]),
    })
  );
  assert.strictEqual(cfb.readPropertySet(container.read('\u0005SummaryInformation'))[2], 'Ωmega');
});

test('cfb: tells the formats apart and spots a macro project', () => {
  assert.ok(cfb.open(createCfb({ bodyName: 'Workbook' })).has('Workbook'));
  assert.ok(cfb.open(createCfb({ bodyName: 'PowerPoint Document' })).has('PowerPoint Document'));
  assert.ok(cfb.open(createCfb({ extraStorages: ['_VBA_PROJECT'] })).has('_VBA_PROJECT'));
  assert.strictEqual(cfb.open(createCfb()).has('_VBA_PROJECT'), false);
});

test('cfb: truncated containers fail closed', () => {
  const buffer = createCfb();
  assert.throws(() => cfb.open(buffer.subarray(0, 600)), cfb.CfbError);
  assert.throws(() => cfb.open(Buffer.alloc(16)), cfb.CfbError);
  for (const cut of [1100, 1600, 2400]) {
    const partial = buffer.subarray(0, cut);
    assert.throws(
      () => {
        const container = cfb.open(partial);
        container.read('\u0005SummaryInformation');
        container.read('WordDocument');
      },
      cfb.CfbError,
      `a ${cut} byte container should not read past its end`
    );
  }
});

test('cfb: a property set that is not one returns nothing', () => {
  assert.deepStrictEqual(cfb.readPropertySet(Buffer.alloc(0)), {});
  assert.deepStrictEqual(cfb.readPropertySet(Buffer.alloc(64)), {});
  assert.deepStrictEqual(cfb.readPropertySet(lpstr('nonsense')), {});
});
