#!/usr/bin/env python3
"""Owned, ephemeral MCP bridge. No guidance or capsule is stored on disk."""
import asyncio
import json
import os
import signal
import sys

MAX_FRAME = 150_000
TIMEOUT = 6


def extract(message):
    result = message.get('result') if isinstance(message, dict) else None
    if not isinstance(result, dict) or result.get('isError'):
        return None
    for candidate in (result, result.get('structuredContent'), result.get('result')):
        if isinstance(candidate, dict) and 'environment' in candidate:
            return candidate
    for block in result.get('content', []):
        try:
            candidate = json.loads(block.get('text', ''))
            if isinstance(candidate, dict) and 'environment' in candidate:
                return candidate
        except (ValueError, AttributeError):
            pass
    return None


async def main(socket_path, probe, state):
    # stdin is the ownership lease: EOF means the owning session exited.
    loop = asyncio.get_running_loop()
    stop = asyncio.Event()
    loop.add_reader(sys.stdin.fileno(), stop.set)
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    child = await asyncio.create_subprocess_exec(probe, '--state', state, 'mcp',
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL, limit=MAX_FRAME + 1)
    lock = asyncio.Lock()
    serial = 0
    broken = False

    async def rpc(method, params):
        nonlocal serial, broken
        if broken:
            return None
        serial += 1
        ident = serial
        try:
            msg = {'jsonrpc': '2.0', 'id': ident, 'method': method, 'params': params}
            child.stdin.write((json.dumps(msg, separators=(',', ':'))+'\n').encode())
            await asyncio.wait_for(child.stdin.drain(), TIMEOUT)
            async def response():
                while True:
                    line = await child.stdout.readline()
                    if not line or len(line) > MAX_FRAME:
                        raise ValueError('invalid frame')
                    data = json.loads(line)
                    if not isinstance(data, dict) or data.get('jsonrpc') != '2.0':
                        raise ValueError('invalid response')
                    if data.get('id') == ident:
                        return data
                    if 'id' in data:
                        raise ValueError('unexpected response')
            return await asyncio.wait_for(response(), TIMEOUT)
        except (ValueError, OSError, asyncio.TimeoutError, asyncio.LimitOverrunError):
            # Never consume a delayed response for a later request.
            broken = True
            return None

    async def client(reader, writer):
        try:
            data = await asyncio.wait_for(reader.readline(), TIMEOUT)
            request = json.loads(data)
            if request != {'op': 'read'}:
                raise ValueError('invalid request')
            await asyncio.wait_for(lock.acquire(), TIMEOUT)
            try:
                response = await rpc('tools/call', {'name': 'get_presence_guidance', 'arguments': {}})
                value = extract(response)
            finally:
                lock.release()
            output = {'result': value} if value is not None else {'error': 'unavailable'}
            encoded = (json.dumps(output, separators=(',', ':'))+'\n').encode()
            if len(encoded) > MAX_FRAME:
                encoded = b'{"error":"unavailable"}\n'
            writer.write(encoded)
            await asyncio.wait_for(writer.drain(), TIMEOUT)
        except (ValueError, OSError, asyncio.TimeoutError):
            pass
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except OSError:
                pass

    server = None
    try:
        reply = await rpc('initialize', {'protocolVersion': '2024-11-05', 'capabilities': {},
            'clientInfo': {'name': 'muse-presence-session', 'version': '1'}})
        if not isinstance(reply, dict) or not isinstance(reply.get('result'), dict):
            raise RuntimeError('MCP unavailable')
        child.stdin.write(b'{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
        await asyncio.wait_for(child.stdin.drain(), TIMEOUT)
        server = await asyncio.start_unix_server(client, path=socket_path, limit=MAX_FRAME + 1)
        os.chmod(socket_path, 0o600)
        print('ready', flush=True)
        await stop.wait()
    finally:
        if server:
            server.close()
            await server.wait_closed()
        if child.returncode is None:
            child.terminate()
            try:
                await asyncio.wait_for(child.wait(), 2)
            except asyncio.TimeoutError:
                child.kill()
                await child.wait()
        try:
            os.unlink(socket_path)
        except FileNotFoundError:
            pass


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit(2)
    asyncio.run(main(*sys.argv[1:]))
