const App = require('../models/App');
const { HttpError } = require('../utils/errors');
const { OBJECT_ID_RE } = require('../utils/validate');

// router.param('id', loadApp): puts the app on req.appDoc
module.exports = async function loadApp(req, res, next, id) {
  try {
    if (!OBJECT_ID_RE.test(id)) throw new HttpError(404, 'not_found', 'App not found');
    const appDoc = await App.findById(id);
    if (!appDoc) throw new HttpError(404, 'not_found', 'App not found');
    req.appDoc = appDoc;
    res.locals.currentAppId = String(appDoc._id);
    next();
  } catch (err) {
    next(err);
  }
};
