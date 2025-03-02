const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const WebSocket = require('ws');
const colors = require('colors/safe');
const fs = require('fs');
const path = require('path');

const commonHeaders = {
  origin: "https://dashboard.teneo.pro",
  "content-type": "application/json",
  referer: "https://dashboard.teneo.pro/",
  "sec-ch-ua-platform": "\"Windows\"",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
};

function extractProxyId(proxy) {
  const match = proxy.match(/sessid-([^-]+)/);
  return match ? match[1] : 'Unknown';
}

const ipProviders = [
  'https://api.ipify.org?format=json',
  'https://ifconfig.me/all.json',
  'https://ipinfo.io/json',
  'https://icanhazip.com/',
  'https://checkip.amazonaws.com/'
];

async function getPublicIP(proxy) {
  const agent = new HttpsProxyAgent(proxy.trim());
  const requests = ipProviders.map((url) =>
    axios.get(url, { httpsAgent: agent, timeout: 5000 }).then((response) => {
      if (url.includes('api.ipify.org')) {
        return response.data.ip;
      } else if (url.includes('ifconfig.me')) {
        return response.data.ip_addr;
      } else if (url.includes('ipinfo.io')) {
        return response.data.ip;
      } else if (url.includes('icanhazip.com')) {
        return response.data.trim();
      } else if (url.includes('checkip.amazonaws.com')) {
        return response.data.trim();
      }
    })
  );

  try {
    const ip = await Promise.any(requests);
    return ip;
  } catch (error) {
    throw new Error('Unable to obtain public IP from all providers');
  }
}

async function logInUserAccount(account, proxy, captchaSolved) {
  const agent = new HttpsProxyAgent(proxy.trim());
  const headers = {
    ...commonHeaders,
    'x-api-key': account.apikey || 'OwAG3kib1ivOJG4Y0OCZ8lJETa6ypvsDtGmdhcjB'
  };

  const payload = {
    email: account.email,
    password: account.password,
    turnstileToken: captchaSolved || ''
  };

  try {
    const response = await axios.post('https://auth.teneo.pro/api/login', payload, { headers, httpsAgent: agent });
    const { access_token, user } = response.data;
    const bearersPath = path.join(__dirname, '../utils/bearers.json');
    let bearers = [];
    try {
      const data = await fs.promises.readFile(bearersPath, 'utf8');
      bearers = JSON.parse(data);
    } catch (err) {
      bearers = [];
    }
    const newId = bearers.length + 1;
    bearers.push({ id: newId, access_token });
    await fs.promises.writeFile(bearersPath, JSON.stringify(bearers, null, 2));
    return {
      access_token,
      user_id: user.id,
      personal_code: user.personal_code
    };
  } catch (error) {
    if (error.response) {
      console.error(JSON.stringify({ debug: "LOGIN ERROR", data: error.response.data }, null, 2));
    } else {
      console.error('No response from server (network/timeout error).');
    }
    throw new Error(`Login failed: ${error.message}`);
  }
}

async function connectWebSocket(user_id, access_token, proxy, instance_id, logger, proxies, account_id) {
  const agent = new HttpsProxyAgent(proxy.trim());
  const wsUrl = `wss://secure.ws.teneo.pro/websocket?accessToken=${access_token}&version=v0.2`;

  let wsConnection;
  let shouldReconnect = true;
  let heartbeatTimeout;
  let reconnectionAttempts = 0;
  const maxReconnectionAttempts = 3;
  const reconnectionDelay = 10000;
  const proxySwitchDelay = 120000;

  const sendPing = () => {
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
      wsConnection.send(JSON.stringify({ type: 'PING' }));
      logger.info(colors.magenta(`Instance ${instance_id}: 🔄 Sent PING to keep the connection alive. - [Account ${account_id}]`));
    }
  };

  const heartbeat = () => {
    clearTimeout(heartbeatTimeout);
    heartbeatTimeout = setTimeout(() => {
      logger.warn(`Instance ${instance_id}: No heartbeat received. Terminating connection. - [Account ${account_id}]`);
      wsConnection.terminate();
    }, 970000);
  };

  const establishConnection = () => {
    return new Promise((resolve, reject) => {
      wsConnection = new WebSocket(wsUrl, {
        agent,
        headers: { ...commonHeaders }
      });

      let pingInterval;

      wsConnection.on('open', () => {
        logger.info(`Instance ${instance_id}: WebSocket connection established. - [Account ${account_id}]`);
        resolve('WebSocket connection established.');
        pingInterval = setInterval(sendPing, 30000);
        heartbeat();
      });

      wsConnection.on('message', (data) => {
        try {
          const messageData = JSON.parse(data);
          logger.info(colors.cyan(`Instance ${instance_id}: 📨 Message received: ${JSON.stringify(messageData)} - [Account ${account_id}]`));
          heartbeat();
          if (messageData.message === 'Connected successfully') {
            logger.info(`Instance ${instance_id}: Connected successfully. - [Account ${account_id}]`);
          } else if (messageData.message === 'Pulse from server') {
            logger.info(`Instance ${instance_id}: 💓 Server heartbeat received. - [Account ${account_id}]`);
          }
        } catch (e) {
          logger.error(`Instance ${instance_id}: Failed to parse message data: ${e.message} - [Account ${account_id}]`);
        }
      });

      wsConnection.on('error', (error) => {
        logger.error(`Instance ${instance_id}: WebSocket error: ${error.message} - [Account ${account_id}]`);
        if (proxies && proxies.length > 0) {
          logger.warn(`Instance ${instance_id}: Removing proxy and trying another. - [Account ${account_id}]`);
          const proxyIndex = proxies.indexOf(proxy);
          if (proxyIndex !== -1) {
            proxies.splice(proxyIndex, 1);
          }
          shouldReconnect = false;
          clearInterval(pingInterval);
          clearTimeout(heartbeatTimeout);
          reject(new Error(`WebSocket error: ${error.message}`));
        } else {
          shouldReconnect = false;
          clearInterval(pingInterval);
          clearTimeout(heartbeatTimeout);
          reject(new Error(`WebSocket error: ${error.message}`));
        }
      });

      wsConnection.on('close', () => {
        logger.warn(`Instance ${instance_id}: 🔌 WebSocket connection closed. - [Account ${account_id}]`);
        clearInterval(pingInterval);
        clearTimeout(heartbeatTimeout);
        if (shouldReconnect) {
          reconnectionAttempts++;
          if (reconnectionAttempts <= maxReconnectionAttempts) {
            logger.warn(`Instance ${instance_id}: ⏳ Waiting ${reconnectionDelay / 1000} seconds before reconnecting... - [Account ${account_id}]`);
            setTimeout(() => {
              logger.warn(`Instance ${instance_id}: 🔄 Attempting to reconnect... - [Account ${account_id}]`);
              establishConnection()
                .then((msg) => {
                  logger.info(`Instance ${instance_id}: ${msg} - [Account ${account_id}]`);
                  reconnectionAttempts = 0;
                })
                .catch((err) => logger.error(`Instance ${instance_id}: ${err.message} - [Account ${account_id}]`));
            }, reconnectionDelay);
          } else {
            logger.warn(`Instance ${instance_id}: Max reconnection attempts reached. Waiting ${proxySwitchDelay / 1000 / 60} minutes before switching proxy. - [Account ${account_id}]`);
            setTimeout(() => {
              if (proxies.length > 0) {
                const newProxy = proxies.shift();
                logger.info(`Instance ${instance_id}: Switching to new Proxy ID: ${extractProxyId(newProxy)} - [Account ${account_id}]`);
                connectWebSocket(user_id, access_token, newProxy, instance_id, logger, proxies, account_id)
                  .catch((err) => logger.error(`Instance ${instance_id}: ${err.message} - [Account ${account_id}]`));
              } else {
                logger.error(`Instance ${instance_id}: No more proxies available. - [Account ${account_id}]`);
              }
            }, proxySwitchDelay);
          }
        }
      });
    });
  };

  return establishConnection();
}

module.exports = {
  extractProxyId,
  getPublicIP,
  logInUserAccount,
  connectWebSocket
};
