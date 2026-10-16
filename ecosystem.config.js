module.exports = {
  apps: [
    {
      name: 'files360',
      script: 'server.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '700M',
      kill_timeout: 15000,
      env: {
        NODE_ENV: 'production',
        // sharp work runs on the libuv thread pool
        UV_THREADPOOL_SIZE: '4',
      },
    },
  ],
};
