const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');

// Define the path to userdata.json relative to the project root
const userdataPath = path.join(process.cwd(), 'utils', 'userdata.json');

// Load existing accounts from userdata.json
function loadUserData() {
  if (fs.existsSync(userdataPath)) {
    const data = fs.readFileSync(userdataPath, 'utf8');
    return data ? JSON.parse(data) : [];
  }
  return [];
}

// Save the accounts to userdata.json
function saveUserData(data) {
  fs.writeFileSync(userdataPath, JSON.stringify(data, null, 2), 'utf8');
}

// Function to add a single account
async function addAccount() {
  const questions = [
    {
      type: 'input',
      name: 'email',
      message: 'Enter email ✉️:',
      validate: input => input ? true : 'Email is required!'
    },
    {
      type: 'password',
      name: 'password',
      message: 'Enter password 🔑:',
      mask: '*',
      validate: input => input ? true : 'Password is required!'
    }
  ];

  const answers = await inquirer.prompt(questions);
  const userdata = loadUserData();

  // Determine the next available account id
  const nextId = userdata.length > 0 ? Math.max(...userdata.map(acc => acc.id)) + 1 : 1;
  const apikey = "OwAG3kib1ivOJG4Y0OCZ8lJETa6ypvsDtGmdhcjB";

  const newAccount = {
    id: nextId,
    email: answers.email,
    password: answers.password,
    apikey
  };

  userdata.push(newAccount);
  saveUserData(userdata);
  console.log('✅ Account added successfully!');
}

// Main loop to add accounts repeatedly
async function main() {
  let addMore = true;
  while (addMore) {
    await addAccount();
    const { another } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'another',
        message: 'Do you want to add another account? 🤔',
        default: false
      }
    ]);
    addMore = another;
  }
  console.log('🚀 Finished adding accounts.');
}

main().catch(err => {
  console.error('An error occurred:', err);
  process.exit(1);
});
