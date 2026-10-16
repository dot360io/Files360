const bcrypt = require('bcryptjs');
const config = require('../config/env');
const { safeNext } = require('../middleware/auth');

exports.showLogin = (req, res) => {
  if (req.session.admin) return res.redirect('/');
  res.render('auth/login', { title: 'Sign in', error: null, next: safeNext(req.query.next) });
};

exports.login = async (req, res) => {
  const body = req.body || {};
  const email = String(body.email || '').trim().toLowerCase();
  // Always compare the password so timing does not reveal the email
  const passwordOk = await bcrypt.compare(String(body.password || ''), config.admin.passwordHash);
  const next = safeNext(body.next);

  if (!passwordOk || email !== config.admin.email) {
    return res.status(401).render('auth/login', { title: 'Sign in', error: 'Email or password is wrong.', next });
  }
  await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
  req.session.admin = { email };
  res.redirect(next);
};

exports.logout = (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
};
