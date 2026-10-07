import { getApi, toNodeHandler } from '../lib/runtime.js';

export default toNodeHandler((req) => getApi().health(req));
