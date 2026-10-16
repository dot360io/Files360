const multer = require('multer');
const config = require('../config/env');

// Single file in the multipart field "file". The size limit depends on the app.
function singleFile(getAppLimitMB) {
  return (req, res, next) => {
    const mb = Math.min(getAppLimitMB(req) || config.limits.maxUploadMB, config.limits.maxUploadMB);
    req.uploadLimitMB = mb;
    multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: mb * 1024 * 1024, files: 1, fields: 10, fieldSize: 2048 },
    }).single('file')(req, res, next);
  };
}

module.exports = { singleFile };
