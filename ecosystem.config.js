module.exports = {
  apps: [
    {
      name: 'orkestai-voice',
      script: 'server.js',
      cwd: '/opt/orkestai-voice',
      env_production: { NODE_ENV: 'production' },
      max_memory_restart: '300M',
      log_file: '/var/log/orkestai-voice.log',
      merge_logs: true,
    },
    {
      name: 'orkestai-voice-ui',
      script: 'node_modules/.bin/next',
      args: 'start',
      cwd: '/opt/orkestai-voice/ui',
      env_production: { NODE_ENV: 'production', PORT: '3001' },
      max_memory_restart: '300M',
    },
  ],
};
