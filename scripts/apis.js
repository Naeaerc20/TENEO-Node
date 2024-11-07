// scripts/apis.js

const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const WebSocket = require('ws');
const colors = require('colors/safe'); // Usar colors/safe para evitar modificar prototipos

// Función para obtener la IP pública a través del proxy
async function getPublicIP(proxy) {
  const agent = new HttpsProxyAgent(proxy.trim());
  try {
    const response = await axios.get('https://api.ipify.org?format=json', {
      httpsAgent: agent,
      timeout: 5000, // Establecer un tiempo de espera para evitar esperas largas
    });
    return response.data.ip;
  } catch (error) {
    throw new Error('Unable to obtain public IP');
  }
}

// Función para iniciar sesión en la cuenta de usuario
async function logInUserAccount(account, proxy) {
  const agent = new HttpsProxyAgent(proxy.trim());

  const headers = {
    'Content-Type': 'application/json;charset=UTF-8',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'X-Client-Info': 'supabase-js-web/2.45.4',
    'X-Supabase-API-Version': '2024-01-01',
    // Incluir apikey y authorization headers
    apikey: account.apikey,
    authorization: `Bearer ${account.apikey}`,
  };

  const payload = {
    email: account.email,
    password: account.password,
    gotrue_meta_security: {},
  };

  try {
    const response = await axios.post(
      'https://ikknngrgxuxgjhplbpey.supabase.co/auth/v1/token?grant_type=password',
      payload,
      { headers, httpsAgent: agent }
    );

    const access_token = response.data.access_token;
    const user_id = response.data.user.id;

    return { access_token, user_id };
  } catch (error) {
    if (error.response && error.response.status === 401) {
      throw new Error('Unauthorized: Invalid credentials or API key');
    } else {
      throw new Error(`Login failed: ${error.message}`);
    }
  }
}

// Función para obtener el código personal
async function getPersonalCode(user_id, access_token, account, proxy) {
  const agent = new HttpsProxyAgent(proxy.trim());

  const headers = {
    Accept: '*/*',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'X-Client-Info': 'supabase-js-web/2.45.4',
    'X-Supabase-API-Version': '2024-01-01',
    apikey: account.apikey,
    authorization: `Bearer ${account.apikey}`,
    Authorization: `Bearer ${access_token}`,
  };

  const url = `https://ikknngrgxuxgjhplbpey.supabase.co/rest/v1/profiles?select=personal_code&id=eq.${user_id}`;

  try {
    const response = await axios.get(url, { headers, httpsAgent: agent });
    const personalCode = response.data[0].personal_code;
    return personalCode;
  } catch (error) {
    throw new Error(`Failed to get personal code: ${error.message}`);
  }
}

// Función para conectar al WebSocket con lógica de reconexión y manejo de errores
async function connectWebSocket(
  user_id,
  access_token,
  proxy,
  instance_id,
  logger,
  proxies // Añadimos la lista de proxies
) {
  const agent = new HttpsProxyAgent(proxy.trim());
  const wsUrl = `wss://secure.ws.teneo.pro/websocket?userId=${user_id}&version=v0.2&token=${access_token}`;

  let wsConnection;
  let shouldReconnect = true;
  let heartbeatTimeout;
  let reconnectionAttempts = 0;

  // Función para enviar mensajes PING
  const sendPing = () => {
    if (wsConnection.readyState === WebSocket.OPEN) {
      wsConnection.send(JSON.stringify({ type: 'PING' }));
      logger.info(
        colors.magenta(`Instance ${instance_id}: 🔄 Sent PING to keep the connection alive.`)
      );
    }
  };

  // Función para manejar el heartbeat
  const heartbeat = () => {
    clearTimeout(heartbeatTimeout);
    // Esperar un mensaje del servidor dentro de 16 minutos
    heartbeatTimeout = setTimeout(() => {
      logger.warn(`Instance ${instance_id}: No heartbeat received. Terminating connection.`);
      wsConnection.terminate();
    }, 970000); // 16 minutos en milisegundos
  };

  // Función para establecer la conexión WebSocket
  const establishConnection = () => {
    return new Promise((resolve, reject) => {
      wsConnection = new WebSocket(wsUrl, {
        agent,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          Origin: 'chrome-extension://emcclcoaglgcpoognfiggmhnhgabppkm',
          Authorization: `Bearer ${access_token}`,
        },
      });

      let pingInterval;

      wsConnection.on('open', () => {
        logger.info(`Instance ${instance_id}: WebSocket connection established.`);
        resolve('WebSocket connection established.');

        // Iniciar el envío de mensajes PING cada 30 segundos
        pingInterval = setInterval(sendPing, 30000); // Ajusta el intervalo según sea necesario

        // Iniciar el monitoreo del heartbeat
        heartbeat();
      });

      wsConnection.on('message', (data) => {
        // Registrar el mensaje recibido en cian y en formato JSON
        try {
          const messageData = JSON.parse(data);
          logger.info(
            colors.cyan(
              `Instance ${instance_id}: 📨 Message received: ${JSON.stringify(messageData)}`
            )
          );

          // Reiniciar el heartbeat al recibir cualquier mensaje
          heartbeat();

          // Manejar mensajes específicos del servidor
          if (messageData.message === 'Connected successfully') {
            logger.info(`Instance ${instance_id}: Connected successfully.`);
          } else if (messageData.message === 'Pulse from server') {
            logger.info(`Instance ${instance_id}: 💓 Server heartbeat received.`);
          }
          // Manejar otros mensajes según sea necesario
        } catch (e) {
          logger.error(`Instance ${instance_id}: Failed to parse message data: ${e.message}`);
        }
      });

      wsConnection.on('error', (error) => {
        logger.error(`Instance ${instance_id}: WebSocket error: ${error.message}`);

        // Eliminar el proxy y reintentar con otro
        if (proxies && proxies.length > 0) {
          logger.warn(`Instance ${instance_id}: Removing proxy and trying another.`);
          // Eliminar el proxy actual de la lista si aún está presente
          const proxyIndex = proxies.indexOf(proxy);
          if (proxyIndex !== -1) {
            proxies.splice(proxyIndex, 1);
          }

          // Intentar con otro proxy (puedes implementar lógica adicional aquí)
          shouldReconnect = false;
          clearInterval(pingInterval);
          clearTimeout(heartbeatTimeout);

          // Puedes llamar a connectWebSocket nuevamente con un nuevo proxy
        } else {
          shouldReconnect = false;
          clearInterval(pingInterval);
          clearTimeout(heartbeatTimeout);
          reject(new Error(`WebSocket error: ${error.message}`));
        }
      });

      wsConnection.on('close', () => {
        logger.warn(`Instance ${instance_id}: 🔌 WebSocket connection closed.`);
        clearInterval(pingInterval);
        clearTimeout(heartbeatTimeout);
        if (shouldReconnect) {
          reconnectionAttempts++;
          const delay = Math.min(30000, 2000 * 2 ** reconnectionAttempts); // Backoff exponencial hasta 30 segundos
          logger.warn(
            `Instance ${instance_id}: ⏳ Waiting ${delay / 1000} seconds before reconnecting...`
          );
          setTimeout(() => {
            logger.warn(`Instance ${instance_id}: 🔄 Attempting to reconnect...`);
            establishConnection()
              .then((msg) => {
                logger.info(`Instance ${instance_id}: ${msg}`);
                reconnectionAttempts = 0; // Reiniciar los intentos al reconectar exitosamente
              })
              .catch((err) => logger.error(`Instance ${instance_id}: ${err.message}`));
          }, delay);
        }
      });
    });
  };

  // Iniciar la conexión inicial
  return establishConnection();
}

module.exports = {
  logInUserAccount,
  getPersonalCode,
  connectWebSocket,
  getPublicIP,
};
