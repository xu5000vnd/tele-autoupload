const path = require('node:path');

const appDefaults = {
  cwd: __dirname,
  instances: 1,
  exec_mode: 'fork',
  interpreter: path.join(__dirname, 'node_modules/.bin/ts-node'),
  autorestart: true,
  min_uptime: '30s',
  max_restarts: 10,
  exp_backoff_restart_delay: 1000,
  kill_timeout: 10_000,
  env: {
    NODE_ENV: 'production',
  },
};

module.exports = {
  apps: [
    {
      ...appDefaults,
      name: 'ingestor',
      script: 'apps/ingestor/src/main.ts',
    },
    {
      ...appDefaults,
      name: 'uploader',
      script: 'apps/worker-uploader/src/main.ts',
    },
    {
      ...appDefaults,
      name: 'stats',
      script: 'apps/stats-api/src/main.ts',
    },
  ],
};
