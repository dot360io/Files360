const express = require('express');
const dashboard = require('../controllers/dashboardController');

const router = express.Router();

router.get('/', dashboard.index);

module.exports = router;
