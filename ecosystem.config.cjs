module.exports = {
  apps: [
    {
      name: 'web-frontend',
      script: 'web-proxy-server.cjs',
      cwd: '/root/5G-Remote-Driving-Cloud-Platform',
      env: {
        NODE_ENV: 'production'
      },
      cron_restart: '0 3 * * 0',  // 每周日凌晨 3 点重启
      max_memory_restart: '500M'   // 内存超过 500M 自动重启
    },
    {
      name: 'g29-relay',
      script: 'g29-relay-server.cjs',
      cwd: '/root/5G-Remote-Driving-Cloud-Platform',
      env: {},
      cron_restart: '0 3 * * 0',  // 每周日凌晨 3 点重启
      max_memory_restart: '200M'   // 内存超过 200M 自动重启
    }
  ]
};
