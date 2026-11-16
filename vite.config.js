import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function attachForwardedHeaders(proxy, forwardedProto) {
  const setHeaders = (proxyReq, req) => {
    if (req.headers.host) {
      proxyReq.setHeader('X-Forwarded-Host', req.headers.host);
    }
    proxyReq.setHeader('X-Forwarded-Proto', forwardedProto);
  };

  proxy.on('proxyReq', setHeaders);
  proxy.on('proxyReqWs', setHeaders);
}

function trimTrailingSlashes(value) {
  return value.replace(/\/+$/, '');
}

function defaultBackendOrigin(port) {
  const host = fs.existsSync('/.dockerenv') ? 'api' : 'localhost';
  return `http://${host}:${port}`;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const serverHost = env.WEB_BIND_HOST || '0.0.0.0';
  const serverPort = Number(env.WEB_PORT || 3000);
  const useHttps = env.VITE_USE_HTTPS === 'true';
  const sslKeyPath = path.join(process.cwd(), 'certs/dev.key');
  const sslCertPath = path.join(process.cwd(), 'certs/dev.crt');
  const backendPort = Number(env.API_PORT || 8787);
  const backendOrigin = trimTrailingSlashes(
    env.API_UPSTREAM_ORIGIN || defaultBackendOrigin(backendPort)
  );

  let https = false;
  if (useHttps) {
    if (!fs.existsSync(sslKeyPath) || !fs.existsSync(sslCertPath)) {
      throw new Error(
        `HTTPS requested but cert files were not found. Expected key at "${sslKeyPath}" and cert at "${sslCertPath}".`
      );
    }

    https = {
      key: fs.readFileSync(sslKeyPath),
      cert: fs.readFileSync(sslCertPath),
    };
  }

  return {
    plugins: [react()],
    server: {
      host: serverHost,
      port: serverPort,
      strictPort: true,
      https,
      proxy: {
        '/api': {
          target: backendOrigin,
          changeOrigin: true,
          configure(proxy) {
            attachForwardedHeaders(proxy, useHttps ? 'https' : 'http');
          },
        },
        '/ws': {
          target: backendOrigin,
          ws: true,
          changeOrigin: true,
          configure(proxy) {
            attachForwardedHeaders(proxy, useHttps ? 'https' : 'http');
          },
        },
      },
    },
    preview: {
      host: serverHost,
      port: serverPort,
      strictPort: true,
      https,
    },
    build: {
      target: 'esnext',
    },
  };
});
