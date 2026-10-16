const mongoose = require('mongoose');
const config = require('./env');

mongoose.set('strictQuery', true);

async function connectDatabase() {
  await mongoose.connect(config.mongoUri);
  console.log('[database] connected');
  return mongoose.connection;
}

module.exports = { connectDatabase, mongoose };
