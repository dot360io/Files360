const express = require('express');
const library = require('../controllers/libraryController');

const router = express.Router();

router.get('/', library.index);
router.post('/bulk-delete', library.bulkDestroy);
router.get('/:id', library.show);
router.post('/:id/delete', library.destroy);

module.exports = router;
