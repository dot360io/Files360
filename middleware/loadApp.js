const db = require('../db');
const { HttpError } = require('../utils/errors');
const { ID_RE } = require('../utils/validate');

// router.param('id', loadApp): puts the app on req.appDoc
module.exports = async function loadApp(req, res, next, id) {
  try {
    if (!ID_RE.test(id)) throw new HttpError(404, 'not_found', 'App not found');
    const appDoc = await db.apps.get(id);
    if (!appDoc) throw new HttpError(404, 'not_found', 'App not found');
    req.appDoc = appDoc;
    res.locals.currentAppId = String(appDoc._id);
    next();
  } catch (err) {
    next(err);
  }
};
