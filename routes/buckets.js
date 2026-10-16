const express = require('express');
const buckets = require('../controllers/bucketController');

const router = express.Router();

router.param('id', buckets.load);

router.get('/', buckets.index);
router.post('/', buckets.create);

router.get('/new', buckets.choose);
router.get('/new/:provider', buckets.newForm);

router.get('/:id/edit', buckets.editForm);
router.post('/:id', buckets.update);
router.post('/:id/test', buckets.test);
router.post('/:id/default', buckets.makeDefault);
router.post('/:id/toggle', buckets.toggle);
router.post('/:id/delete', buckets.destroy);

module.exports = router;
