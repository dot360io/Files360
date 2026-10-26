const express = require('express');
const api = require('../controllers/apiController');
const apiKeyAuth = require('../middleware/apiKey');
const { apiRateLimit } = require('../middleware/rateLimits');
const { singleFile } = require('../middleware/upload');

const router = express.Router();

router.use(apiKeyAuth, apiRateLimit);

router.get('/me', api.me);

router.post('/files', singleFile((req) => req.appDoc.maxUploadMB), api.upload);
router.post('/files/from-url', express.json({ limit: '16kb' }), api.importFromUrl);
router.get('/files', api.list);
router.get('/files/:id', api.show);
router.delete('/files/:id', api.destroy);

router.use((req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: 'Unknown endpoint' } });
});

module.exports = router;
