const path = require('node:path');

const appDefaults = {
  cwd: __dirname,
  instances: 1,
  exec_mode: 'fork',
  interpreter: process.execPath,
  node_args: [
    '-r',
    path.join(__dirname, 'node_modules/ts-node/register'),
    '-r',
    path.join(__dirname, 'node_modules/tsconfig-paths/register'),
  ],
  autorestart: true,
  min_uptime: '30s',
  max_restarts: 10,
  exp_backoff_restart_delay: 1000,
  kill_timeout: 10_000,
  env: {
    NODE_ENV: 'production',
    TS_NODE_PROJECT: path.join(__dirname, 'tsconfig.json'),
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
