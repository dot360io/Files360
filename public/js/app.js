(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // What the upload dialog accepts, kept in step with utils/documents.js
  const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'tif', 'tiff', 'svg'];
  const DOCUMENTS = {
    pdf: { badge: 'PDF', tone: 'pdf' },
    xlsx: { badge: 'XLS', tone: 'sheet' },
    xls: { badge: 'XLS', tone: 'sheet' },
    csv: { badge: 'CSV', tone: 'sheet' },
    docx: { badge: 'DOC', tone: 'doc' },
    doc: { badge: 'DOC', tone: 'doc' },
    pptx: { badge: 'PPT', tone: 'slides' },
    ppt: { badge: 'PPT', tone: 'slides' },
    txt: { badge: 'TXT', tone: 'text' },
    zip: { badge: 'ZIP', tone: 'archive', archive: true },
  };

  const extensionOf = (name) => {
    const match = /\.([a-z0-9]{1,8})$/i.exec(String(name || ''));
    return match ? match[1].toLowerCase() : '';
  };

  const formatBytes = (n) => {
    if (!n) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
    return (n / 1024 ** i).toFixed(i ? 1 : 0) + ' ' + units[i];
  };

  /* Copy to clipboard */
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    e.preventDefault();
    const text = btn.getAttribute('data-copy');
    try {
      await navigator.clipboard.writeText(text);
      flashButton(btn, 'Copied');
    } catch {
      flashButton(btn, 'Copy failed');
    }
  });

  function flashButton(btn, label) {
    if (btn.dataset.busy) return;
    btn.dataset.busy = '1';
    const html = btn.innerHTML;
    const iconOnly = !btn.textContent.trim();
    btn.innerHTML = iconOnly
      ? '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
      : label;
    setTimeout(() => {
      btn.innerHTML = html;
      delete btn.dataset.busy;
    }, 1400);
  }

  /* Confirm destructive forms */
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-confirm]');
    if (form && !window.confirm(form.getAttribute('data-confirm'))) e.preventDefault();
  });

  /* Dialogs */
  document.addEventListener('click', (e) => {
    const opener = e.target.closest('[data-open-dialog]');
    if (opener) {
      const dialog = document.getElementById(opener.getAttribute('data-open-dialog'));
      if (dialog && !dialog.open) dialog.showModal();
    }
    const closer = e.target.closest('[data-close-dialog]');
    if (closer) {
      const dialog = closer.closest('dialog');
      if (dialog) dialog.close();
    }
  });
  $$('dialog.modal').forEach((dialog) => {
    // Close when clicking the backdrop
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
  });
  $$('dialog[data-open-on-load]').forEach((d) => d.showModal());

  /* Toast */
  const toast = $('[data-toast]');
  if (toast) {
    const hide = () => toast.remove();
    $('[data-dismiss-toast]', toast).addEventListener('click', hide);
    if (!toast.classList.contains('error')) setTimeout(hide, 5000);
  }

  /* Mobile sidebar */
  const sidebar = $('#sidebar');
  const menuBtn = $('[data-toggle-sidebar]');
  if (sidebar && menuBtn) {
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar.classList.toggle('is-open');
    });
    document.addEventListener('click', (e) => {
      if (sidebar.classList.contains('is-open') && !sidebar.contains(e.target)) sidebar.classList.remove('is-open');
    });
  }

  /* Auto-submit selects */
  $$('[data-autosubmit]').forEach((el) => el.addEventListener('change', () => el.form.submit()));

  /* Select key text on focus */
  $$('[data-select-on-focus]').forEach((el) => el.addEventListener('focus', () => el.select()));

  /* Slug preview in "Create app" */
  const slugSource = $('[data-slug-source]');
  const slugTarget = $('[data-slug-target]');
  if (slugSource && slugTarget) {
    let touched = Boolean(slugTarget.value);
    slugTarget.addEventListener('input', () => { touched = true; });
    slugSource.addEventListener('input', () => {
      if (touched) return;
      slugTarget.value = slugSource.value
        .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    });
  }

  /* Storage connect form: the preset fills in endpoint and public URL while you type */
  const bucketForm = $('[data-bucket-form]');
  if (bucketForm) {
    const catalogEl = $('[data-provider-catalog]', bucketForm);
    const catalog = catalogEl ? JSON.parse(catalogEl.textContent) : [];
    const preset = catalog.find((p) => p.id === bucketForm.getAttribute('data-provider'));
    const regionEl = $('[data-region]', bucketForm);
    const bucketEl = $('[data-bucket-name]', bucketForm);
    const accountEl = $('[data-account]', bucketForm);
    const endpointEl = $('[data-endpoint]', bucketForm);
    const publicEl = $('[data-public-url]', bucketForm);

    if (preset) {
      const fillTemplate = (tpl, vars) =>
        String(tpl || '').replace(/\{(region|bucket|account)\}/g, (_, name) => vars[name] || '');
      const vars = () => ({
        region: regionEl ? regionEl.value.trim() : '',
        bucket: bucketEl ? bucketEl.value.trim() : '',
        account: accountEl ? accountEl.value.trim() : '',
      });

      // A field keeps updating itself until the admin types something else in it
      const auto = {
        endpoint: endpointEl ? endpointEl.value : '',
        publicUrl: publicEl ? publicEl.value : '',
      };

      const sync = () => {
        const v = vars();
        if (endpointEl && preset.endpoint && (endpointEl.value === auto.endpoint || !endpointEl.value)) {
          auto.endpoint = fillTemplate(preset.endpoint, v);
          endpointEl.value = auto.endpoint;
        }
        if (publicEl && preset.publicUrl && (publicEl.value === auto.publicUrl || !publicEl.value)) {
          auto.publicUrl = fillTemplate(preset.publicUrl, v);
          publicEl.value = auto.publicUrl;
        }
      };

      [regionEl, bucketEl, accountEl].forEach((el) => {
        if (!el) return;
        el.addEventListener('input', sync);
        el.addEventListener('change', sync);
      });
      sync();
    }

    // Verifying the bucket takes a few seconds, so say so instead of looking stuck
    bucketForm.addEventListener('submit', () => {
      const submit = $('button[type="submit"]', bucketForm);
      if (!submit || submit.disabled) return;
      submit.disabled = true;
      submit.textContent = 'Testing the connection...';
    });
  }

  /* Range output */
  $$('[data-range-output]').forEach((range) => {
    const out = document.getElementById(range.getAttribute('data-range-output'));
    range.addEventListener('input', () => { out.textContent = range.value; });
  });

  /* Sizes editor */
  const sizesBody = $('[data-sizes]');
  const addSize = $('[data-add-size]');
  const template = $('#size-row-template');
  if (sizesBody && addSize && template) {
    const sync = () => {
      const rows = $$('[data-size-row]', sizesBody);
      addSize.disabled = rows.length >= 8;
      rows.forEach((row) => { $('[data-remove-size]', row).disabled = rows.length <= 1; });
    };
    addSize.addEventListener('click', () => {
      sizesBody.append(template.content.cloneNode(true));
      const rows = $$('[data-size-row]', sizesBody);
      $('input', rows[rows.length - 1]).focus();
      sync();
    });
    sizesBody.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-size]');
      if (!btn) return;
      btn.closest('[data-size-row]').remove();
      sync();
    });
    sync();
  }

  /* Library selection */
  const bulkBar = $('#bulk-bar');
  if (bulkBar) {
    const boxes = $$('[data-select]');
    const count = $('[data-selected-count]', bulkBar);
    const toggleAll = $('[data-select-all-toggle]');
    const update = () => {
      const selected = boxes.filter((b) => b.checked);
      bulkBar.hidden = selected.length === 0;
      count.textContent = selected.length + ' selected';
      boxes.forEach((b) => b.closest('[data-asset]').classList.toggle('is-selected', b.checked));
      if (toggleAll) toggleAll.checked = selected.length === boxes.length && boxes.length > 0;
    };
    boxes.forEach((b) => b.addEventListener('change', update));
    $('[data-select-all]', bulkBar).addEventListener('click', () => { boxes.forEach((b) => { b.checked = true; }); update(); });
    $('[data-clear-selection]', bulkBar).addEventListener('click', () => { boxes.forEach((b) => { b.checked = false; }); update(); });
    if (toggleAll) toggleAll.addEventListener('change', () => { boxes.forEach((b) => { b.checked = toggleAll.checked; }); update(); });
  }

  /* Asset viewer: size switcher and tabs */
  const viewerImg = $('#viewer-img');
  if (viewerImg) {
    const label = $('[data-size-label]');
    const copyBtn = $('[data-copy-current]');
    const openLink = $('[data-open-current]');
    $$('[data-size-src]').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('[data-size-src]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        const src = btn.getAttribute('data-size-src');
        viewerImg.removeAttribute('width');
        viewerImg.removeAttribute('height');
        viewerImg.src = src;
        label.textContent = btn.getAttribute('data-size-meta');
        copyBtn.setAttribute('data-copy', src);
        openLink.href = src;
      });
    });
  }
  $$('[data-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const name = tab.getAttribute('data-tab');
      $$('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      $$('[data-tab-panel]').forEach((p) => { p.hidden = p.getAttribute('data-tab-panel') !== name; });
    });
  });

  /* Upload dialog */
  const dialog = $('#upload-dialog');
  const input = $('#upload-input');
  if (!dialog || !input) return;

  const drop = $('#upload-drop');
  const queue = $('#upload-queue');
  const appSelect = $('#upload-app');
  const folderInput = $('#upload-folder');
  const maxLabel = $('[data-max-label]');
  const summary = $('#upload-summary');
  const csrf = dialog.getAttribute('data-csrf');
  const pending = [];
  let running = false;
  let succeeded = 0;
  let failed = 0;

  const acceptLabel = $('[data-accept-label]');
  const maxMB = () => Number(appSelect.selectedOptions[0]?.getAttribute('data-max')) || 15;
  const takesDocuments = () => appSelect.selectedOptions[0]?.getAttribute('data-docs') !== '0';
  const takesArchives = () => appSelect.selectedOptions[0]?.getAttribute('data-archives') === '1';
  const updateApp = () => {
    maxLabel.textContent = maxMB();
    if (!acceptLabel) return;
    acceptLabel.textContent = takesDocuments()
      ? 'Images, PDF, Office files, CSV, text' + (takesArchives() ? ' and ZIP' : '')
      : takesArchives()
        ? 'Images and ZIP'
        : 'JPEG, PNG, WebP, GIF, AVIF, TIFF and SVG';
  };
  appSelect.addEventListener('change', updateApp);
  updateApp();

  const setSummary = () => {
    const parts = [];
    if (succeeded) parts.push(succeeded + ' uploaded');
    if (failed) parts.push(failed + ' failed');
    if (pending.length || running) parts.push('working...');
    summary.textContent = parts.join(', ');
  };

  function addFiles(files) {
    const appId = appSelect.value;
    const folder = folderInput.value.trim();
    const documentsOk = takesDocuments();
    const archivesOk = takesArchives();
    files.forEach((file) => {
      const ext = extensionOf(file.name);
      const docType = DOCUMENTS[ext];
      const isImage = file.type.startsWith('image/') || IMAGE_EXT.includes(ext);

      const li = docType && !isImage
        ? item('<div class="q-thumb file-tile tone-' + docType.tone + '">' + docType.badge + '</div>')
        : item('<div class="q-thumb checker"><img alt=""></div>');
      $('.q-name', li).textContent = file.name;
      $('.q-size', li).textContent = formatBytes(file.size);
      if (isImage && file.type.startsWith('image/')) $('img', li).src = URL.createObjectURL(file);
      queue.prepend(li);

      if (!isImage && !docType) {
        fail(li, 'Only images, PDF, Office files, CSV, text and ZIP');
        return;
      }
      if (docType && !isImage && docType.archive && !archivesOk) {
        fail(li, 'This app does not accept archives');
        return;
      }
      if (docType && !isImage && !docType.archive && !documentsOk) {
        fail(li, 'This app only accepts images');
        return;
      }
      if (file.size > maxMB() * 1048576) {
        fail(li, 'Larger than ' + maxMB() + ' MB');
        return;
      }
      pending.push({ file, li, appId, folder });
    });
    setSummary();
    run();
  }

  function describeDocument(data) {
    const preview = data.preview || {};
    if (preview.pages) return preview.pages + (preview.pages === 1 ? ' page' : ' pages');
    if (preview.slides) return preview.slides + (preview.slides === 1 ? ' slide' : ' slides');
    if (preview.rows) return preview.rows + (preview.rows === 1 ? ' row' : ' rows');
    if (preview.entries) return preview.entries + (preview.entries === 1 ? ' file inside' : ' files inside');
    if (preview.lines) return preview.lines + (preview.lines === 1 ? ' line' : ' lines');
    if (preview.words) return preview.words + ' words';
    return formatBytes((data.file && data.file.bytes) || 0);
  }

  function item(thumb) {
    const li = document.createElement('li');
    li.className = 'q-item';
    li.innerHTML =
      thumb +
      '<div class="q-main"><div class="q-row"><span class="q-name"></span><span class="q-size"></span></div>' +
      '<div class="q-bar"><span></span></div><div class="q-status">Waiting</div></div>';
    return li;
  }

  function fail(li, message) {
    li.classList.remove('processing');
    li.classList.add('failed');
    $('.q-bar span', li).style.width = '100%';
    $('.q-status', li).textContent = message;
    failed += 1;
    setSummary();
  }

  function run() {
    if (running || !pending.length) return;
    running = true;
    const job = pending.shift();
    const { li } = job;
    const bar = $('.q-bar span', li);
    const status = $('.q-status', li);

    const form = new FormData();
    form.append('file', job.file);
    if (job.folder) form.append('folder', job.folder);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/apps/' + job.appId + '/upload');
    xhr.setRequestHeader('x-csrf-token', csrf);
    xhr.setRequestHeader('accept', 'application/json');
    xhr.upload.addEventListener('progress', (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      bar.style.width = pct + '%';
      status.textContent = 'Uploading ' + pct + '%';
      if (pct >= 100) {
        li.classList.add('processing');
        status.textContent = 'Optimizing...';
      }
    });
    xhr.addEventListener('load', () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        li.classList.remove('processing');
        li.classList.add('done');
        bar.style.width = '100%';
        const sizes = Object.values(data.variants || {});
        const largest = sizes.reduce((a, b) => (b.width > (a ? a.width : 0) ? b : a), null);
        const saved = largest && data.input && data.input.bytes ? Math.max(0, Math.round((1 - largest.bytes / data.input.bytes) * 100)) : 0;
        status.textContent = data.duplicate
          ? 'Already in the library'
          : data.kind === 'document'
            ? 'Stored, ' + describeDocument(data)
            : sizes.length + ' sizes created, ' + saved + '% smaller';
        succeeded += 1;
      } else {
        fail(li, (data.error && data.error.message) || 'Upload failed (' + xhr.status + ')');
      }
      done();
    });
    xhr.addEventListener('error', () => { fail(li, 'Network error'); done(); });
    xhr.send(form);

    function done() {
      running = false;
      setSummary();
      run();
    }
  }

  input.addEventListener('change', () => {
    addFiles([...input.files]);
    input.value = '';
  });
  ['dragenter', 'dragover'].forEach((type) => drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((type) => drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', (e) => addFiles([...e.dataTransfer.files]));

  // Refresh the page after closing if something was uploaded
  dialog.addEventListener('close', () => {
    if (succeeded > 0 && !running && !pending.length) window.location.reload();
  });
})();

/* Setup wizard: server fields only matter for Postgres and MySQL */
(() => {
  const form = document.querySelector('[data-db-form]');
  if (!form) return;
  const radios = [...form.querySelectorAll('[data-db-client]')];
  const server = form.querySelector('[data-db-server]');
  const test = form.querySelector('[data-db-test]');
  const port = form.querySelector('[data-db-port]');
  const sync = () => {
    const chosen = radios.find((r) => r.checked);
    const isServer = Boolean(chosen && chosen.value !== 'sqlite');
    if (server) server.hidden = !isServer;
    if (test) test.hidden = !isServer;
    if (port && chosen && chosen.dataset.port) port.placeholder = chosen.dataset.port;
  };
  radios.forEach((r) => r.addEventListener('change', sync));
  sync();
})();
