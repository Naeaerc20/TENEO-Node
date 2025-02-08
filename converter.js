// converter.js

const fs = require('fs');
const path = require('path');

// Define input and output file paths
const inputFile = path.join(__dirname, 'default_proxies.txt');
const outputFile = path.join(__dirname, 'proxies.txt');

// Read the default_proxies.txt file
fs.readFile(inputFile, 'utf8', (err, data) => {
  if (err) {
    console.error('Error reading default_proxies.txt:', err);
    return;
  }

  // Split the file into lines and filter out empty lines
  const lines = data.split(/\r?\n/).filter(line => line.trim() !== '');

  // Convert each line by prepending "socks5://" if not already present
  const convertedProxies = lines.map(line => {
    line = line.trim();
    if (!line.startsWith('socks5://')) {
      return `socks5://${line}`;
    }
    return line;
  });

  // Write the converted proxies to proxies.txt
  fs.writeFile(outputFile, convertedProxies.join('\n'), 'utf8', err => {
    if (err) {
      console.error('Error writing proxies.txt:', err);
    } else {
      console.log('Conversion completed! Proxies have been saved in proxies.txt');
    }
  });
});
