const bcrypt = require('bcryptjs');
const db = require('../db');
const { safeNext } = require('../middleware/auth');

// Compared against when the email is unknown, so a wrong email costs the same
// bcrypt time as a wrong password and timing does not reveal which emails exist
const NO_SUCH_ADMIN = bcrypt.hashSync('files360-no-such-admin', 12);

exports.showLogin = (req, res) => {
  if (req.session.admin) return res.redirect('/');
  res.render('auth/login', { title: 'Sign in', error: null, next: safeNext(req.query.next) });
};

exports.login = async (req, res) => {
  const body = req.body || {};
  const admin = await db.admins.findByEmail(body.email);
  const passwordOk = await bcrypt.compare(String(body.password || ''), admin ? admin.passwordHash : NO_SUCH_ADMIN);
  const next = safeNext(body.next);

  if (!admin || !passwordOk) {
    return res.status(401).render('auth/login', { title: 'Sign in', error: 'Email or password is wrong.', next });
  }
  await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
  req.session.admin = { id: admin._id, email: admin.email };
  res.redirect(next);
};

exports.logout = (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
};
