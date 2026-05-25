module.exports = {
  apps: [
    {
      name: 'geofence-server',
      script: 'server.js',
      env: {
        PORT: 3000,
        NODE_ENV: 'production'
      }
    }
  ]
};
