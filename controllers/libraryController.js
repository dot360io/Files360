const App = require('../models/App');
const Image = require('../models/Image');
const { removeImage } = require('../utils/assetPipeline');
const { HttpError } = require('../utils/errors');
const { safeNext } = require('../middleware/auth');
const v = require('../utils/validate');

const PER_PAGE = 40;
const SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  largest: { 'input.bytes': -1 },
  name: { originalName: 1 },
};

// apps -> nested folders with image counts (subfolders included in totals)
async function folderTree() {
  const [apps, groups] = await Promise.all([
    App.find({}, 'name slug').sort({ name: 1 }).lean(),
    Image.aggregate([{ $group: { _id: { app: '$app', folder: '$folder' }, count: { $sum: 1 } } }]),
  ]);

  const makeNode = (name, path) => ({ name, path, total: 0, children: new Map() });
  const toArray = (node) => ({
    ...node,
    children: [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name)).map(toArray),
  });

  return apps.map((appDoc) => {
    const root = makeNode(appDoc.name, '');
    for (const g of groups) {
      if (String(g._id.app) !== String(appDoc._id)) continue;
      root.total += g.count;
      let node = root;
      const parts = g._id.folder ? g._id.folder.split('/') : [];
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
  const sort = SORTS[req.query.sort] ? req.query.sort : 'newest';
  const view = req.query.view === 'list' ? 'list' : 'grid';
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';

  const tree = await folderTree();
  const filter = {};
  let currentApp = null;
  let folder = '';

  if (typeof req.query.app === 'string' && v.OBJECT_ID_RE.test(req.query.app)) {
    const branch = tree.find((t) => String(t.app._id) === req.query.app);
    if (branch) {
      currentApp = branch;
      filter.app = branch.app._id;
      try {
        folder = v.sanitizeFolder(req.query.folder);
      } catch {
        folder = '';
      }
      if (folder) filter.folder = new RegExp(`^${v.escapeRegex(folder)}(/|$)`);
    }
  }
  if (q) {
    const rx = new RegExp(v.escapeRegex(q), 'i');
    filter.$or = [{ originalName: rx }, { ref: rx }];
  }

  const [images, total] = await Promise.all([
    Image.find(filter).sort(SORTS[sort]).skip((page - 1) * PER_PAGE).limit(PER_PAGE).populate('app', 'name slug').lean(),
    Image.countDocuments(filter),
  ]);

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
  if (!v.OBJECT_ID_RE.test(id)) throw new HttpError(404, 'not_found', 'File not found');
  const image = await Image.findById(id).populate('app', 'name slug');
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
    api: image.toApi(),
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
  const ids = (Array.isArray(body.ids) ? body.ids : [body.ids]).filter((id) => v.OBJECT_ID_RE.test(String(id))).slice(0, 200);
  const images = await Image.find({ _id: { $in: ids } });
  for (const image of images) {
    await removeImage(image);
  }
  req.flash('ok', `Deleted ${images.length} ${images.length === 1 ? 'file' : 'files'}.`);
  res.redirect(safeNext(body.returnTo, '/library'));
};
