"""One persistent official MCP client. Read-only; never starts collection/inference."""
import asyncio
import json
import sys
import signal
from fastmcp import Client
from fastmcp.client.transports import StdioTransport

async def main():
    task=asyncio.current_task()
    asyncio.get_running_loop().add_signal_handler(signal.SIGTERM,task.cancel)
    launcher, state = sys.argv[1:]
    transport = StdioTransport(command=launcher, args=['--state', state, 'mcp'])
    async with Client(transport) as client:
        while line := await asyncio.to_thread(sys.stdin.readline):
            request = json.loads(line)
            try:
                result = await client.call_tool('get_presence_guidance', {})
                response = {'id': request['id'], 'result': result.data}
            except Exception:
                response = {'id': request['id'], 'error': 'presence_read_unavailable'}
            print(json.dumps(response), flush=True)

try:
    asyncio.run(main())
except (asyncio.CancelledError,KeyboardInterrupt):
    pass
