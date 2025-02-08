// index.js

const clear = require('console-clear');
const figlet = require('figlet');
const readlineSync = require('readline-sync');
const fs = require('fs');
const winston = require('winston');
const colors = require('colors/safe');
const {
  logInUserAccount,
  connectWebSocket,
  getPublicIP,
  extractProxyId,
} = require('./scripts/apis');

// Función de sleep
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let proxies = fs
  .readFileSync('proxies.txt', 'utf-8')
  .split('\n')
  .filter(Boolean);
const userData = JSON.parse(fs.readFileSync('userdata.json', 'utf-8'));

// Configuración de log
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
console.log(
  colors.green(
    '👑 Project created by Naeaex - github.com/Naeaerc20 - x.com/naeaex_dev'
  )
);

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
  let bearerData = []; // Datos para guardar los tokens obtenidos

  for (const account of userData) {
    logger.info(`🚀 Starting processes for account: ${account.id}`);

    let workingProxies = [];

    // Buscar suficientes proxies funcionales
    while (workingProxies.length < instancesPerAccount && proxies.length > 0) {
      const proxy = proxies.shift();
      const proxyId = extractProxyId(proxy);
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
      }
    }

    if (workingProxies.length < instancesPerAccount) {
      logger.error(
        `Not enough working proxies available for account ${account.id}. Required: ${instancesPerAccount}, Available: ${workingProxies.length}`
      );
      continue;
    }

    try {
      // Se usa el primer proxy funcional para iniciar sesión
      const { proxy: loginProxy, proxyId: loginProxyId } = workingProxies[0];
      logger.info(`Logging into Account ID: ${account.id} using Proxy ID: ${loginProxyId}`);

      const { access_token, user_id, personal_code } = await logInUserAccount(account, loginProxy);
      logger.info('Logged in Successfully & Bearer Obtained');
      logger.info(`User Info obtained. User ID: ${user_id}`);
      logger.info(`🔑 Personal code obtained: ${personal_code}`);

      // Guardar token para la primera instancia (login)
      bearerData.push({
        account_id: account.id,
        access_token: access_token,
        proxy: loginProxy,
        instance_id: 1,
      });

      // Conectar cada instancia
      for (let i = 0; i < instancesPerAccount; i++) {
        const { proxy: instanceProxy, proxyId: instanceProxyId } = workingProxies[i];
        logger.info(
          `📡 Opening WebSocket Connection for instance ${i + 1} with Proxy ID: ${instanceProxyId}`
        );

        const instance_id = i + 1;

        bearerData.push({
          account_id: account.id,
          access_token: access_token,
          proxy: instanceProxy,
          instance_id: instance_id,
        });

        connectWebSocket(
          user_id,
          access_token,
          instanceProxy,
          instance_id,
          logger,
          proxies,
          account.id
        ).catch((err) => {
          logger.error(`Instance ${instance_id}: ${err.message} - [Account ${account.id}]`);
        });

        await sleep(5000);
      }
    } catch (error) {
      logger.error(`Error with account ${account.email}: ${error.message}`);
      continue;
    }
  }

  fs.writeFileSync('bearers.json', JSON.stringify(bearerData, null, 2));
})();
