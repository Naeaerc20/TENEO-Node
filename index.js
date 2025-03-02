const clear = require('console-clear');
const figlet = require('figlet');
const readlineSync = require('readline-sync');
const fs = require('fs');
const winston = require('winston');
const colors = require('colors/safe');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const {
  logInUserAccount,
  connectWebSocket,
  getPublicIP,
  extractProxyId,
} = require('./scripts/apis');

// Simple sleep
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Read proxies and user data from the utils directory
let proxies = fs.readFileSync('utils/proxies.txt', 'utf-8').split('\n').filter(Boolean);
const userData = JSON.parse(fs.readFileSync('utils/userdata.json', 'utf-8'));

// Logger config
const customLevels = {
  levels: { error: 0, warn: 1, info: 2 },
  colors: { error: 'red', warn: 'yellow', info: 'blue' }
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
    return `${level}${timestamp} ${info.message}`;
  })
);

const logger = winston.createLogger({
  levels: customLevels.levels,
  format: customFormat,
  transports: [new winston.transports.Console()]
});

clear();

console.log(
  colors.green(
    figlet.textSync('TENEO NODE', {
      font: 'Standard',
      horizontalLayout: 'default',
      verticalLayout: 'default'
    })
  )
);

console.log(colors.green('👋 Hello! Welcome to Teneo Node Automatized Tool'));
console.log(colors.green('👑 Project created by Naeaex - github.com/Naeaerc20 - x.com/naeaex_dev'));

const instancesPerAccount = parseInt(
  readlineSync.question('How many instances do you want to connect per account? ')
);

// Basic validations
if (proxies.length === 0) {
  logger.error('No proxies available in utils/proxies.txt');
  process.exit(1);
}
if (userData.length === 0) {
  logger.error('No user data available in utils/userdata.json');
  process.exit(1);
}

// Function to solve the Turnstile captcha by running "captcha.py"
async function solveCaptcha() {
  logger.info('Solving Captcha...');
  try {
    const { stdout } = await execPromise('python scripts/captcha.py');
    let result = JSON.parse(stdout.trim());
    if (result.error) {
      throw new Error(result.error);
    }
    if (!result.code) {
      throw new Error('No captcha code found in output');
    }
    logger.info('Captcha Solved!');
    return result.code;
  } catch (err) {
    // If there's an error with stdout, try to parse it from err.stdout
    if (err.stdout) {
      try {
        let result = JSON.parse(err.stdout.trim());
        if (result.error) {
          throw new Error(result.error);
        }
        if (!result.code) {
          throw new Error('No captcha code found in output');
        }
        logger.info('Captcha Solved!');
        return result.code;
      } catch (parseErr) {
        throw new Error('Error solving captcha: ' + err.message);
      }
    } else {
      throw new Error('Error solving captcha: ' + err.message);
    }
  }
}

// Ask if new access tokens should be obtained manually
const obtainNew = readlineSync.question('Obtain new access tokens manually? (y/n): ');

(async () => {
  let bearerData = [];

  if (obtainNew.toLowerCase() === 'y') {
    // For each account, solve captcha, log in, connect instances
    for (const account of userData) {
      logger.info(`🚀 Starting processes for account: ${account.id}`);

      let workingProxies = [];
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
          logger.warn(`Unable to obtain public IP with proxy ${proxyId}. Removing proxy and trying next one.`);
        }
      }

      if (workingProxies.length < instancesPerAccount) {
        logger.error(`Not enough working proxies for account ${account.id}. Required: ${instancesPerAccount}, Available: ${workingProxies.length}`);
        continue;
      }

      try {
        const captchaSolved = await solveCaptcha();

        // Use the first proxy to log in
        const { proxy: loginProxy, proxyId: loginProxyId } = workingProxies[0];
        logger.info(`Logging into Account ID: ${account.id} using Proxy ID: ${loginProxyId}`);

        // Log in with the captcha token
        const { access_token, user_id, personal_code } = await logInUserAccount(account, loginProxy, captchaSolved);
        logger.info('Logged in successfully & bearer obtained');
        logger.info(`User info: user_id=${user_id}, personal_code=${personal_code}`);

        // Store minimal info in bearers.json (id + token)
        bearerData.push({ id: account.id, access_token });

        // Connect each instance
        for (let i = 0; i < instancesPerAccount; i++) {
          const { proxy: instanceProxy, proxyId: instanceProxyId } = workingProxies[i];
          logger.info(`📡 Opening WebSocket for instance ${i + 1} with Proxy ID: ${instanceProxyId}`);
          connectWebSocket(
            user_id,
            access_token,
            instanceProxy,
            i + 1,
            logger,
            proxies,
            account.id
          ).catch((err) => {
            logger.error(`Instance ${i + 1}: ${err.message} - [Account ${account.id}]`);
          });
          await sleep(5000);
        }
      } catch (error) {
        logger.error(`Error with account ${account.email}: ${error.message}`);
        continue;
      }
    }

    // Write all tokens to utils/bearers.json
    fs.writeFileSync('utils/bearers.json', JSON.stringify(bearerData, null, 2));
  } else {
    // If we do not obtain new tokens, read them from utils/bearers.json
    try {
      bearerData = JSON.parse(fs.readFileSync('utils/bearers.json', 'utf-8'));
      for (const account of userData) {
        logger.info(`🚀 Starting processes for account: ${account.id}`);

        // Find that account's token
        const found = bearerData.find(b => b.id === account.id);
        if (!found) {
          logger.error(`No bearer token found for account ${account.id}. Skipping...`);
          continue;
        }

        let workingProxies = [];
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
            logger.warn(`Unable to obtain public IP with proxy ${proxyId}. Removing proxy and trying next one.`);
          }
        }

        if (workingProxies.length < instancesPerAccount) {
          logger.error(`Not enough working proxies for account ${account.id}. Required: ${instancesPerAccount}, Available: ${workingProxies.length}`);
          continue;
        }

        // Connect instances, skipping login
        const { access_token } = found;
        for (let i = 0; i < instancesPerAccount; i++) {
          const { proxy: instanceProxy, proxyId: instanceProxyId } = workingProxies[i];
          logger.info(`📡 Opening WebSocket for instance ${i + 1} with Proxy ID: ${instanceProxyId}`);
          connectWebSocket(
            '', // user_id not stored in bearers.json
            access_token,
            instanceProxy,
            i + 1,
            logger,
            proxies,
            account.id
          ).catch((err) => {
            logger.error(`Instance ${i + 1}: ${err.message} - [Account ${account.id}]`);
          });
          await sleep(5000);
        }
      }
    } catch (err) {
      logger.error('Error reading utils/bearers.json: ' + err.message);
      process.exit(1);
    }
  }
})();
