const readline = require('readline');
const http = require('http');

const API = 'http://localhost:3000/api/chat';
let sessionId = null;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log('\n🤖 GNC Brand Intelligence Bot');
console.log('Type your message and press Enter. Type "quit" to exit.');
console.log('---------------------------------------------------\n');

function ask() {
  rl.question('You: ', async (msg) => {
    msg = msg.trim();
    if (!msg || msg === 'quit' || msg === 'exit') {
      console.log('Bye!');
      rl.close();
      return;
    }

    const body = JSON.stringify(sessionId ? { message: msg, sessionId } : { message: msg });

    try {
      console.log('\n⏳ Thinking...');
      const resp = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(180000),
      });
      const data = await resp.json();

      sessionId = data.sessionId || sessionId;

      if (data.toolCalls && data.toolCalls.length) {
        const tools = data.toolCalls.map(t => {
          const info = t.cacheHit ? 'cached' : `${t.durationMs}ms`;
          return `${t.name}(${info})`;
        });
        console.log(`🔧 Tools: ${tools.join(', ')}`);
      }

      console.log(`\nBot: ${data.response || data.error || 'No response'}\n`);
    } catch (err) {
      console.log(`\n❌ Error: ${err.message}\n`);
    }

    ask();
  });
}

ask();
