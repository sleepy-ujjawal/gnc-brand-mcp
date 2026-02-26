const readline = require('readline');

//const BASE = 'https://gnc-brand-mcp.onrender.com';
const BASE = 'http://localhost:3000';
const STREAM_URL = `${BASE}/api/chat/stream`;

let sessionId = null;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log('\n🤖 GNC Brand Intelligence Bot');
console.log('Type your message and press Enter. Type "quit" to exit.');
console.log('---------------------------------------------------\n');

// Parse SSE stream from a fetch response body and yield each parsed event object
async function* parseSSE(body) {
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    const parts = buffer.split('\n\n');
    // Last part may be incomplete — keep it in buffer
    buffer = parts.pop();

    for (const part of parts) {
      for (const line of part.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            yield JSON.parse(line.slice(6));
          } catch {
            // ignore malformed lines
          }
        }
        // Skip heartbeat comments (:ping)
      }
    }
  }
}

async function chat(message) {
  const body = JSON.stringify(sessionId ? { message, sessionId } : { message });

  let resp;
  try {
    resp = await fetch(STREAM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(210_000), // 210s client > 180s server — server error arrives first
    });
  } catch (err) {
    console.log(`\n❌ Network error: ${err.message}\n`);
    return;
  }

  if (!resp.ok) {
    const text = await resp.text();
    console.log(`\n❌ Server error ${resp.status}: ${text}\n`);
    return;
  }

  let answerPrinted = false;

  for await (const event of parseSSE(resp.body)) {
    switch (event.type) {

      case 'connected':
        // sessionId arrives immediately — carry it for follow-up turns
        if (!sessionId) sessionId = event.sessionId;
        break;

      case 'thinking':
        process.stdout.write(`\n⏳ ${event.message || 'Thinking...'}\n`);
        break;

      case 'tool_start':
        // Labels are already grouped: "Scanning creator content ×5", "Fetching profile ×3"
        if (event.labels && event.labels.length) {
          process.stdout.write(`🔧 ${event.labels.join('  ·  ')}\n`);
        }
        break;

      case 'tool_done': {
        if (event.info) {
          const label = event.info.label || event.info.name;
          const parts = [];
          if (event.info.durationMs) parts.push(`${event.info.durationMs}ms`);
          if (event.info.cacheHit) parts.push('cached');
          if (event.info.error) parts.push(`❌ ${event.info.error}`);
          const suffix = parts.length ? `  ${parts.join(' · ')}` : '';
          const icon = event.info.error ? '⚠' : '✓';
          process.stdout.write(`   ${icon} ${label}${suffix}\n`);
        }
        break;
      }

      case 'text_chunk':
        // Stream answer tokens as they arrive — no newline, builds up inline
        if (!answerPrinted) {
          process.stdout.write('\nBot: ');
          answerPrinted = true;
        }
        process.stdout.write(event.text || '');
        break;

      case 'answer':
        // Full answer — printed via text_chunks already; just add trailing newline
        if (!answerPrinted) {
          process.stdout.write(`\nBot: ${event.text || ''}`);
        }
        process.stdout.write('\n');
        answerPrinted = true;
        if (event.toolCalls && event.toolCalls.length) {
          // Group repeated tool names: get_profile×3(120ms avg)
          const groups = {};
          for (const t of event.toolCalls) {
            if (!groups[t.name]) groups[t.name] = { count: 0, totalMs: 0, cached: 0 };
            groups[t.name].count++;
            groups[t.name].totalMs += t.durationMs || 0;
            if (t.cacheHit) groups[t.name].cached++;
          }
          const summary = Object.entries(groups).map(([name, g]) => {
            const label = g.count > 1 ? `${name}×${g.count}` : name;
            const avgMs = g.count > 0 ? Math.round(g.totalMs / g.count) : 0;
            const detail = g.cached === g.count ? 'cached' : avgMs ? `${avgMs}ms avg` : '';
            return detail ? `${label}(${detail})` : label;
          });
          process.stdout.write(`   📊 ${summary.join('  ·  ')}\n`);
        }
        break;

      case 'session':
        sessionId = event.sessionId;
        break;

      case 'error':
        console.log(`\n❌ ${event.message}\n`);
        break;
    }
  }

  process.stdout.write('\n');
}

function ask() {
  rl.question('You: ', async (msg) => {
    msg = msg.trim();
    if (!msg || msg === 'quit' || msg === 'exit') {
      console.log('Bye!');
      rl.close();
      return;
    }

    await chat(msg);
    ask();
  });
}

ask();
