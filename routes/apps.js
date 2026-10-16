const express = require('express');
const apps = require('../controllers/appController');
const loadApp = require('../middleware/loadApp');
const { singleFile } = require('../middleware/upload');

const router = express.Router();

router.param('id', loadApp);

router.get('/', apps.index);
router.post('/', apps.create);

router.get('/:id', apps.overview);
router.post('/:id/upload', singleFile((req) => req.appDoc.maxUploadMB), apps.upload);

router.get('/:id/keys', apps.keys);
router.post('/:id/keys', apps.createKey);
router.post('/:id/keys/:keyId/revoke', apps.revokeKey);

router.get('/:id/settings', apps.settings);
router.post('/:id/settings', apps.updateSettings);
router.post('/:id/toggle', apps.toggle);
router.post('/:id/delete', apps.destroy);

router.get('/:id/integration', apps.integration);
router.get('/:id/integration/download', apps.downloadGuide);

module.exports = router;
