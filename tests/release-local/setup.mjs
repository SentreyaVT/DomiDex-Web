import net from 'node:net';
import tls from 'node:tls';

if (process.env.DOMIDEX_RELEASE_LOCAL !== '1') throw Error('USE_RELEASE_LOCAL_RUNNER');
// JSDOM creates a separate global; preserve network denial there before per-test mocks.
const blocked = () => { throw Error('RELEASE_LOCAL_NETWORK_DISABLED'); };
globalThis.fetch = blocked;
globalThis.WebSocket = blocked;
net.Socket.prototype.connect = blocked;
tls.connect = blocked;
