// Prompts for a password (hidden) and prints the ADMIN_PASSWORD_HASH line for .env
// Usage: npm run hash-password      (or: node scripts/hash-password.js "password")
const readline = require('readline');
const { hashPassword } = require('../lib/auth');

function finish(password) {
    if (!password || password.length < 12) {
        console.error('\nPassword must be at least 12 characters.');
        process.exit(1);
    }
    console.log(`\nADMIN_PASSWORD_HASH=${hashPassword(password)}`);
}

if (process.argv[2]) {
    finish(process.argv[2]);
} else {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = function (str) {
        // Echo only the prompt, not the typed characters
        if (str.startsWith('Password')) rl.output.write(str);
    };
    rl.question('Password: ', answer => {
        rl.close();
        finish(answer);
    });
}
