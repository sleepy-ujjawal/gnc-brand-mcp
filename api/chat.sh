#!/bin/bash
# GNC Brand Intel - Terminal Chat
API="http://localhost:3000/api/chat"
SESSION=""

echo "🤖 GNC Brand Intelligence Bot"
echo "Type your message and press Enter. Type 'quit' to exit."
echo "---------------------------------------------------"

while true; do
  printf "\nYou: "
  read -r MSG
  [[ "$MSG" == "quit" || "$MSG" == "exit" ]] && echo "Bye!" && break
  [[ -z "$MSG" ]] && continue

  if [[ -z "$SESSION" ]]; then
    BODY="{\"message\":\"$MSG\"}"
  else
    BODY="{\"message\":\"$MSG\",\"sessionId\":\"$SESSION\"}"
  fi

  RESP=$(curl -s -X POST "$API" -H "Content-Type: application/json" -d "$BODY" --max-time 120)

  SESSION=$(echo "$RESP" | python -c "import sys,json; print(json.load(sys.stdin).get('sessionId',''))" 2>/dev/null)
  TEXT=$(echo "$RESP" | python -c "import sys,json; print(json.load(sys.stdin).get('response','Error: no response'))" 2>/dev/null)
  TOOLS=$(echo "$RESP" | python -c "
import sys,json
d=json.load(sys.stdin)
tc=d.get('toolCalls',[])
if tc:
    parts=[f\"{t['name']}({'cached' if t.get('cacheHit') else str(t['durationMs'])+'ms'})\" for t in tc]
    print('Tools: '+', '.join(parts))
" 2>/dev/null)

  [[ -n "$TOOLS" ]] && echo -e "\n$TOOLS"
  echo -e "\nBot: $TEXT"
done
