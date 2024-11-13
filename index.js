// index.js

const clear = require('console-clear');
const figlet = require('figlet');
const readlineSync = require('readline-sync');
const fs = require('fs');
const winston = require('winston');
const colors = require('colors/safe');
const {
  logInUserAccount,
  getPersonalCode,
  connectWebSocket,
  getPublicIP,
} = require('./scripts/apis');

// Función de sleep para demoras
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let proxies = fs.readFileSync('proxies.txt', 'utf-8').split('\n').filter(Boolean);
const userData = JSON.parse(fs.readFileSync('userdata.json', 'utf-8'));

// Configurar niveles y colores personalizados
const customLevels = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
  },
  colors: {
    error: 'red',
    warn: 'yellow',
    info: 'blue',
  },
};

winston.addColors(customLevels.colors);

// Formateador personalizado para aplicar colores al nivel y marca de tiempo
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf((info) => {
    let levelColorFunc = colors.white;
    if (info.level === 'info') levelColorFunc = colors.blue;
    else if (info.level === 'warn') levelColorFunc = colors.yellow;
    else if (info.level === 'error') levelColorFunc = colors.red;

    const level = levelColorFunc(`[${info.level.toUpperCase()}]`);
    const timestamp = levelColorFunc(`[${info.timestamp}]`);
    const message = info.message;

    return `${level}${timestamp} ${message}`;
  })
);

const logger = winston.createLogger({
  levels: customLevels.levels,
  format: customFormat,
  transports: [new winston.transports.Console()],
});

function extractProxyId(proxy) {
  const match = proxy.match(/-session-([^-:]+)/);
  return match ? match[1] : 'Unknown';
}

clear();

console.log(
  colors.green(
    figlet.textSync('TENEO NODE', {
      font: 'Standard',
      horizontalLayout: 'default',
      verticalLayout: 'default',
    })
  )
);

console.log(colors.green('👋 Hello! Welcome to Teneo Node Automatized Tool'));
console.log(colors.green('👑 Project created by Naeaex - github.com/Naeaerc20 - x.com/naeaex_dev'));

// Preguntar al usuario cuántas instancias quiere conectar por cuenta
const instancesPerAccount = parseInt(
  readlineSync.question('How many instances do you want to connect per account? ')
);

if (proxies.length === 0) {
  logger.error('No proxies available in proxies.txt');
  process.exit(1);
}

if (userData.length === 0) {
  logger.error('No user data available in userdata.json');
  process.exit(1);
}

(async () => {
  let bearerData = []; // Array para guardar información de bearer

  for (const account of userData) {
    logger.info(`🚀 Starting processes for account: ${account.id}`);

    let success = false;
    let proxy;
    let proxyId;
    let workingProxies = [];

    // Intentar encontrar suficientes proxies funcionales para las instancias
    while (workingProxies.length < instancesPerAccount && proxies.length > 0) {
      proxy = proxies.shift(); // Tomar el primer proxy disponible
      proxyId = extractProxyId(proxy);
      logger.info(`Using Proxy ID: ${proxyId}`);
      logger.info('Retrieving Proxy IP...');

      try {
        const publicIP = await getPublicIP(proxy);
        logger.info(`Proxy IP Obtained: ${publicIP}`);
        workingProxies.push({ proxy, proxyId });
      } catch (error) {
        logger.warn(
          `Unable to obtain public IP with proxy ${proxyId}. Removing proxy and trying next one.`
        );
        // Continuar con el siguiente proxy
      }
    }

    if (workingProxies.length < instancesPerAccount) {
      logger.error(
        `Not enough working proxies available for account ${account.id}. Required: ${instancesPerAccount}, Available: ${workingProxies.length}`
      );
      continue; // Continuar con la siguiente cuenta
    }

    try {
      // Usar el primer proxy funcional para iniciar sesión y obtener el código personal
      const { proxy: loginProxy, proxyId: loginProxyId } = workingProxies[0];
      logger.info(`Logging into Account ID: ${account.id} using Proxy ID: ${loginProxyId}`);

      const { access_token, user_id } = await logInUserAccount(account, loginProxy);
      logger.info('Logged in Successfully & Bearer Obtained');
      logger.info(`User Info obtained. User ID: ${user_id}`);

      // Guardar datos de bearer
      bearerData.push({
        account_id: account.id,
        access_token: access_token,
        proxy: loginProxy,
        instance_id: 1,
      });

      // Obtener el código personal
      const personalCode = await getPersonalCode(user_id, access_token, account, loginProxy);
      logger.info(`🔑 Personal code obtained: ${personalCode}`);

      // Conectar instancias con una demora de 2 segundos entre cada una
      for (let i = 0; i < instancesPerAccount; i++) {
        const { proxy: instanceProxy, proxyId: instanceProxyId } = workingProxies[i];
        logger.info(
          `📡 Opening WebSocket Connection for instance ${i + 1} with Proxy ID: ${instanceProxyId}`
        );

        const instance_id = i + 1;

        // Guardar datos de bearer para cada instancia
        bearerData.push({
          account_id: account.id,
          access_token: access_token,
          proxy: instanceProxy,
          instance_id: instance_id,
        });

        // Iniciar la conexión WebSocket
        connectWebSocket(
          user_id,
          access_token,
          instanceProxy,
          instance_id,
          logger,
          proxies, // Pasar la lista de proxies para modificar si es necesario
          account.id // Pasar el ID de la cuenta
        ).catch((err) => {
          logger.error(`Instance ${instance_id}: ${err.message} - [Account ${account.id}]`);
        });

        // Esperar 5 segundos antes de iniciar la siguiente conexión
        await sleep(5000);
      }
    } catch (error) {
      logger.error(`Error with account ${account.email}: ${error.message}`);
      // Continuar con la siguiente cuenta
      continue;
    }
  }

  // Escribir los datos de bearer en bearers.json
  fs.writeFileSync('bearers.json', JSON.stringify(bearerData, null, 2));
})();
