const db = require('../db');
const { removeImage } = require('../utils/assetPipeline');
const { HttpError } = require('../utils/errors');
const { safeNext } = require('../middleware/auth');
const v = require('../utils/validate');

const PER_PAGE = 40;
const SORTS = ['newest', 'oldest', 'largest', 'name'];

// apps -> nested folders with image counts (subfolders included in totals)
async function folderTree() {
  const [apps, groups] = await Promise.all([
    db.apps.list(),
    db.assets.folderCounts(),
  ]);

  const makeNode = (name, path) => ({ name, path, total: 0, children: new Map() });
  const toArray = (node) => ({
    ...node,
    children: [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name)).map(toArray),
  });

  return apps.map((appDoc) => {
    const root = makeNode(appDoc.name, '');
    for (const g of groups) {
      if (g.appId !== appDoc._id) continue;
      root.total += g.count;
      let node = root;
      const parts = g.folder ? g.folder.split('/') : [];
      parts.forEach((part, i) => {
        const path = parts.slice(0, i + 1).join('/');
        if (!node.children.has(part)) node.children.set(part, makeNode(part, path));
        node = node.children.get(part);
        node.total += g.count;
      });
    }
    return { app: appDoc, ...toArray(root) };
  });
}

function findNode(node, path) {
  if (!path) return node;
  for (const child of node.children) {
    if (child.path === path) return child;
    if (path.startsWith(`${child.path}/`)) return findNode(child, path);
  }
  return null;
}

exports.index = async (req, res) => {
  const page = v.clampInt(req.query.page, 1, 1, 100_000);
  const sort = SORTS.includes(req.query.sort) ? req.query.sort : 'newest';
  const view = req.query.view === 'list' ? 'list' : 'grid';
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';

  const tree = await folderTree();
  let currentApp = null;
  let folder = '';

  if (typeof req.query.app === 'string' && v.ID_RE.test(req.query.app)) {
    const branch = tree.find((t) => String(t.app._id) === req.query.app);
    if (branch) {
      currentApp = branch;
      try {
        folder = v.sanitizeFolder(req.query.folder);
      } catch {
        folder = '';
      }
    }
  }
  const { items: images, total } = await db.assets.search({
    appId: currentApp ? currentApp.app._id : null,
    folder,
    q,
    sort,
    page,
    perPage: PER_PAGE,
  });

  const currentNode = currentApp ? findNode(currentApp, folder) : null;
  const subfolders = currentNode && !q ? currentNode.children : [];

  const params = { app: currentApp ? String(currentApp.app._id) : undefined, folder: folder || undefined, q: q || undefined, sort: sort !== 'newest' ? sort : undefined, view: view !== 'grid' ? view : undefined };
  const buildUrl = (overrides = {}) => {
    const merged = { ...params, ...overrides };
    const qs = Object.entries(merged)
      .filter(([, val]) => val !== undefined && val !== '' && val !== null)
      .map(([k, val]) => `${k}=${encodeURIComponent(val)}`)
      .join('&');
    return `/library${qs ? `?${qs}` : ''}`;
  };

  res.locals.currentAppId = currentApp ? String(currentApp.app._id) : undefined;
  res.locals.currentFolder = folder;
  res.locals.searchQuery = q;

  res.render('library/index', {
    title: 'Media library',
    section: 'library',
    tree,
    currentApp,
    folder,
    subfolders,
    images,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PER_PAGE)),
    sort,
    view,
    q,
    buildUrl,
    returnTo: req.originalUrl,
  });
};

async function findImage(id) {
  if (!v.ID_RE.test(id)) throw new HttpError(404, 'not_found', 'File not found');
  const image = await db.assets.getWithApp(id);
  if (!image) throw new HttpError(404, 'not_found', 'File not found');
  return image;
}

exports.show = async (req, res) => {
  const image = await findImage(req.params.id);
  res.locals.currentAppId = image.app ? String(image.app._id) : undefined;
  res.locals.currentFolder = image.folder;
  res.render('library/show', {
    title: image.originalName || (image.kind === 'document' ? 'File' : 'Image'),
    section: 'library',
    image,
    api: db.assets.toApi(image),
  });
};

exports.destroy = async (req, res) => {
  const image = await findImage(req.params.id);
  const appId = image.app ? image.app._id : null;
  await removeImage(image);
  req.flash(
    'ok',
    `${image.kind === 'document' ? 'File' : 'Image'} deleted. CDN copies can stay visible for a short while.`
  );
  res.redirect(appId ? `/library?app=${appId}${image.folder ? `&folder=${encodeURIComponent(image.folder)}` : ''}` : '/library');
};

exports.bulkDestroy = async (req, res) => {
  const body = req.body || {};
  const ids = (Array.isArray(body.ids) ? body.ids : [body.ids]).filter((id) => v.ID_RE.test(String(id))).slice(0, 200);
  const images = await db.assets.findMany(ids);
  for (const image of images) {
    await removeImage(image);
  }
  req.flash('ok', `Deleted ${images.length} ${images.length === 1 ? 'file' : 'files'}.`);
  res.redirect(safeNext(body.returnTo, '/library'));
};
