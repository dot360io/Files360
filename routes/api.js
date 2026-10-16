const express = require('express');
const api = require('../controllers/apiController');
const apiKeyAuth = require('../middleware/apiKey');
const { apiRateLimit } = require('../middleware/rateLimits');
const { singleFile } = require('../middleware/upload');

const router = express.Router();

router.use(apiKeyAuth, apiRateLimit);

router.get('/me', api.me);
router.post('/images', singleFile((req) => req.appDoc.maxUploadMB), api.upload);
router.post('/images/from-url', express.json({ limit: '16kb' }), api.importFromUrl);
router.get('/images', api.list);
router.get('/images/:id', api.show);
router.delete('/images/:id', api.destroy);

router.use((req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: 'Unknown endpoint' } });
});

module.exports = router;
