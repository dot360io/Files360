/**
 * The only door to the database. Controllers and utils call the repositories
 * hanging off this module (db.assets.list(...)), never Knex directly, so every
 * engine shares one code path.
 */
const connection = require('./connection');

module.exports = {
  knex: connection.knex,
  connect: connection.connect,
  probe: connection.probe,
  explain: connection.explain,
  migrate: connection.migrate,
  close: connection.close,
  ping: connection.ping,
  isUniqueViolation: connection.isUniqueViolation,
  describe: connection.describe,
  get connected() {
    return connection.connected;
  },
  apps: require('./apps'),
  keys: require('./keys'),
  buckets: require('./buckets'),
  assets: require('./assets'),
  admins: require('./admins'),
};
