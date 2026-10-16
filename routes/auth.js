const express = require('express');
const auth = require('../controllers/authController');
const { loginRateLimit } = require('../middleware/rateLimits');

const router = express.Router();

router.get('/login', auth.showLogin);
router.post('/login', loginRateLimit, auth.login);
router.post('/logout', auth.logout);

module.exports = router;
