const multer = require('multer');
const { HttpError } = require('../utils/errors');

// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, next) {
  let status = err.status || err.statusCode || 500;
  let code = typeof err.code === 'string' ? err.code : 'server_error';
  let message = err.message;

  if (err instanceof multer.MulterError) {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    status = tooBig ? 413 : 400;
    code = tooBig ? 'file_too_large' : 'invalid_upload';
    message = tooBig
      ? `File exceeds the ${req.uploadLimitMB} MB limit`
      : 'Send exactly one file in a multipart field named "file"';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    code = 'body_too_large';
    message = 'Request body is too large';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    code = 'invalid_json';
    message = 'Request body is not valid JSON';
  } else if (!(err instanceof HttpError) && status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    code = 'server_error';
    message = 'Something went wrong on the server';
  }

  if (res.headersSent) return next(err);

  const wantsJson =
    req.originalUrl.startsWith('/v1') ||
    req.xhr ||
    Boolean(req.get('x-csrf-token')) ||
    (req.get('accept') || '').startsWith('application/json');

  if (wantsJson) return res.status(status).json({ error: { code, message } });
  res.status(status).render('errors/error', { title: 'Error', status, message });
};
